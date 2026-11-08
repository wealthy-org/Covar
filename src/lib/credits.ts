/**
 * Copilot credits (package 3.7), server side only.
 *
 *   Top-up   the user sends USDG on-chain to CREDITS_TREASURY_ADDRESS and posts the
 *            tx hash. The server reads the receipt from the chain and credits every
 *            Transfer(from = signed-in wallet, to = treasury) in it, once.
 *   Usage    each successful model call is debited at the provider's token usage
 *            × price (or the cost the provider itself reports), plus the
 *            application fee. A failed call costs nothing; the rules parser is free.
 *   Balance  SUM of an append-only ledger in micro-USD (1 USDG = 1 USD).
 *
 * Credits are a liability (prepaid service), not revenue. Only the application
 * fee part of usage is platform revenue; the provider cost is a pass-through.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CHAINS, EXPECTED_CHAIN_ID, type ChainId } from "./chain";

export const MICRO = 1_000_000n;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // keccak("Transfer(address,address,uint256)")

/** Known USDG deployments (verified on-chain, see docs/GO_LIVE_RUNBOOK.md). */
const USDG_BY_CHAIN: Record<number, string> = {
  46630: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
  4663: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
};

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] !== undefined ? v : d;
};

/** enforce = model calls need a signed-in wallet with credits. off = free (dev default). */
export function creditsMode(): "enforce" | "off" {
  const m = process.env.CREDITS_MODE?.trim().toLowerCase();
  if (m === "enforce" || m === "off") return m;
  return process.env.NODE_ENV === "production" ? "enforce" : "off";
}

export interface Pricing {
  inPerMTok: number | null; // USD per 1M input tokens
  outPerMTok: number | null;
  appFeePct: number; // application fee on top of provider cost
}

export function pricing(): Pricing {
  const i = process.env.AI_PRICE_IN_PER_MTOK;
  const o = process.env.AI_PRICE_OUT_PER_MTOK;
  return {
    inPerMTok: i ? Number(i) : null,
    outPerMTok: o ? Number(o) : null,
    appFeePct: Math.max(0, Math.min(100, num("AI_APP_FEE_PCT", 0))),
  };
}

export interface Usage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** cost the provider itself reported for the call, in USD (e.g. OpenRouter-style `usage.cost`) */
  providerCostUsd?: number;
}

export interface Priced {
  providerCost: bigint;
  appFee: bigint;
  total: bigint;
  basis: "provider-reported" | "price-table";
}

const usdToMicro = (usd: number) => BigInt(Math.ceil(usd * 1e6)); // round up: never undercharge the provider pass-through

/** Price one call. null = no basis to price it (no table, no provider cost): do not guess. */
export function priceUsage(u: Usage, p: Pricing = pricing()): Priced | null {
  let providerCost: bigint;
  let basis: Priced["basis"];
  if (typeof u.providerCostUsd === "number" && Number.isFinite(u.providerCostUsd) && u.providerCostUsd >= 0) {
    providerCost = usdToMicro(u.providerCostUsd);
    basis = "provider-reported";
  } else if (p.inPerMTok !== null && p.outPerMTok !== null) {
    providerCost = usdToMicro((u.tokensIn * p.inPerMTok + u.tokensOut * p.outPerMTok) / 1e6);
    basis = "price-table";
  } else return null;
  const appFee = (providerCost * BigInt(Math.round(p.appFeePct * 100))) / 10_000n;
  return { providerCost, appFee, total: providerCost + appFee, basis };
}

/** Balance a call needs up front: a worst-case call (prompt cap + max_tokens), never below CREDITS_MIN_BALANCE_USD. */
export function reserveFor(p: Pricing = pricing()): bigint {
  const floor = usdToMicro(num("CREDITS_MIN_BALANCE_USD", 0.01));
  if (p.inPerMTok === null || p.outPerMTok === null) return floor;
  const worst = priceUsage({ provider: "", model: "", tokensIn: 1_200, tokensOut: 400 }, p)!.total; // 2000-char prompt + system ≈ 1.2k tokens
  return worst > floor ? worst : floor;
}

export async function balanceOf(owner: string): Promise<bigint> {
  const r = await prisma.creditEntry.aggregate({ where: { owner: owner.toLowerCase() }, _sum: { amount: true } });
  return r._sum.amount ?? 0n;
}

/* serialize debits per owner so two parallel calls cannot both pass the balance check */
const locks = new Map<string, Promise<unknown>>();
export async function withOwnerLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(owner) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(owner, tail);
  try {
    return await run;
  } finally {
    if (locks.get(owner) === tail) locks.delete(owner);
  }
}

export async function recordUsage(owner: string, u: Usage, priced: Priced, note?: string) {
  return prisma.creditEntry.create({
    data: {
      id: randomUUID(),
      owner: owner.toLowerCase(),
      kind: "usage",
      amount: -priced.total,
      provider: u.provider,
      model: u.model,
      tokensIn: u.tokensIn,
      tokensOut: u.tokensOut,
      providerCost: priced.providerCost,
      appFee: priced.appFee,
      priceBasis: priced.basis,
      note: note ?? null,
    },
  });
}

/* --------------------------------- top-ups -------------------------------- */

export interface TopupConfig {
  chainId: number;
  rpc: string;
  usdg: string | null;
  treasury: string | null;
  minTopupUsd: number;
  maxTopupUsd: number;
  minConfirmations: number;
}

export function topupConfig(): TopupConfig {
  const chainId = Number(process.env.CREDITS_CHAIN_ID || EXPECTED_CHAIN_ID);
  const known = CHAINS[chainId as ChainId];
  const addr = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? v.trim() : null);
  return {
    chainId,
    rpc: process.env.CREDITS_RPC_URL || known?.rpc || "",
    usdg: addr(process.env.CREDITS_USDG_ADDRESS) ?? USDG_BY_CHAIN[chainId] ?? null,
    treasury: addr(process.env.CREDITS_TREASURY_ADDRESS),
    minTopupUsd: num("CREDITS_MIN_TOPUP_USD", 1),
    maxTopupUsd: num("CREDITS_MAX_TOPUP_USD", 500),
    minConfirmations: Math.max(1, num("CREDITS_MIN_CONFIRMATIONS", 1)),
  };
}

export class TopupError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

const topicAddr = (t: string | undefined) => (t ? `0x${t.slice(26)}`.toLowerCase() : "");

/**
 * Credit the USDG transfers in `txHash` from `owner` to the treasury. Idempotent:
 * re-posting the same hash credits nothing new and reports what was credited before.
 */
export async function creditTopup(ownerIn: string, txHashIn: string, cfg: TopupConfig = topupConfig()) {
  const owner = ownerIn.toLowerCase();
  const txHash = txHashIn.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new TopupError("Not a transaction hash.");
  if (!cfg.treasury || !cfg.usdg || !cfg.rpc) throw new TopupError("Credit top-ups are not configured on this server (CREDITS_TREASURY_ADDRESS / USDG / RPC).", 503);

  const rpcChain = Number(BigInt(await rpc<string>(cfg.rpc, "eth_chainId", [])));
  if (rpcChain !== cfg.chainId) throw new TopupError(`Server RPC is on chain ${rpcChain}, expected ${cfg.chainId}.`, 503);
  const receipt = await rpc<{ status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string; logIndex: string }[] } | null>(cfg.rpc, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) throw new TopupError("Transaction not found or not mined yet. Try again in a few seconds.", 409);
  if (receipt.status !== "0x1") throw new TopupError("That transaction reverted. No USDG moved.");
  const head = Number(BigInt(await rpc<string>(cfg.rpc, "eth_blockNumber", [])));
  const confirmations = head - Number(BigInt(receipt.blockNumber)) + 1;
  if (confirmations < cfg.minConfirmations) throw new TopupError(`Waiting for confirmations (${confirmations}/${cfg.minConfirmations}).`, 409);

  const transfers = receipt.logs.filter(
    (l) =>
      l.address.toLowerCase() === cfg.usdg!.toLowerCase() &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      topicAddr(l.topics[1]) === owner &&
      topicAddr(l.topics[2]) === cfg.treasury!.toLowerCase(),
  );
  if (!transfers.length) throw new TopupError("No USDG transfer from your signed-in wallet to the credits treasury in that transaction.");

  let credited = 0n;
  let already = 0n;
  for (const l of transfers) {
    const value = BigInt(l.data); // USDG: 6 decimals = micro-USD
    if (value < usdToMicro(cfg.minTopupUsd)) throw new TopupError(`Minimum top-up is ${cfg.minTopupUsd} USDG.`);
    if (value > usdToMicro(cfg.maxTopupUsd)) throw new TopupError(`Maximum top-up is ${cfg.maxTopupUsd} USDG per transfer.`);
    try {
      await prisma.creditEntry.create({
        data: { id: randomUUID(), owner, kind: "topup", amount: value, chainId: cfg.chainId, txHash, logIndex: Number(BigInt(l.logIndex)), note: `USDG → ${cfg.treasury}` },
      });
      credited += value;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") already += value;
      else throw err;
    }
  }
  return { credited, already, balance: await balanceOf(owner) };
}

export const microToUsd = (m: bigint | null | undefined) => Number(m ?? 0n) / 1e6;
