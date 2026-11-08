/* eslint-disable @typescript-eslint/no-explicit-any -- rehearsal harness: heterogeneous chain/contract JSON */
/**
 * End-to-end rehearsal: deposit → trade → withdraw, with the pause isolation
 * property proven on-chain against freshly deployed contracts on the local EVM.
 *
 * What this proves, in one run:
 *   1. Deposit: a real tx mints vault shares; the indexer reports the Deposit
 *      event decoded from chain logs (not from our own writes).
 *   2. Trade under pause: with new risk paused, an intent is held and NOT sent
 *      to the venue — and while it is held, the vault ledger is untouched:
 *      reportedAssets unchanged, no NavReported event, no position on the venue.
 *   3. Trade on resume: the same intent executes; venue holds exactly one
 *      position; the vault still shows no automatic NAV change — P&L lands only
 *      through an operator reportNav, i.e. trading never silently moves funds.
 *   4. Withdraw: request → close → settle → claim returns assets to the
 *      investor's wallet, each step indexed from chain events.
 *
 * Usage (local EVM on :8545 must be running):
 *   pnpm rehearse:e2e   (= node scripts/hardhat.mjs run scripts/e2e-rehearsal.ts --network localhost)
 *
 * Services (execution/exchange/risk/signer/indexer) are spawned on isolated
 * rehearsal ports with their own state dir, so this never touches the dev ring.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { ethers } from "hardhat";

const USDG = (n: number | string) => ethers.parseUnits(String(n), 6);
const PORTS = { execution: 4310, exchange: 4311, risk: 4312, signer: 4313, indexer: 4314 };
const ENV_FOR_PORT: Record<string, string> = {
  execution: "EXEC_PORT",
  exchange: "EXCHANGE_PORT",
  risk: "RISK_PORT",
  signer: "SIGNER_PORT",
  indexer: "INDEXER_PORT",
};
const ENTRY: Record<string, string> = {
  execution: "services/execution/main.ts",
  exchange: "services/exchange/main.ts",
  risk: "services/risk/main.ts",
  signer: "services/signer/main.ts",
  indexer: "services/indexer/main.ts",
};
const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".covar-state-e2e");
const TSX = process.platform === "win32" ? "npx.cmd" : "npx";

let passed = 0;
let failed = 0;
const report: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = "") {
  report.push({ name, ok, detail });
  if (ok) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const base = (svc: keyof typeof PORTS) => `http://127.0.0.1:${PORTS[svc]}`;

async function json<T>(svc: keyof typeof PORTS, pathname: string): Promise<T> {
  const res = await fetch(`${base(svc)}${pathname}`, { signal: AbortSignal.timeout(8000) });
  return (await res.json()) as T;
}

async function post(svc: keyof typeof PORTS, pathname: string, body: unknown) {
  const res = await fetch(`${base(svc)}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const children: ChildProcess[] = [];
function start(svc: keyof typeof PORTS, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ENV_FOR_PORT[svc]]: String(PORTS[svc]),
    RISK_URL: "http://127.0.0.1:4312",
    SIGNER_URL: "http://127.0.0.1:4313",
    EXCHANGE_URL: "http://127.0.0.1:4311",
    COVAR_STATE_DIR: STATE_DIR,
    EXCHANGE_FILL_DELAY: "1",
    ...extraEnv,
  };
  const child = spawn(TSX, ["tsx", ENTRY[svc]], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stderr?.on("data", (d) => process.stdout.write(`  [${svc}] ${String(d).trim()}\n`));
  children.push(child);
  return child;
}

function killAll() {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
    } catch {
      try {
        c.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

async function waitHealth(svc: keyof typeof PORTS, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const h = await json<{ ok?: boolean }>(svc, "/health");
      if (h && ("ok" in h)) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${svc} never became healthy on :${PORTS[svc]}`);
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, label: string): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`  (timeout waiting for: ${label})`);
  return false;
}

async function waitExit(child: ChildProcess, timeoutMs = 15_000): Promise<number | null> {
  return Promise.race([
    new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code ?? null))),
    new Promise<number | null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function main() {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  console.log(`\nCovar end-to-end rehearsal (deposit → trade → withdraw)\nstate dir: ${STATE_DIR}\n`);

  /* ----------------------------- 1 · contracts ----------------------------- */
  console.log("1. deploy MockUSDG + CovarVault on the local EVM");
  const [, operator, feeRecipient, investor] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDG");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  const Vault = await ethers.getContractFactory("CovarVault");
  const vault = await Vault.deploy(tokenAddress, feeRecipient.address, operator.address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`  vault ${vaultAddress} · asset ${tokenAddress}`);

  await token.mint(investor.address, USDG(5_000));
  await token.connect(investor).approve(vaultAddress, ethers.MaxUint256);
  const investorBefore = await token.balanceOf(investor.address);

  /* ------------------------------ 2 · indexer ------------------------------ */
  console.log("\n2. start the vault indexer against this deployment");
  fs.writeFileSync(
    path.join(ROOT, "deployments", "31337-e2e.json"),
    JSON.stringify({ chainId: 31337, contract: "CovarVault", address: vaultAddress, asset: tokenAddress }, null, 2)
  );
  start("indexer", { INDEXER_VAULT_ADDRESS: vaultAddress, INDEXER_RPC_URL: "http://127.0.0.1:8545" });
  await waitHealth("indexer");
  check("indexer healthy and pointed at the fresh vault", true, vaultAddress);

  /* ------------------------------- 3 · deposit ----------------------------- */
  console.log("\n3. investor deposits 2,000 USDG (real transaction)");
  // Local chain only: lift the v2 launch limits so the rehearsal can use 2,000 USDG. Testnet/mainnet keep the defaults.
  await (await vault.setLimits(USDG(1_000_000), USDG(100_000))).wait();
  await (await vault.connect(operator).reportNav(USDG(0))).wait();
  const depositTx = await vault.connect(investor).deposit(USDG(2_000));
  const depositRc = await depositTx.wait();
  const shares = await vault.balanceOf(investor.address);
  check("deposit minted shares", shares > 0n, `shares: ${ethers.formatUnits(shares, 6)} · tx ${depositRc?.hash.slice(0, 18)}…`);

  const indexedDeposit = await waitFor(async () => {
    const { events } = await json<{ events: { event: string; txHash: string }[] }>("indexer", "/events");
    return events.some((e) => e.event === "Deposit" && e.txHash === depositTx.hash);
  }, 15_000, "Deposit event in /events");
  check("indexer reported the Deposit from chain logs", indexedDeposit);

  /* ------------------------------ 4 · services ----------------------------- */
  console.log("\n4. start rehearsal execution plane (4310–4313)");
  start("exchange");
  start("risk");
  start("signer");
  await Promise.all([waitHealth("exchange"), waitHealth("risk"), waitHealth("signer")]);
  await post("risk", "/equity", { equity: 50_000 });
  let execChild = start("execution");
  await waitHealth("execution");
  check("execution plane healthy on rehearsal ports", true);

  const assetsAtDeposit = await vault.reportedAssets();

  /* ----------------------- 5 · trade under pause (held) --------------------- */
  console.log("\n5. operator pauses new risk; an entry intent is held — and the vault is untouched");
  await post("execution", "/pause", { paused: true });
  const intent = {
    intentId: "intent-e2e-pause-0001",
    agentId: "ag-01",
    market: "ETH-PERP",
    side: "buy" as const,
    qty: 0.5,
    price: 3200,
    reduceOnly: false,
    leverage: 2,
    strategyVersion: 3,
    proposedBy: "rules" as const,
    copilotDecision: "rules_only" as const,
    createdAt: new Date().toISOString(),
  };
  const held = await post("execution", "/intents", { intent });
  const heldOrder = (held.body as any)?.order;
  check("the intent was accepted but held, not traded", !!heldOrder && heldOrder.status !== "filled", `status: ${heldOrder?.status}`);

  // let a few venue ticks pass — a leak would show up here
  await new Promise((r) => setTimeout(r, 3_000));
  const positionsWhilePaused = await json<{ market: string; qty: number }[]>("exchange", "/positions");
  check("no position opened while paused", positionsWhilePaused.length === 0, `venue positions: ${positionsWhilePaused.length}`);

  const assetsWhilePaused = await vault.reportedAssets();
  check("vault reportedAssets unchanged while the trade was held", assetsWhilePaused === assetsAtDeposit, `${ethers.formatUnits(assetsWhilePaused, 6)} USDG`);

  const navEventsDuringPause = await json<{ events: { event: string }[] }>("indexer", "/events").then((r) => r.events.filter((e) => e.event === "NavReported").length);
  check("no NAV change event while the order was held (funds/P&L untouched)", navEventsDuringPause === 1, `NavReported events: ${navEventsDuringPause} (the single pre-deposit report)`);

  /* ------------------------- 6 · resume: trade happens ---------------------- */
  console.log("\n6. operator resumes; the held intent executes exactly once");
  await post("execution", "/pause", { paused: false });
  const filled = await waitFor(async () => {
    const st = await json<any>("execution", "/state").catch(() => null);
    const o = st?.execution?.orders?.find?.((x: any) => x.clientOrderId === `c-${intent.intentId}`);
    return o?.status === "filled";
  }, 20_000, "order filled");
  check("the held order filled after resume", filled);

  const positions = await json<{ market: string; qty: number }[]>("exchange", "/positions");
  const pos = positions.find((p) => p.market === "ETH-PERP");
  check("venue position is exactly one 0.5 lot", pos?.qty === 0.5, `qty: ${pos?.qty ?? "—"}`);

  const assetsAfterTrade = await vault.reportedAssets();
  check("vault reportedAssets still unchanged after the fill (no silent NAV write)", assetsAfterTrade === assetsAtDeposit);

  /* ----------------------------- 7 · withdrawal ---------------------------- */
  console.log("\n7. investor withdraws: request → close → settle → claim");
  await (await vault.connect(investor).requestWithdrawal(shares / 2n)).wait();
  await (await vault.connect(operator).markPositionsClosed(investor.address)).wait();
  const req = await vault.requests(investor.address);
  const gross = await vault.convertToAssets(req.shares);
  await (await vault.connect(operator).settleWithdrawal(investor.address, gross)).wait();
  await (await vault.connect(investor).claim()).wait();
  const expectedFee = (gross * 100n) / 10_000n + USDG(0.1);
  console.log(`  gross ${ethers.formatUnits(gross, 6)} USDG · fee ${ethers.formatUnits(expectedFee, 6)} (1% + 0.10) · investor claims ${ethers.formatUnits(gross - expectedFee, 6)}`);

  const investorAfter = await token.balanceOf(investor.address);
  check("investor received USDG back", investorAfter > investorBefore - USDG(2_000), `net change: ${ethers.formatUnits(investorAfter - investorBefore, 6)} USDG`);

  for (const ev of ["WithdrawalRequested", "PositionsClosed", "WithdrawalSettled", "WithdrawalClaimed"]) {
    const seen = await waitFor(async () => {
      const r = await json<{ events: { event: string }[] }>("indexer", "/events");
      return r.events.some((e) => e.event === ev);
    }, 15_000, `${ev} in /events`);
    check(`indexer saw ${ev} (from chain logs)`, seen);
  }

  // 3.6: the summary Discover/treasury read must match the chain exactly
  type Summary = { ok: boolean; totals: { feesToTreasury: string; depositFees: string; claimed: string }; counts: { deposits: number; claims: number; navReports: number }; investors: { total: number }; navSeries: unknown[]; live: { navPerShare: number | null } };
  const feeBal = await token.balanceOf(feeRecipient.address);
  let summary: Summary | null = null;
  await waitFor(async () => {
    summary = await json<Summary>("indexer", "/summary");
    return summary.ok && BigInt(summary.totals.feesToTreasury) === feeBal;
  }, 15_000, "summary fees");
  const sm = summary as Summary | null;
  check("indexer summary: treasury fees == fee recipient USDG balance", !!sm && BigInt(sm.totals.feesToTreasury) === feeBal, `${sm?.totals.feesToTreasury} vs ${feeBal}`);
  check("indexer summary: counts and investor from chain logs", !!sm && sm.counts.deposits >= 1 && sm.counts.claims === 1 && sm.investors.total === 1 && sm.navSeries.length === sm.counts.navReports, sm?.counts);
  check("indexer summary: live NAV/share read from the contract", !!sm && sm.live.navPerShare !== null, sm?.live);

  /* ------------------------------- 8 · crash ------------------------------- */
  console.log("\n8. crash-recovery on the same rehearsal ring (the venue adapter seam keeps this honest end-to-end)");
  try {
    if (execChild.pid) process.kill(-execChild.pid, "SIGTERM");
  } catch {
    execChild.kill("SIGKILL");
  }
  await waitExit(execChild, 8_000);
  await new Promise((r) => setTimeout(r, 600));
  execChild = spawn(TSX, ["tsx", ENTRY.execution], {
    cwd: ROOT,
    env: {
      ...process.env,
      EXEC_PORT: String(PORTS.execution),
      RISK_URL: "http://127.0.0.1:4312",
      SIGNER_URL: "http://127.0.0.1:4313",
      EXCHANGE_URL: "http://127.0.0.1:4311",
      COVAR_STATE_DIR: STATE_DIR,
      EXEC_FAULT_CRASH_AFTER_ACK: "yes",
      VENUE_ADAPTER: "paper",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(execChild);
  const crashIntent = { ...intent, intentId: "intent-e2e-crash-0002" };
  await waitHealth("execution").catch(() => null);
  await post("execution", "/intents", { intent: crashIntent }).catch(() => null);
  const exitCode = await waitExit(execChild);
  check("execution died after the venue ack (real process death)", exitCode !== null && exitCode !== 0, `exit ${exitCode}`);

  start("execution");
  await waitHealth("execution");
  const rec = await post("execution", "/recover", {});
  const recAdopted = ((rec.body as any)?.adopted ?? []) as string[];
  const recResubmitted = ((rec.body as any)?.resubmitted ?? []) as string[];
  await new Promise((r) => setTimeout(r, 800));
  const journal = await json<{ type: string; payload?: Record<string, unknown> }[]>("execution", "/journal").catch(() => [] as never);
  const adoptedInJournal = Array.isArray(journal) && journal.some((e) => e.type === "recovered_adopted" && e.payload?.clientOrderId === `c-${crashIntent.intentId}`);
  check(
    "recovery adopted the in-flight order without resubmitting",
    (recAdopted.includes(`c-${crashIntent.intentId}`) || adoptedInJournal) && recResubmitted.length === 0,
    `report adopted ${JSON.stringify(recAdopted)} · journal adoption ${adoptedInJournal} · resubmitted ${JSON.stringify(recResubmitted)}`
  );
  const venueJournal = await json<{ type: string }[]>("exchange", "/journal").catch(() => [] as never);
  const accepts = Array.isArray(venueJournal) ? venueJournal.filter((e) => e.type === "order_accepted").length : -1;
  check("venue accepted exactly two orders across the whole rehearsal (no duplicates)", accepts === 2, `order_accepted events: ${accepts}`);

  /* --------------------------------- report -------------------------------- */
  const reportPath = path.join(ROOT, "docs", "rehearsals", `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        chainId: 31337,
        vault: vaultAddress,
        asset: tokenAddress,
        labels: {
          venue: "paper venue (simulated fills) — the live Lighter adapter is selected only with VENUE_ADAPTER=live + LIVE_TRADING_CONFIRM=yes",
          chain: "local hardhat EVM — not Robinhood Chain",
          tokens: "MockUSDG — must never leave the sandbox",
        },
        checks: report,
        passed,
        failed,
      },
      null,
      2
    )
  );
  console.log(`\n${passed} passed, ${failed} failed — report: ${path.relative(ROOT, reportPath)}`);
}

main()
  .then(() => {
    killAll();
    setTimeout(() => process.exit(failed === 0 ? 0 : 1), 800);
  })
  .catch((err) => {
    console.error("\nrehearsal aborted:", err);
    killAll();
    setTimeout(() => process.exit(1), 800);
  });
