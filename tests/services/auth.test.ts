/**
 * SIWE login + multi-user state (package 3.2) — the real Next route handlers,
 * a real database, real secp256k1 signatures.
 *
 *   pnpm test:auth                         # SQLite temp DB
 *   AUTH_TEST_DATABASE_URL=postgresql://… pnpm test:auth   # against Postgres
 *     (generate the Postgres client first: node scripts/prisma-pg.mjs generate)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";

const dbUrl = process.env.AUTH_TEST_DATABASE_URL ?? `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "covar-auth-")), "auth.db")}`;
process.env.DATABASE_URL = dbUrl;
process.env.STATE_ANON_MODE = "off"; // production behaviour: no shared anonymous row
const pg = dbUrl.startsWith("postgres");
execFileSync(process.execPath, pg ? ["scripts/prisma-pg.mjs", "migrate", "reset", "--force", "--skip-generate", "--skip-seed"] : [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
  stdio: "pipe",
  env: { ...process.env, DATABASE_URL: dbUrl },
});

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
};

const HOST = "covar.test";
const ORIGIN = `https://${HOST}`;
const req = (url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers: {
      host: HOST,
      "x-forwarded-proto": "https",
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

(async () => {
  const { parseSiweMessage, buildSiweMessage } = await import("../../src/lib/siwe");
  const nonceRoute = await import("../../src/app/api/auth/nonce/route");
  const verifyRoute = await import("../../src/app/api/auth/verify/route");
  const sessionRoute = await import("../../src/app/api/auth/session/route");
  const logoutRoute = await import("../../src/app/api/auth/logout/route");
  const stateRoute = await import("../../src/app/api/state/route");
  const { prisma } = await import("../../src/lib/db");

  console.log(`\nSIWE + multi-user state · ${pg ? "PostgreSQL" : "SQLite"}`);

  // ---------------------------------------------------------------- message format
  const sample = buildSiweMessage({ domain: HOST, address: "0x" + "ab".repeat(20), statement: "Hi", uri: ORIGIN, version: "1", chainId: 46630, nonce: "abcdef0123456789", issuedAt: new Date().toISOString() });
  ok("build → parse round-trip", parseSiweMessage(sample).nonce === "abcdef0123456789" && parseSiweMessage(sample).statement === "Hi");
  let threw = false;
  try {
    parseSiweMessage(sample + "\nResources: evil");
  } catch {
    threw = true;
  }
  ok("trailing fields rejected", threw);

  // ---------------------------------------------------------------- login
  const alice = Wallet.createRandom();
  const bob = Wallet.createRandom();
  const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any>, cookie: r.headers.get("set-cookie") }); // eslint-disable-line @typescript-eslint/no-explicit-any

  const bad = await json(await nonceRoute.POST(req("/api/auth/nonce", { method: "POST", body: { address: "0x123", chainId: 46630 } })));
  ok("bad address → 400", bad.status === 400);
  const badChain = await json(await nonceRoute.POST(req("/api/auth/nonce", { method: "POST", body: { address: alice.address, chainId: 1 } })));
  ok("Ethereum mainnet chain id refused → 400", badChain.status === 400 && /not accepted/.test(badChain.body.error), badChain.body);
  const xo = await json(await nonceRoute.POST(req("/api/auth/nonce", { method: "POST", origin: "https://evil.example", body: { address: alice.address, chainId: 46630 } })));
  ok("cross-origin nonce request → 403", xo.status === 403);

  const login = async (w: Wallet | ReturnType<typeof Wallet.createRandom>, chainId = 46630) => {
    const n = await json(await nonceRoute.POST(req("/api/auth/nonce", { method: "POST", body: { address: w.address, chainId } })));
    const signature = await w.signMessage(n.body.message);
    const v = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: n.body.message, signature } })));
    return { n, v, signature, cookie: (v.cookie ?? "").split(";")[0] };
  };

  const a = await login(alice);
  const fields = parseSiweMessage(a.n.body.message);
  ok("server-built message: our domain, URI, chain, checksummed address", fields.domain === HOST && fields.uri === ORIGIN && fields.chainId === 46630 && fields.address === alice.address, fields);
  ok("statement says no gas / no transaction", /no gas/.test(fields.statement ?? ""));
  ok("valid signature → signed in", a.v.status === 200 && a.v.body.user?.address === alice.address.toLowerCase(), a.v.body);
  ok("cookie is HttpOnly, Secure, SameSite=Lax", /HttpOnly/.test(a.v.cookie ?? "") && /Secure/.test(a.v.cookie ?? "") && /SameSite=Lax/.test(a.v.cookie ?? ""), a.v.cookie);
  const stored = await prisma.authSession.findFirst({ where: { address: alice.address.toLowerCase() } });
  ok("only the token hash is stored", !!stored && !a.cookie.includes(stored.tokenHash) && stored.tokenHash.length === 64);

  const me = await json(await sessionRoute.GET(req("/api/auth/session", { cookie: a.cookie })));
  ok("session endpoint knows the user", me.body.user?.address === alice.address.toLowerCase());
  const anon = await json(await sessionRoute.GET(req("/api/auth/session")));
  ok("no cookie → no user", anon.body.user === null);
  const forged = await json(await sessionRoute.GET(req("/api/auth/session", { cookie: "covar_session=forged" })));
  ok("forged cookie → no user", forged.body.user === null);

  const replay = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: a.n.body.message, signature: a.signature } })));
  ok("replayed signature → nonce already used", replay.status === 401 && /already used|unknown/.test(replay.body.error), replay.body);

  const n2 = await json(await nonceRoute.POST(req("/api/auth/nonce", { method: "POST", body: { address: alice.address, chainId: 46630 } })));
  const wrongSigner = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: n2.body.message, signature: await bob.signMessage(n2.body.message) } })));
  ok("someone else's signature → refused", wrongSigner.status === 401 && /does not match/.test(wrongSigner.body.error), wrongSigner.body);
  const phish = n2.body.message.replace(`${HOST} wants`, "evil.example wants");
  const phished = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: phish, signature: await alice.signMessage(phish) } })));
  ok("message for another domain → refused", phished.status === 401 && /issued for evil.example/.test(phished.body.error), phished.body);
  const f2 = parseSiweMessage(n2.body.message);
  const old = buildSiweMessage({ ...f2, issuedAt: new Date(Date.now() - 3600_000).toISOString(), expirationTime: undefined });
  const stale = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: old, signature: await alice.signMessage(old) } })));
  ok("hour-old message → refused", stale.status === 401 && /too old/.test(stale.body.error), stale.body);
  const garbage = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: "hello", signature: "0x00" } })));
  ok("garbage → 400", garbage.status === 400);
  const fresh = await json(await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { message: n2.body.message, signature: await alice.signMessage(n2.body.message) } })));
  ok("failed attempts did not burn the nonce", fresh.status === 200, fresh.body);

  // ---------------------------------------------------------------- multi-user state
  const b = await login(bob);
  const snap = (who: string) => ({
    walletConnected: true,
    agents: [{ id: "ag-1" }],
    notifications: [{ id: "n-same-id", ts: new Date().toISOString(), kind: "system", title: `hello ${who}`, body: who, read: false }],
    portfolio: { ledger: [{ id: "l-same-id", ts: new Date().toISOString(), kind: "deposit", label: `dep ${who}`, amountUsd: 1, state: "settled" }] },
    practice: { "ag-1": { agentId: "ag-1", startedAt: new Date().toISOString(), capitalUsd: 100, pnlUsd: 0, ticks: 0, status: "running", priceMode: "simulated" } },
    drafts: [{ id: "d-1", agentId: "draft", version: 1, name: `draft ${who}`, createdAt: new Date().toISOString() }],
    liveStrategy: {},
    creators: [],
  });
  const noAuth = await json(await stateRoute.POST(req("/api/state", { method: "POST", body: snap("anon") })));
  ok("anonymous write refused in production mode → 401", noAuth.status === 401 && noAuth.body.auth === "required");
  const sa = await json(await stateRoute.POST(req("/api/state", { method: "POST", cookie: a.cookie, body: snap("alice") })));
  const sb = await json(await stateRoute.POST(req("/api/state", { method: "POST", cookie: b.cookie, body: snap("bob") })));
  ok("both users save (same row ids, no collision)", sa.status === 200 && sb.status === 200 && sa.body.owner === alice.address.toLowerCase(), [sa.body, sb.body]);
  const ga = await json(await stateRoute.GET(req("/api/state", { cookie: a.cookie })));
  const gb = await json(await stateRoute.GET(req("/api/state", { cookie: b.cookie })));
  ok("each user reads only their own state", ga.body.state?.notifications?.[0]?.title === "hello alice" && gb.body.state?.notifications?.[0]?.title === "hello bob", [ga.body.state?.notifications, gb.body.state?.notifications]);
  ok("DB label reports the engine", ga.body.db === (pg ? "prisma-postgres" : "prisma-sqlite"), ga.body.db);
  const rows = await prisma.notification.count({ where: { id: "n-same-id" } });
  ok("per-user rows mirrored (2 owners × same id)", rows === 2, rows);
  const xs = await json(await stateRoute.POST(req("/api/state", { method: "POST", cookie: a.cookie, origin: "https://evil.example", body: snap("csrf") })));
  ok("cross-site state write → 403 (CSRF)", xs.status === 403);
  const ga2 = await json(await stateRoute.GET(req("/api/state", { cookie: a.cookie })));
  ok("…and alice's state is untouched", ga2.body.state?.notifications?.[0]?.title === "hello alice");

  // ---------------------------------------------------------------- logout
  const lo = await logoutRoute.POST(req("/api/auth/logout", { method: "POST", cookie: a.cookie }));
  ok("logout clears the cookie", /Max-Age=0/.test(lo.headers.get("set-cookie") ?? ""));
  const after = await json(await sessionRoute.GET(req("/api/auth/session", { cookie: a.cookie })));
  ok("old cookie is revoked server-side", after.body.user === null);
  const afterState = await json(await stateRoute.GET(req("/api/state", { cookie: a.cookie })));
  ok("revoked cookie cannot read state", afterState.status === 401);
  const users = await prisma.user.count();
  ok("users table has exactly the two wallets", users === 2, users);

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) console.log(`failed: ${fails.join(" | ")}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
