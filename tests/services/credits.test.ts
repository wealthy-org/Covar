/**
 * Copilot credits (package 3.7): the real route handlers and a real database.
 * The chain RPC and the AI provider are local mock servers, so every path can be
 * forced: reverted tx, missing confirmations, wrong sender, provider failure…
 *
 *   pnpm test:credits                                  # SQLite temp DB
 *   CREDITS_TEST_DATABASE_URL=postgresql://… pnpm test:credits
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const dbUrl = process.env.CREDITS_TEST_DATABASE_URL ?? `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "covar-credits-")), "credits.db")}`;
process.env.DATABASE_URL = dbUrl;
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

/* ------------------------------ mock servers ------------------------------ */
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const TREASURY = "0x8b43AC0f705D18D2C42D12EB2fABe3e45e1045B1";
const pad = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const word = (v: bigint) => "0x" + v.toString(16).padStart(64, "0");

const chain = { id: 46630, head: 100, receipts: new Map<string, unknown>() };
const provider = { mode: "ok" as "ok" | "fail" | "garbage" | "cost" | "nousage", calls: 0 };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const send = (code: number, j: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(j));
    };
    if (req.url === "/rpc") {
      const { method, params, id } = JSON.parse(body);
      const result = method === "eth_chainId" ? "0x" + chain.id.toString(16) : method === "eth_blockNumber" ? "0x" + chain.head.toString(16) : method === "eth_getTransactionReceipt" ? (chain.receipts.get(params[0]) ?? null) : null;
      return send(200, { jsonrpc: "2.0", id, result });
    }
    if (req.url === "/v1/chat/completions") {
      provider.calls++;
      if (provider.mode === "fail") return send(500, { error: "boom" });
      const content = provider.mode === "garbage" ? "I cannot help with that" : JSON.stringify({ name: "Test", style: "trend", market: "ETH-PERP", timeframe: "1h", risk: "balanced", copilot: "advisory" });
      const usage = provider.mode === "nousage" ? undefined : { prompt_tokens: 1000, completion_tokens: 200, ...(provider.mode === "cost" ? { cost: 0.00042 } : {}) };
      return send(200, { choices: [{ message: { content } }], ...(usage ? { usage } : {}) });
    }
    send(404, {});
  });
});

const HOST = "covar.test";
const ORIGIN = `https://${HOST}`;
let ipN = 0;
const req = (url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers: {
      host: HOST,
      "x-forwarded-proto": "https",
      "x-forwarded-for": `10.0.0.${ipN++ % 250}`,
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    CREDITS_CHAIN_ID: "46630",
    CREDITS_RPC_URL: `${base}/rpc`,
    CREDITS_TREASURY_ADDRESS: TREASURY,
    CREDITS_MIN_CONFIRMATIONS: "3",
    CREDITS_MIN_TOPUP_USD: "1",
    CREDITS_MAX_TOPUP_USD: "500",
    AI_PROVIDER: "openai",
    AI_PROVIDER_API_KEY: "sk-test-key",
    AI_BASE_URL: `${base}/v1`,
    AI_MODEL: "test-model",
    AI_PRICE_IN_PER_MTOK: "1",
    AI_PRICE_OUT_PER_MTOK: "5",
    AI_APP_FEE_PCT: "20",
    CREDITS_MODE: "enforce",
  });

  const credits = await import("../../src/lib/credits");
  const creditsRoute = await import("../../src/app/api/credits/route");
  const topupRoute = await import("../../src/app/api/credits/topup/route");
  const statsRoute = await import("../../src/app/api/credits/stats/route");
  const copilotRoute = await import("../../src/app/api/copilot/route");
  const { prisma } = await import("../../src/lib/db");
  const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> }); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log(`\nCopilot credits · ${pg ? "PostgreSQL" : "SQLite"}`);

  // ------------------------------------------------------------- pricing
  const p = credits.pricing();
  const u = { provider: "x", model: "m", tokensIn: 1000, tokensOut: 200 };
  const priced = credits.priceUsage(u, p)!;
  ok("price table: 1000×$1/M + 200×$5/M = $0.002000", priced.providerCost === 2000n && priced.basis === "price-table", priced);
  ok("application fee 20% on top", priced.appFee === 400n && priced.total === 2400n, priced);
  ok("provider-reported cost wins over the table (rounded up)", credits.priceUsage({ ...u, providerCostUsd: 0.0000001 }, p)!.providerCost === 1n);
  ok("no table and no provider cost → null (never guessed)", credits.priceUsage(u, { inPerMTok: null, outPerMTok: null, appFeePct: 0 }) === null);
  ok("reserve = floor $0.01 when a worst-case call is cheaper ($0.00384)", credits.reserveFor(p) === 10_000n, credits.reserveFor(p).toString());
  ok("reserve = worst-case call (1.2k in + 400 out + fee) when above the floor", credits.reserveFor({ inPerMTok: 10, outPerMTok: 50, appFeePct: 20 }) === ((12_000n + 20_000n) * 120n) / 100n, credits.reserveFor({ inPerMTok: 10, outPerMTok: 50, appFeePct: 20 }).toString());

  // ------------------------------------------------------------- sessions
  const mkUser = async () => {
    const address = "0x" + randomBytes(20).toString("hex");
    const token = randomBytes(32).toString("base64url");
    await prisma.authSession.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), address, chainId: 46630, expiresAt: new Date(Date.now() + 3600_000) } });
    return { address, cookie: `covar_session=${token}` };
  };
  const alice = await mkUser();
  const bob = await mkUser();

  // ------------------------------------------------------------- top-ups
  const tx = () => "0x" + randomBytes(32).toString("hex");
  const receipt = (o: { status?: string; block?: number; logs: { token?: string; from: string; to?: string; value: bigint; idx?: number }[] }) => ({
    status: o.status ?? "0x1",
    blockNumber: "0x" + (o.block ?? 90).toString(16),
    logs: o.logs.map((l, i) => ({ address: l.token ?? USDG, topics: [TRANSFER, pad(l.from), pad(l.to ?? TREASURY)], data: word(l.value), logIndex: "0x" + (l.idx ?? i).toString(16) })),
  });
  const post = async (who: { cookie: string } | null, txHash: string, origin?: string) => json(await topupRoute.POST(req("/api/credits/topup", { method: "POST", body: { txHash }, cookie: who?.cookie, origin })));

  ok("anonymous top-up → 401", (await post(null, tx())).status === 401);
  ok("cross-origin top-up → 403", (await post(alice, tx(), "https://evil.example")).status === 403);
  ok("malformed hash → 400", (await post(alice, "0x1234")).status === 400);
  ok("unknown tx → 409 (not mined yet)", (await post(alice, tx())).status === 409);

  const reverted = tx();
  chain.receipts.set(reverted, receipt({ status: "0x0", logs: [{ from: alice.address, value: 5_000_000n }] }));
  ok("reverted tx → 400, nothing credited", (await post(alice, reverted)).status === 400);

  const fresh = tx();
  chain.receipts.set(fresh, receipt({ block: 99, logs: [{ from: alice.address, value: 5_000_000n }] }));
  const r409 = await post(alice, fresh);
  ok("2 of 3 confirmations → 409 with the count", r409.status === 409 && /2\/3/.test(r409.body.error), r409.body);

  const wrongFrom = tx();
  chain.receipts.set(wrongFrom, receipt({ logs: [{ from: bob.address, value: 5_000_000n }] }));
  ok("transfer from another wallet is not yours → 400", (await post(alice, wrongFrom)).status === 400);
  const wrongTo = tx();
  chain.receipts.set(wrongTo, receipt({ logs: [{ from: alice.address, to: "0x" + "11".repeat(20), value: 5_000_000n }] }));
  ok("transfer to a non-treasury address → 400", (await post(alice, wrongTo)).status === 400);
  const wrongToken = tx();
  chain.receipts.set(wrongToken, receipt({ logs: [{ token: "0x" + "22".repeat(20), from: alice.address, value: 5_000_000n }] }));
  ok("another token posing as USDG → 400", (await post(alice, wrongToken)).status === 400);
  const tiny = tx();
  chain.receipts.set(tiny, receipt({ logs: [{ from: alice.address, value: 500_000n }] }));
  ok("below the 1 USDG minimum → 400", (await post(alice, tiny)).status === 400);
  const huge = tx();
  chain.receipts.set(huge, receipt({ logs: [{ from: alice.address, value: 501_000_000n }] }));
  ok("above the 500 USDG maximum → 400", (await post(alice, huge)).status === 400);

  chain.head = 120;
  const good = await post(alice, fresh);
  ok("confirmed transfer credited: $5", good.status === 200 && good.body.creditedUsd === 5 && good.body.balanceUsd === 5, good.body);
  const again = await post(alice, fresh);
  ok("same tx again credits nothing (idempotent)", again.status === 200 && again.body.creditedUsd === 0 && again.body.alreadyCreditedUsd === 5 && again.body.balanceUsd === 5, again.body);
  const stolen = await post(bob, fresh);
  ok("another wallet cannot claim alice's transfer", stolen.status === 400);

  const multi = tx();
  chain.receipts.set(multi, receipt({ logs: [{ from: alice.address, value: 2_000_000n }, { from: alice.address, value: 3_000_000n }] }));
  const m = await post(alice, multi);
  ok("two transfers in one tx both credited", m.body.creditedUsd === 5 && m.body.balanceUsd === 10, m.body);

  chain.id = 1;
  const otherChain = tx();
  chain.receipts.set(otherChain, receipt({ logs: [{ from: alice.address, value: 5_000_000n }] }));
  ok("server RPC on the wrong chain → 503", (await post(alice, otherChain)).status === 503);
  chain.id = 46630;

  // ------------------------------------------------------------- copilot metering
  const ask = async (who: { cookie: string } | null, origin?: string) => json(await copilotRoute.POST(req("/api/copilot", { method: "POST", body: { prompt: "trend follow ETH on 1h" }, cookie: who?.cookie, origin })));
  const bal = async (who: { address: string }) => Number(await credits.balanceOf(who.address)) / 1e6;

  provider.calls = 0;
  const anon = await ask(null);
  ok("anonymous: free rules parser, provider not called", anon.body.engine === "rules-credits" && provider.calls === 0 && /Sign in/.test(anon.body.note), anon.body);
  const broke = await ask(bob);
  ok("signed in without credits: rules parser, provider not called", broke.body.engine === "rules-credits" && provider.calls === 0 && /Not enough Copilot credits/.test(broke.body.note), broke.body);
  ok("cross-origin copilot call refused when metered", (await ask(alice, "https://evil.example")).status === 403);

  const before = await bal(alice);
  const paid = await ask(alice);
  ok("with credits: the model answers", paid.body.engine === "model" && provider.calls === 1, paid.body);
  ok("debited exactly usage × price + fee ($0.0024)", Math.abs(before - (await bal(alice)) - 0.0024) < 1e-9 && paid.body.credits?.chargedUsd === 0.0024, { before, after: await bal(alice), c: paid.body.credits });
  const row = await prisma.creditEntry.findFirst({ where: { owner: alice.address, kind: "usage" }, orderBy: { createdAt: "desc" } });
  ok("usage row keeps tokens, provider cost and app fee", row?.tokensIn === 1000 && row?.tokensOut === 200 && row?.providerCost === 2000n && row?.appFee === 400n && row?.model === "test-model", row && { ...row, amount: String(row.amount), providerCost: String(row.providerCost), appFee: String(row.appFee) });

  provider.mode = "cost";
  const b2 = await bal(alice);
  const viaCost = await ask(alice);
  ok("provider-reported cost billed (+20%): $0.000504", Math.abs(b2 - (await bal(alice)) - 0.000504) < 1e-9 && viaCost.body.credits?.basis === "provider-reported", viaCost.body.credits);

  provider.mode = "fail";
  const b3 = await bal(alice);
  const failed = await ask(alice);
  ok("provider failure: rules fallback and NO debit", failed.body.engine === "rules-fallback" && (await bal(alice)) === b3 && !failed.body.credits, failed.body);

  provider.mode = "garbage";
  const b4 = await bal(alice);
  const garbage = await ask(alice);
  ok("provider answered but output rejected: usage still billed, rules draft returned", garbage.body.engine === "rules-fallback" && Math.abs(b4 - (await bal(alice)) - 0.0024) < 1e-9, { engine: garbage.body.engine, d: b4 - (await bal(alice)) });

  provider.mode = "nousage";
  const b5 = await bal(alice);
  const nousage = await ask(alice);
  const reserveUsd = Number(credits.reserveFor()) / 1e6;
  ok("completed call without usage billed at the worst case, labelled", nousage.body.engine === "model" && Math.abs(b5 - (await bal(alice)) - reserveUsd) < 1e-9 && /worst-case/.test(nousage.body.credits?.basis ?? ""), nousage.body.credits);

  provider.mode = "ok";
  process.env.CREDITS_MODE = "off";
  const b6 = await bal(alice);
  const free = await ask(bob);
  ok("CREDITS_MODE=off: model answers for free, no ledger rows", free.body.engine === "model" && !free.body.credits && (await bal(alice)) === b6 && (await bal(bob)) === 0);
  process.env.CREDITS_MODE = "enforce";

  // parallel calls cannot overspend: give bob exactly one call's reserve
  await prisma.creditEntry.create({ data: { id: randomUUID(), owner: bob.address, kind: "grant", amount: credits.reserveFor(), note: "test grant" } });
  provider.calls = 0;
  const par = await Promise.all([ask(bob), ask(bob), ask(bob)]);
  ok("3 parallel calls on one reserve: exactly one reaches the model", par.filter((r) => r.body.engine === "model").length === 1 && provider.calls === 1, par.map((r) => r.body.engine));
  ok("balance never negative", (await bal(bob)) >= 0, await bal(bob));

  // ------------------------------------------------------------- read routes
  const mine = await json(await creditsRoute.GET(req("/api/credits", { cookie: alice.cookie })));
  ok("GET /api/credits: balance + newest-first ledger", mine.body.signedIn && mine.body.balanceUsd === (await bal(alice)) && mine.body.entries[0].kind === "usage" && mine.body.entries.some((e: { kind: string; txHash: string }) => e.kind === "topup" && e.txHash === fresh), mine.body.entries?.slice(0, 2));
  ok("GET /api/credits: public config (treasury, token, pricing, mode)", mine.body.config.treasury === TREASURY && mine.body.config.usdg === USDG && mine.body.config.pricing.appFeePct === 20 && mine.body.config.mode === "enforce" && mine.body.config.topupsEnabled);
  const anonGet = await json(await creditsRoute.GET(req("/api/credits")));
  ok("GET /api/credits anonymous: config only, no balance", anonGet.body.signedIn === false && anonGet.body.balanceUsd === undefined && !!anonGet.body.config);
  const bobView = await json(await creditsRoute.GET(req("/api/credits", { cookie: bob.cookie })));
  ok("bob never sees alice's entries", bobView.body.entries.every((e: { txHash: string | null }) => e.txHash !== fresh));

  const stats = await json(await statsRoute.GET());
  ok("stats: sold $10 by 1 wallet, consumed = sum of usage rows", stats.body.soldUsd === 10 && stats.body.buyers === 1 && stats.body.calls >= 5, stats.body);
  ok("stats: consumed = provider cost + app fee; outstanding = sold − consumed", Math.abs(stats.body.consumedUsd - stats.body.providerCostUsd - stats.body.appFeeUsd) < 1e-9 && Math.abs(stats.body.outstandingUsd - (10 - stats.body.consumedUsd)) < 1e-9, stats.body);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  await prisma.$disconnect();
  server.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
