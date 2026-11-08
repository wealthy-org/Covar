/**
 * Server-side Sign-In with Ethereum + session cookies (package 3.2).
 *
 * Flow:
 *   1. POST /api/auth/nonce {address, chainId} → the server stores a one-time
 *      nonce and returns the exact EIP-4361 text to sign (its own domain/URI).
 *   2. The wallet signs it (personal_sign — no gas, no transaction).
 *   3. POST /api/auth/verify {message, signature} → parse strictly, check the
 *      domain, chain, freshness and nonce (consumed atomically), recover the
 *      signer, then set an HttpOnly session cookie. Only SHA-256(token) is stored.
 *
 * Accounts are EOAs (MetaMask/Rabby). Smart-contract wallets (EIP-1271) are not
 * accepted — they fail signature recovery and are told so.
 */
import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import { prisma } from "./db";
import { buildSiweMessage, parseSiweMessage, SIWE_STATEMENT } from "./siwe";

export const SESSION_COOKIE = "covar_session";
const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24 * 7) * 3600_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ request context */

export function requestOrigin(req: Request): { host: string; origin: string; secure: boolean } {
  const fixed = process.env.APP_ORIGIN; // e.g. https://covar.example — set in production
  if (fixed) {
    const u = new URL(fixed);
    return { host: u.host, origin: u.origin, secure: u.protocol === "https:" };
  }
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host).split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
  return { host, origin: `${proto}://${host}`, secure: proto === "https" };
}

/** Browser POSTs must come from our own origin (CSRF). Non-browser clients send no Origin. */
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin");
  return !o || o === requestOrigin(req).origin;
}

export function allowedChainIds(): number[] {
  const ids = [Number(process.env.NEXT_PUBLIC_RH_TESTNET_CHAIN_ID || 46630), Number(process.env.NEXT_PUBLIC_RH_MAINNET_CHAIN_ID || 4663)];
  if (process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_CHAIN === "yes") ids.push(31337);
  return ids;
}

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string, req: Request, maxAgeSec: number): string {
  const { secure } = requestOrigin(req);
  // Only the three valid values; anything else (empty, typo) → Lax.
  const raw = (process.env.SESSION_COOKIE_SAMESITE || "").trim().toLowerCase();
  const sameSite = raw === "strict" ? "Strict" : raw === "none" ? "None" : "Lax";
  return [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", `SameSite=${sameSite}`, `Max-Age=${maxAgeSec}`, secure || sameSite === "None" ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

/* ------------------------------------------------------------------ rate limit */
const hits = new Map<string, number[]>();
export function rateLimited(req: Request, bucket: string, max: number, windowMs = 60_000): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > max;
}

/* ------------------------------------------------------------------ SIWE */

export async function issueNonce(req: Request, addressIn: string, chainId: number) {
  let address: string;
  try {
    address = getAddress(addressIn);
  } catch {
    throw new AuthError("not an Ethereum address", 400);
  }
  if (!allowedChainIds().includes(chainId)) throw new AuthError(`chain ${chainId} is not accepted (allowed: ${allowedChainIds().join(", ")})`, 400);
  const nonce = randomBytes(16).toString("hex");
  const now = new Date();
  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authNonce.create({ data: { nonce, expiresAt: new Date(now.getTime() + NONCE_TTL_MS) } });
  const { host, origin } = requestOrigin(req);
  const message = buildSiweMessage({
    domain: host,
    address,
    statement: SIWE_STATEMENT,
    uri: origin,
    version: "1",
    chainId,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + NONCE_TTL_MS).toISOString(),
  });
  return { message, nonce, expiresAt: new Date(now.getTime() + NONCE_TTL_MS).toISOString() };
}

export async function verifyLogin(req: Request, message: string, signature: string) {
  let f;
  try {
    f = parseSiweMessage(message);
  } catch (e) {
    throw new AuthError(`invalid sign-in message: ${(e as Error).message}`, 400);
  }
  const { host, origin } = requestOrigin(req);
  if (f.domain !== host) throw new AuthError(`message was issued for ${f.domain}, not ${host}`);
  if (f.uri !== origin) throw new AuthError("message URI does not match this site");
  if (!allowedChainIds().includes(f.chainId)) throw new AuthError(`chain ${f.chainId} is not accepted`);
  const now = Date.now();
  const issued = Date.parse(f.issuedAt);
  if (issued > now + 60_000 || issued < now - NONCE_TTL_MS) throw new AuthError("sign-in message is too old — request a new one");
  if (f.expirationTime && Date.parse(f.expirationTime) < now) throw new AuthError("sign-in message expired — request a new one");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AuthError("signature must be a 65-byte hex string", 400);

  let signer: string;
  try {
    signer = verifyMessage(message, signature);
  } catch {
    throw new AuthError("signature could not be verified");
  }
  if (signer.toLowerCase() !== f.address.toLowerCase()) {
    throw new AuthError("signature does not match the address in the message (smart-contract wallets are not supported)");
  }

  // consume the nonce atomically: a replayed signature finds it already used
  const used = await prisma.authNonce.updateMany({ where: { nonce: f.nonce, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new AuthError("sign-in nonce is unknown, expired or already used");

  const address = f.address.toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await prisma.$transaction([
    prisma.user.upsert({ where: { address }, update: { lastLoginAt: new Date(), lastChainId: f.chainId }, create: { address, lastChainId: f.chainId } }),
    prisma.authSession.create({ data: { tokenHash: sha256(token), address, chainId: f.chainId, expiresAt } }),
  ]);
  return { address, chainId: f.chainId, token, expiresAt };
}

export interface SessionUser {
  address: string;
  chainId: number;
  expiresAt: string;
}

export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const s = await prisma.authSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
  return { address: s.address, chainId: s.chainId, expiresAt: s.expiresAt.toISOString() };
}

export async function logout(req: Request) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await prisma.authSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Who owns server-side app state for this request: the signed-in address, or the
 * shared "local" row in single-operator dev mode. In production anonymous state is
 * never persisted server-side (it would be one row shared by every visitor).
 */
export async function stateOwner(req: Request): Promise<string | null> {
  const u = await currentUser(req);
  if (u) return u.address;
  const anon = process.env.STATE_ANON_MODE || (process.env.NODE_ENV === "production" ? "off" : "local");
  return anon === "local" ? "local" : null;
}
