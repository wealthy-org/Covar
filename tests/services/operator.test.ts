/**
 * Operator (3.3) + monitor/alerts (3.10) tests.
 *
 *   pnpm test:operator
 *
 * 1. pure plan() decisions
 * 2. Telegram sink against a local mock Bot API (cooldown, failure, redaction)
 * 3. monitor evaluate/diff (page once, resolve once)
 * 4. execution close port against a mock execution service
 * 5. LIVE integration: a real Hardhat node, the real CovarVault v2 bytecode, the
 *    operator sending real transactions through ethers — deposit → NAV → allocate →
 *    transit guard → venue gain → withdrawal → close → shortfall → auto-fund → settle → claim
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, Wallet, Contract, type Signer } from "ethers";
import { createOperator, plan, DEFAULT_CONFIG, type VaultSnapshot, type CloseStatus, type ClosePort, type OperatorConfig } from "../../services/operator/app";
import { createChainPort, VAULT_ABI } from "../../services/operator/chain";
import { executionClosePort, exitsFor, usdgUnits } from "../../services/operator/venue";
import { createAlertSink, formatAlert } from "../../services/monitor/alerts";
import { parseTargets } from "../../services/monitor/targets";
import { createMonitor, evaluate, DEFAULT_MONITOR } from "../../services/monitor/app";
import { createRisk } from "../../services/risk/app";
import { demoIntent } from "../../services/exchange/app";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`);
  }
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "covar-op-"));
const U = (n: number) => BigInt(Math.round(n * 1e6));

const base = (over: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  isV2: true,
  now: 1_000_000,
  reportedAssets: U(100),
  totalShares: U(100),
  lastNavUpdate: 1_000_000 - 60,
  maxNavAge: 6 * 3600,
  maxNavChangeBps: 2000,
  depositsPaused: false,
  closeOnly: false,
  vaultBalance: U(100),
  reservedForClaims: 0n,
  availableLiquidity: U(100),
  tradingAccount: null,
  operatorUsdg: 0n,
  operatorGasWei: 10n ** 17n,
  requests: [],
  ...over,
});
const P = (v: Partial<VaultSnapshot>, venueEquity: bigint | null = 0n, cfg: Partial<OperatorConfig> = {}, cs: CloseStatus = "not_started") =>
  plan({ vault: base(v), venueEquity, closeStatus: () => cs, cfg: { ...DEFAULT_CONFIG, ...cfg } });
const kinds = (p: ReturnType<typeof plan>) => p.actions.map((a) => a.kind).join(",");
const codes = (p: ReturnType<typeof plan>) => p.alerts.map((a) => a.code).join(",");

function unitPlan() {
  console.log("\n1 · plan()");
  ok("steady state → nothing to do", kinds(P({})) === "" && codes(P({})) === "");
  ok("old report (≥ maxNavAge/2) → reportNav", kinds(P({ lastNavUpdate: 1_000_000 - 3 * 3600 })) === "reportNav");
  ok("refresh override honoured", kinds(P({ lastNavUpdate: 1_000_000 - 600 }, 0n, { navRefreshSec: 300 })) === "reportNav");
  const moved = P({ vaultBalance: U(101) });
  ok("1% move → reportNav(101)", kinds(moved) === "reportNav" && (moved.actions[0] as { assets: bigint }).assets === U(101), moved.actions);
  ok("0.3% move under threshold → nothing", kinds(P({ vaultBalance: U(100.3) })) === "");
  const big = P({ vaultBalance: U(110) });
  ok("10% move → HELD, not reported", kinds(big) === "" && codes(big) === "NAV_DEVIATION_HELD", big);
  ok("…even when the report is due by age", codes(P({ vaultBalance: U(110), lastNavUpdate: 1_000_000 - 4 * 3600 })) === "NAV_DEVIATION_HELD");
  ok("contract cap is respected below the auto limit", codes(P({ vaultBalance: U(103), maxNavChangeBps: 200 }, 0n, { maxAutoChangeBps: 1000 })) === "NAV_DEVIATION_HELD");
  const stale = P({ vaultBalance: U(110), lastNavUpdate: 1_000_000 - 7 * 3600 });
  ok("held + stale → NAV_STALE alert too", codes(stale).includes("NAV_STALE"));
  const first = P({ reportedAssets: 0n, totalShares: 0n, lastNavUpdate: 0, vaultBalance: 0n, availableLiquidity: 0n });
  ok("first report on an empty vault → reportNav(0)", kinds(first) === "reportNav" && (first.actions[0] as { assets: bigint }).assets === 0n);
  const blind = P({ lastNavUpdate: 1_000_000 - 4 * 3600 }, null);
  ok("venue unreadable → no report, critical alert", kinds(blind) === "" && codes(blind) === "VENUE_UNREADABLE");
  ok("venue equity counted", (P({ vaultBalance: U(20), availableLiquidity: U(20) }, U(80)).computedNav ?? 0n) === U(100));
  ok("claims reserve excluded from NAV", (P({ vaultBalance: U(110), reservedForClaims: U(10), availableLiquidity: U(100) }).computedNav ?? 0n) === U(100));
  ok("operator wallet counted only when enabled", P({ vaultBalance: U(20), operatorUsdg: U(80) }).computedNav === U(20) && P({ vaultBalance: U(20), operatorUsdg: U(80) }, 0n, { operatorWalletInNav: true }).computedNav === U(100));

  const req = (state: VaultSnapshot["requests"][number]["state"], shares = U(25)) => [{ investor: "0xA", shares, requestedAt: 999_000, state }];
  const c = P({ requests: req("ClosingPositions") });
  ok("ClosingPositions → closePositions(25%)", kinds(c) === "closePositions" && (c.actions[0] as { fraction: number }).fraction === 0.25, c.actions);
  ok("close pending → wait", kinds(P({ requests: req("ClosingPositions") }, 0n, {}, "pending")) === "");
  ok("close done → markPositionsClosed", kinds(P({ requests: req("ClosingPositions") }, 0n, {}, "done")) === "markPositionsClosed");
  ok("close failed → alert, no mark", codes(P({ requests: req("ClosingPositions") }, 0n, {}, "failed")) === "CLOSE_FAILED");
  const s = P({ requests: req("Settling") });
  ok("Settling + liquidity → settle(shares × NAV)", kinds(s) === "settleWithdrawal" && (s.actions[0] as { netAssets: bigint }).netAssets === U(25), s.actions);
  const s2 = P({ requests: req("Settling"), vaultBalance: U(102) });
  ok("NAV moved → report first, settle at the NEW NAV", kinds(s2) === "reportNav,settleWithdrawal" && (s2.actions[1] as { netAssets: bigint }).netAssets === U(25.5), s2.actions);
  const short = P({ requests: req("Settling"), vaultBalance: U(10), availableLiquidity: U(10) }, U(90));
  ok("shortfall → alert, no settle", kinds(short) === "" && codes(short) === "LIQUIDITY_SHORTFALL", short);
  const funded = P({ requests: req("Settling"), vaultBalance: U(10), availableLiquidity: U(10), operatorUsdg: U(20) }, U(70), { autoFundFromOperatorWallet: true });
  ok("auto-fund from wallet B → fundVault(15) then settle", kinds(funded) === "fundVault,settleWithdrawal" && (funded.actions[0] as { amount: bigint }).amount === U(15), funded);
  const heldSettle = P({ requests: req("Settling"), vaultBalance: U(150), lastNavUpdate: 1_000_000 - 7 * 3600 });
  ok("stale + held NAV → settlement waits", !kinds(heldSettle).includes("settle"));
  const two = P({ requests: [...req("Settling", U(60)), { investor: "0xB", shares: U(30), requestedAt: 999_100, state: "Settling" }], vaultBalance: U(70), availableLiquidity: U(70) }, U(30));
  ok("liquidity is consumed across requests", kinds(two) === "settleWithdrawal" && codes(two) === "LIQUIDITY_SHORTFALL", two);

  const alloc = { autoAllocate: true, idleReserveBps: 2000, minAllocate: U(10) };
  ok("auto-allocate off by default", kinds(P({ tradingAccount: "0xT" })) === "");
  const a = P({ tradingAccount: "0xT" }, 0n, alloc);
  ok("auto-allocate above a 20% reserve → allocate 80", kinds(a) === "allocateToVenue" && (a.actions[0] as { amount: bigint }).amount === U(80), a.actions);
  ok("no trading account → no allocation", kinds(P({}, 0n, alloc)) === "");
  ok("v1 vault → no allocation", kinds(P({ tradingAccount: "0xT", isV2: false }, 0n, alloc)) === "");
  ok("close-only → no allocation", kinds(P({ tradingAccount: "0xT", closeOnly: true }, 0n, alloc)) === "");
  ok("withdrawal pending → no allocation", !kinds(P({ tradingAccount: "0xT", requests: req("ClosingPositions") }, 0n, alloc, "pending")).includes("allocate"));
  ok("below minimum → no allocation", kinds(P({ tradingAccount: "0xT", vaultBalance: U(100), availableLiquidity: U(85) }, 0n, { ...alloc, minAllocate: U(70) })) === "");
  ok("low gas → OPERATOR_GAS_LOW", codes(P({ operatorGasWei: 1000n })) === "OPERATOR_GAS_LOW");
  ok("usdgUnits parses and truncates", usdgUnits("12.3456789") === 12_345_678n && usdgUnits("7") === 7_000_000n && usdgUnits(0.5) === 500_000n);
  let threw = false;
  try {
    usdgUnits("1e3");
  } catch {
    threw = true;
  }
  ok("usdgUnits rejects exotic numbers", threw);
  const ex = exitsFor([{ market: "ETH-PERP", qty: 0.5, avgPrice: 3000, realizedPnl: 0 }, { market: "BTC-PERP", qty: -0.01, avgPrice: 90000, realizedPnl: 0 }, { market: "SOL-PERP", qty: 0, avgPrice: 1, realizedPnl: 0 }], 0.25);
  ok("exits: proportional, opposite side, skip flat", JSON.stringify(ex.map((e) => [e.market, e.side, e.qty])) === JSON.stringify([["ETH-PERP", "sell", 0.125], ["BTC-PERP", "buy", 0.0025]]), ex);
}

/* ---------------------------------------------------------------- telegram */
async function unitAlerts() {
  console.log("\n2 · Telegram alerts (mock Bot API)");
  const got: { path: string; body: Record<string, unknown> }[] = [];
  let fail = false;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    got.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString() || "{}") });
    res.setHeader("content-type", "application/json");
    if (fail) res.writeHead(401).end(JSON.stringify({ ok: false, description: "Unauthorized" }));
    else res.end(JSON.stringify({ ok: true, result: { message_id: got.length } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  let clock = 0;
  const dir = tmp();
  const sink = createAlertSink({ dir, token: "123:SECRET", chatId: "-100777", apiBase: `http://127.0.0.1:${port}`, cooldownSec: 60, now: () => clock, label: "testnet" });
  const a = { source: "operator", level: "critical" as const, code: "NAV_STALE", message: "NAV is 400 min old" };
  ok("first alert sent", (await sink.send(a)) === "sent");
  ok("Bot API path + chat id", got[0]?.path === "/bot123:SECRET/sendMessage" && got[0]?.body.chat_id === "-100777", got[0]);
  ok("message text formatted", String(got[0]?.body.text).startsWith("🚨 CRITICAL · NAV_STALE\n[operator · testnet]"), got[0]?.body.text);
  ok("repeat inside cooldown suppressed", (await sink.send(a)) === "suppressed" && got.length === 1);
  ok("resolution always passes", (await sink.send({ ...a, resolved: true })) === "sent" && String(got[1]?.body.text).startsWith("✅ RESOLVED"));
  clock = 61_000;
  ok("after cooldown sent again", (await sink.send(a)) === "sent" && got.length === 3);
  fail = true;
  clock = 200_000;
  ok("Bot API error → failed (not thrown)", (await sink.send({ ...a, code: "X" })) === "failed");
  const journal = fs.readFileSync(path.join(dir, "alerts.jsonl"), "utf8");
  ok("journal keeps every outcome", ["sent", "suppressed", "send_failed"].every((t) => journal.includes(`"type":"${t}"`)));
  ok("token never written to the journal", !journal.includes("SECRET"));
  fail = false;
  ok("failed alert retried next time (no cooldown)", (await sink.send({ ...a, code: "X" })) === "sent");
  const quiet = createAlertSink({ dir: tmp() });
  ok("no token → console-only, logged", (await quiet.send(a)) === "logged" && quiet.describe.startsWith("console"));
  ok("formatAlert info", formatAlert({ source: "m", level: "info", code: "C", message: "x" }).startsWith("ℹ️ INFO · C"));
  server.close();
}

/* ---------------------------------------------------------------- monitor */
async function unitMonitor() {
  console.log("\n3 · monitor");
  const sent: string[] = [];
  const sink = { describe: "test", send: async (a: { code: string; resolved?: boolean }) => (sent.push(`${a.resolved ? "resolved:" : ""}${a.code}`), "sent" as const) };
  let execUp = true;
  let vault: VaultSnapshot = base({ now: 100_000, lastNavUpdate: 100_000 - 60 });
  let now = 1_000_000;
  const mon = createMonitor({
    sink,
    observe: async () => ({
      now,
      services: [
        { name: "execution", ok: execUp, error: execUp ? undefined : "ECONNREFUSED" },
        { name: "operator", ok: true, body: { lastCycle: new Date(now - 30_000).toISOString() } },
      ],
      vault,
    }),
  });
  await mon.round();
  ok("healthy → silent", sent.length === 0, sent);
  execUp = false;
  await mon.round();
  ok("one failed poll is not an outage", sent.length === 0, sent);
  await mon.round();
  ok("two failed polls → SERVICE_DOWN once", sent.join() === "SERVICE_DOWN:execution", sent);
  await mon.round();
  ok("still down → not repeated", sent.length === 1);
  execUp = true;
  await mon.round();
  ok("recovery → resolved", sent.at(-1) === "resolved:SERVICE_DOWN:execution", sent);
  vault = base({ now: 100_000, lastNavUpdate: 100_000 - 5 * 3600 });
  await mon.round();
  ok("NAV at 83% of max age → NAV_AGING", sent.at(-1) === "NAV_AGING");
  vault = base({ now: 100_000, lastNavUpdate: 100_000 - 7 * 3600 });
  await mon.round();
  ok("NAV past max age → NAV_STALE (+ aging resolved)", sent.includes("NAV_STALE") && sent.includes("resolved:NAV_AGING"), sent);
  const p = evaluate(
    { now, services: [{ name: "operator", ok: true, body: { lastCycle: new Date(now - 10 * 60_000).toISOString() } }], vault: base({ requests: [{ investor: "0xA", shares: 1n, requestedAt: 1_000_000 - 30 * 3600, state: "Settling" }], operatorGasWei: 1n, vaultBalance: 1n, reservedForClaims: 5n, closeOnly: true }) },
    {},
    DEFAULT_MONITOR,
  ).map((x) => x.code.split(":")[0]);
  ok("stalled operator, delayed withdrawal, underfunded claims, low gas, close-only", ["OPERATOR_STALLED", "WITHDRAWAL_DELAYED", "CLAIMS_UNDERFUNDED", "OPERATOR_GAS_LOW", "VAULT_CLOSE_ONLY"].every((c) => p.includes(c)), p);
  ok("vault unreadable → critical", evaluate({ now, services: [], vault: { error: "timeout" } }, {}, DEFAULT_MONITOR)[0]?.code === "VAULT_UNREADABLE");
  const hb: string[] = [];
  const mon2 = createMonitor({ sink: { describe: "t", send: async (a) => (hb.push(a.code), "sent") }, observe: async () => ({ now, services: [], vault: null }), heartbeatMs: 3600_000 });
  await mon2.round();
  now += 1000;
  await mon2.round();
  ok("heartbeat once per window", hb.length === 1 && hb[0].startsWith("HEARTBEAT"), hb);
}

/* ---------------------------------------------------------------- close port */
async function unitClosePort() {
  console.log("\n4 · execution close port (mock execution service)");
  const orders: { intentId: string; status: string }[] = [];
  const posted: Record<string, unknown>[] = [];
  let positions = [{ market: "ETH-PERP", qty: 0.4, avgPrice: 3000, realizedPnl: 0 }];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/state") return res.end(JSON.stringify({ execution: { orders, positions, intents: [] } }));
    if (req.method === "POST" && req.url === "/intents") {
      const { intent } = JSON.parse(Buffer.concat(chunks).toString());
      posted.push(intent);
      if (!orders.some((o) => o.intentId === intent.intentId)) orders.push({ intentId: intent.intentId, status: "submitted" });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const port = executionClosePort({ execUrl: url, price: async () => 3100 });
  const r = { investor: "0xAbC", requestedAt: 42 };
  ok("before start → not_started", (await port.status(r, 0.5)) === "not_started");
  await port.start(r, 0.5);
  const i = posted[0] as { intentId: string; side: string; qty: number; price: number; reduceOnly: boolean };
  ok("reduce-only sell of half at the venue price", i?.intentId === "wd-0xabc-42-ETH-PERP" && i.side === "sell" && i.qty === 0.2 && i.price === 3100 && i.reduceOnly === true, i);
  ok("submitted → pending", (await port.status(r, 0.5)) === "pending");
  await port.start(r, 0.5);
  ok("replayed start reuses the same idempotency key", posted.length === 2 && (posted[1] as { intentId: string }).intentId === i.intentId && orders.length === 1);
  orders[0].status = "filled";
  ok("filled → done", (await port.status(r, 0.5)) === "done");
  orders[0].status = "risk_rejected";
  ok("rejected → failed", (await port.status(r, 0.5)) === "failed");
  positions = [];
  ok("no positions → done without orders", (await port.status({ investor: "0xother", requestedAt: 1 }, 0.5)) === "done");
  server.close();
  let threw = false;
  try {
    await executionClosePort({ execUrl: "http://127.0.0.1:1" }).status(r, 1);
  } catch {
    threw = true;
  }
  ok("execution down → throws (cycle treats it as pending)", threw);
}

function unitRiskExit() {
  console.log("\n4b · risk: verified exits are not size-capped");
  const risk = createRisk({ dir: tmp(), equity: 1_000 }); // cap = 40% × 1000 = 400 notional at 1x
  risk.applyFill({ market: "ETH-PERP", side: "buy", qty: 0.3, price: 1000, fee: 0 }); // grew to 0.3 ETH
  const exit = risk.evaluate(demoIntent({ intentId: "x1", market: "ETH-PERP", side: "sell", qty: 0.3, price: 2000, reduceOnly: true, leverage: 1 }));
  ok("full exit worth 600 > cap 400 is approved", exit.approved, exit.reason);
  const over = risk.evaluate(demoIntent({ intentId: "x2", market: "ETH-PERP", side: "sell", qty: 0.5, price: 2000, reduceOnly: true, leverage: 1 }));
  ok("'reduce-only' larger than the position stays capped", !over.approved && /position_size_cap/.test(over.reason), over.reason);
  const wrong = risk.evaluate(demoIntent({ intentId: "x3", market: "ETH-PERP", side: "buy", qty: 0.3, price: 2000, reduceOnly: true, leverage: 1 }));
  ok("'reduce-only' on the same side stays capped", !wrong.approved, wrong.reason);
}

/* ---------------------------------------------------------------- live chain */
// Hardhat's well-known dev mnemonic — local chain only, never funded anywhere real
const HH_KEYS = [0, 1, 2, 3, 4].map((i) => HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, `m/44'/60'/0'/0/${i}`).privateKey);

async function startNode(port: number): Promise<ChildProcess> {
  const node = spawn(process.execPath, ["scripts/hardhat.mjs", "node", "--port", String(port), "--hostname", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("hardhat node did not start in 90s")), 90_000);
    node.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("Started HTTP")) {
        clearTimeout(t);
        resolve();
      }
    });
    node.on("exit", (c) => reject(new Error(`hardhat node exited ${c}`)));
  });
  return node;
}

async function live() {
  console.log("\n5 · LIVE operator against a Hardhat node + CovarVault v2");
  const art = (n: string) => JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", `${n}.sol`, `${n}.json`), "utf8"));
  if (!fs.existsSync(path.join("artifacts", "contracts", "CovarVault.sol", "CovarVault.json"))) throw new Error("compile first: pnpm test:contracts (creates artifacts/)");
  const rpcPort = 8600 + Math.floor(Math.random() * 300);
  const node = await startNode(rpcPort);
  try {
    const provider = new JsonRpcProvider(`http://127.0.0.1:${rpcPort}`, undefined, { cacheTimeout: -1 });
    const w = HH_KEYS.map((k) => new NonceManager(new Wallet(k, provider)));
    const [owner, , fee, investor, trading] = w;
    const addr = async (s: Signer) => s.getAddress();
    const [operatorAddr, feeAddr, investorAddr, tradingAddr] = await Promise.all([addr(w[1]), addr(fee), addr(investor), addr(trading)]);

    const usdgArt = art("MockUSDG");
    const usdg = (await new ContractFactory(usdgArt.abi, usdgArt.bytecode, owner).deploy()) as Contract;
    await usdg.waitForDeployment();
    const vArt = art("CovarVault");
    const vault = (await new ContractFactory(vArt.abi, vArt.bytecode, owner).deploy(await usdg.getAddress(), feeAddr, operatorAddr)) as Contract;
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    const asInv = (c: Contract) => c.connect(investor) as Contract;
    await (await usdg.mint(investorAddr, U(500))).wait();
    await (await asInv(usdg).approve(vaultAddr, U(500))).wait();
    const time = async (s: number) => {
      await provider.send("evm_increaseTime", [s]);
      await provider.send("evm_mine", []);
    };

    // operator wired exactly like main.ts, with a controllable venue + close port
    let venueEquity: bigint | null = 0n;
    const venue = { describe: "test venue", equity: async () => (venueEquity === null ? Promise.reject(new Error("down")) : venueEquity) };
    let closeState: CloseStatus = "not_started";
    const closeCalls: number[] = [];
    const close: ClosePort = { describe: "test", status: async () => closeState, start: async (_r, f) => void closeCalls.push(f) };
    const chain = createChainPort({ rpcUrl: "", vault: vaultAddr, privateKey: HH_KEYS[1], provider });
    const dir = tmp();
    const alerts: string[] = [];
    const cfg: Partial<OperatorConfig> = { autoAllocate: true, idleReserveBps: 2000, minAllocate: U(10), transitTimeoutSec: 600 };
    let op = createOperator({ dir, vault: chain, venue, close, cfg, live: true, onAlert: (a) => alerts.push(a.code) });
    const cycle = async () => {
      const r = await op.cycle();
      return { kinds: r.plan.actions.map((a) => a.kind).join(","), sent: r.sent, r };
    };
    const reported = async () => (await vault.reportedAssets()) as bigint;

    ok("wallet B is the vault operator", (await chain.checkRole()) === null);
    const dry = createOperator({ dir: tmp(), vault: chain, venue, close, cfg, live: false });
    const d = await dry.cycle();
    ok("dry-run plans the first NAV report but sends nothing", d.plan.actions[0]?.kind === "reportNav" && d.sent.length === 0 && (await vault.lastNavUpdate()) === 0n);

    let c = await cycle();
    ok("first cycle reports NAV 0 → deposits open", c.kinds === "reportNav" && c.sent[0]?.hash?.startsWith("0x") === true && (await vault.lastNavUpdate()) > 0n, c.sent);
    await (await asInv(vault).deposit(U(100))).wait();
    ok("investor deposit 100 → reported 98.9", (await reported()) === U(98.9));
    c = await cycle();
    ok("no trading account yet → nothing to do", c.kinds === "", c.r.plan);

    await (await (vault.connect(owner) as Contract).setTradingAccount(tradingAddr)).wait();
    c = await cycle();
    ok("trading account set → allocate 79.12 above 20% reserve", c.kinds === "allocateToVenue" && (await usdg.balanceOf(tradingAddr)) === U(79.12), c.r.plan.actions);
    c = await cycle();
    ok("venue not credited yet → counted in transit, no false NAV drop", c.kinds === "" && !alerts.includes("NAV_DEVIATION_HELD") && op.transit() !== null, c.r.plan);
    op = createOperator({ dir, vault: chain, venue, close, cfg, live: true, onAlert: (a) => alerts.push(a.code) });
    ok("transit survives an operator restart (journal)", op.transit()?.amount === U(79.12).toString());
    await time(700);
    c = await cycle();
    ok("transit overdue → TRANSIT_OVERDUE alert", alerts.includes("TRANSIT_OVERDUE"));
    venueEquity = U(79.12);
    c = await cycle();
    ok("venue credited → transit closed, NAV unchanged", op.transit() === null && c.kinds === "", c.r.plan);

    venueEquity = U(81.12); // +2 USDG trading gain
    c = await cycle();
    ok("venue gain 2 USDG (2%) → reportNav 100.9", c.kinds === "reportNav" && (await reported()) === U(100.9), c.r.plan.notes);
    venueEquity = U(120);
    c = await cycle();
    ok("implausible +19% jump → held, not reported", c.kinds === "" && alerts.includes("NAV_DEVIATION_HELD") && (await reported()) === U(100.9));
    venueEquity = null;
    await time(3 * 3600 + 60);
    c = await cycle();
    ok("venue unreadable + report due → no report, alert", c.kinds === "" && alerts.includes("VENUE_UNREADABLE"));
    venueEquity = U(81.12);
    c = await cycle();
    ok("venue back → age-based refresh", c.kinds === "reportNav", c.r.plan);

    const shares = (await vault.balanceOf(investorAddr)) as bigint;
    await (await asInv(vault).requestWithdrawal(shares)).wait();
    c = await cycle();
    ok("withdrawal request → close 100% of positions", c.kinds === "closePositions" && closeCalls[0] === 1, { kinds: c.kinds, closeCalls });
    closeState = "pending";
    c = await cycle();
    ok("close pending → nothing sent", c.kinds === "");
    closeState = "done";
    c = await cycle();
    const st = await vault.requests(investorAddr);
    ok("close done → markPositionsClosed on-chain", c.kinds.startsWith("markPositionsClosed") && Number(st.state) === 2, c.r.plan);
    c = await cycle();
    ok("100.9 owed, 19.78 in vault → LIQUIDITY_SHORTFALL", alerts.includes("LIQUIDITY_SHORTFALL") && !c.kinds.includes("settle"), c.r.plan);

    // operator withdraws from the venue → USDG lands in wallet B (Lighter withdraw)
    await (await usdg.mint(tradingAddr, U(2))).wait(); // the 2 USDG trading gain, realised
    await (await (usdg.connect(trading) as Contract).transfer(operatorAddr, U(81.12))).wait();
    venueEquity = 0n;
    c = await cycle();
    ok("money in wallet B, auto-fund off → NAV drop is held, not reported", c.kinds === "" && (await reported()) === U(100.9), c.r.plan);
    op = createOperator({ dir, vault: chain, venue, close, cfg: { ...cfg, autoFundFromOperatorWallet: true }, live: true, onAlert: (a) => alerts.push(a.code) });
    c = await cycle();
    const st2 = await vault.requests(investorAddr);
    ok("auto-fund on → fundVault 81.12 + settle 100.9", c.kinds === "fundVault,settleWithdrawal" && Number(st2.state) === 3 && c.sent.every((s) => !s.error), c.r);
    const before = (await usdg.balanceOf(investorAddr)) as bigint;
    await (await asInv(vault).claim()).wait();
    const got = ((await usdg.balanceOf(investorAddr)) as bigint) - before;
    ok("investor claims 100.9 − (1% + 0.1) = 99.791 USDG", got === U(99.791), got.toString());
    ok("fee recipient got deposit + withdrawal fees (1.1 + 1.109)", ((await usdg.balanceOf(feeAddr)) as bigint) === U(2.209));
    c = await cycle();
    ok("empty vault afterwards → steady", c.kinds === "" && (await reported()) === 0n && (await vault.totalShares()) === 0n, c.r.plan);

    let reason = "";
    try {
      await chain.send({ kind: "settleWithdrawal", investor: investorAddr, netAssets: 1n, reason: "test" });
    } catch (e) {
      reason = (e as Error).message;
    }
    ok("reverts decoded into the custom error name", reason === "vault reverted: WrongState()", reason);
    const stranger = createChainPort({ rpcUrl: "", vault: vaultAddr, privateKey: HH_KEYS[3], provider });
    ok("non-operator wallet detected at boot", ((await stranger.checkRole()) ?? "").includes("is not the vault operator"));
    const journal = fs.readFileSync(path.join(dir, "operator.jsonl"), "utf8");
    ok("journal records plans, sends and transit", ["plan", "action_done", "transit_open", "transit_closed"].every((t) => journal.includes(`"type":"${t}"`)));
    ok("vault ABI covers every operator write", ["reportNav", "markPositionsClosed", "settleWithdrawal", "allocateToVenue"].every((f) => VAULT_ABI.some((s) => s.includes(`function ${f}(`))));
  } finally {
    if (node.pid) {
      try {
        if (process.platform === "win32") node.kill();
        else process.kill(-node.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
}

// ── MONITOR_TARGETS parsing (what people really type into .env) ──
{
  const t = (raw: string | undefined) => parseTargets(raw);
  const std = t("operator=http://127.0.0.1:4014,indexer=http://127.0.0.1:4016/");
  ok("targets: name=url pairs, trailing slash dropped", JSON.stringify(std.targets) === JSON.stringify([{ name: "operator", url: "http://127.0.0.1:4014" }, { name: "indexer", url: "http://127.0.0.1:4016" }]) && std.problems.length === 0, std);
  const names = t("operator,indexer");
  ok("targets: bare known names map to their ports", names.targets.map((x) => x.url).join() === "http://127.0.0.1:4014,http://127.0.0.1:4016", names);
  const loose = t('"operator: http://127.0.0.1:4014 ; http://127.0.0.1:4016"');
  ok("targets: quotes, colon, ; separator, bare URL named by port", loose.targets.map((x) => `${x.name}@${x.url}`).join() === "operator@http://127.0.0.1:4014,indexer@http://127.0.0.1:4016", loose);
  const bad = t("operator=http://127.0.0.1:4014,whatever");
  ok("targets: junk entry reported, not a crash", bad.targets.length === 1 && bad.problems.length === 1 && bad.problems[0].includes("whatever"), bad);
  ok("targets: empty → default execution plane + operator", t("").targets.map((x) => x.name).join() === "execution,risk,signer,exchange,operator" && t(undefined).targets.length === 5);
}

(async () => {
  unitPlan();
  await unitAlerts();
  await unitMonitor();
  await unitClosePort();
  unitRiskExit();
  if (process.env.OPERATOR_LIVE_TEST !== "0") await live();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) console.log(`failed: ${fails.join(" | ")}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
