/**
 * Indexer summary (package 3.6): pure replay of vault events + USDG transfers.
 *   npx tsx tests/services/indexer.test.ts
 */
import { buildSummary, type IndexedEvent, type TransferOut } from "../../services/indexer/summary";
import { mergeChainActivity } from "../../src/lib/chainActivity";
import type { LedgerRow } from "../../src/lib/types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}
const U = (n: number) => String(Math.round(n * 1e6));
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const FEE = "0x00000000000000000000000000000000000000fe";
const TRADE = "0x00000000000000000000000000000000000000c3";
let li = 0;
const ev = (event: string, block: number, args: Record<string, string>, ts = 1_000 + block * 10): IndexedEvent => ({ event, blockNumber: block, txHash: `0x${block.toString(16).padStart(64, "0")}`, logIndex: li++, ts, args });
const tr = (to: string, value: string, block: number): TransferOut => ({ to, value, blockNumber: block, txHash: "0x" + "1".repeat(64), logIndex: li++ });

/* empty vault */
{
  const s = buildSummary({ vault: "0xv", lastBlock: 10, events: [], transfers: [] });
  check("empty: NAV 1.0, return 0, no investors", s.navPerShare === 1 && s.returnPct === 0 && s.investors.total === 0 && s.navSeries.length === 0);
  check("empty: no inception date", s.inception === null && s.asOf === null);
}

/* the operator live-test scenario: deposit 100 → NAV 98.9 → +2 → settle all */
{
  const events = [
    ev("NavReported", 1, { previousAssets: "0", newAssets: "0", at: "1010" }),
    ev("Deposit", 2, { investor: A, assetsIn: U(100), fee: U(1.1), shares: U(98.9) }),
    ev("NavReported", 3, { previousAssets: U(98.9), newAssets: U(98.9), at: "1030" }),
    ev("AllocatedToVenue", 4, { to: TRADE, amount: U(79.12) }),
    ev("NavReported", 5, { previousAssets: U(98.9), newAssets: U(100.9), at: "1050" }),
    ev("WithdrawalRequested", 6, { investor: A, shares: U(98.9), at: "1060" }),
    ev("PositionsClosed", 7, { investor: A }),
  ];
  const mid = buildSummary({ vault: "0xv", lastBlock: 7, events, transfers: [], feeRecipient: FEE, tradingAccount: TRADE });
  check("pending request tracked through PositionsClosed → Settling", mid.pendingWithdrawals.length === 1 && mid.pendingWithdrawals[0].state === "Settling", mid.pendingWithdrawals);
  check("holder with a pending request still counted", mid.investors.holding === 1, mid.investors);

  events.push(ev("WithdrawalSettled", 8, { investor: A, netAssets: U(99.791) }), ev("WithdrawalClaimed", 9, { investor: A, assets: U(99.791) }));
  const transfers = [tr(FEE, U(1.1), 2), tr(TRADE, U(79.12), 4), tr(FEE, U(1.109), 8), tr(A, U(99.791), 9)];
  const s = buildSummary({ vault: "0xv", chainId: 46630, lastBlock: 9, events, transfers, feeRecipient: FEE, tradingAccount: TRADE });

  check("NAV series = one point per report", s.navSeries.length === 3, s.navSeries);
  check("empty-vault report prices at 1.0", s.navSeries[0].navPerShare === 1);
  check("NAV after deposit report = 1.0 (98.9 / 98.9)", Math.abs(s.navSeries[1].navPerShare - 1) < 1e-12, s.navSeries[1]);
  check("NAV after +2 = 100.9 / 98.9", Math.abs(s.navSeries[2].navPerShare - 100.9 / 98.9) < 1e-9, s.navSeries[2]);
  check("return since inception from share price", Math.abs(s.returnPct - (100.9 / 98.9 - 1) * 100) < 1e-6, s.returnPct);
  check("no drawdown on a rising series", s.maxDrawdownPct === 0);
  check("total shares replayed back to 0 after settle", s.totalShares === "0", s.totalShares);
  check("deposit fees from Deposit.fee", s.totals.depositFees === U(1.1));
  check("treasury fees = transfers to fee recipient", s.totals.feesToTreasury === U(2.209), s.totals);
  check("withdrawal fees = treasury − deposit fees", s.totals.withdrawalFees === U(1.109), s.totals);
  check("allocation from AllocatedToVenue / transfers", s.totals.allocatedToVenue === U(79.12));
  check("claims and settlements summed", s.totals.claimed === U(99.791) && s.totals.settledToInvestors === U(99.791));
  check("investor counted once, none holding", s.investors.total === 1 && s.investors.holding === 0, s.investors);
  check("counts", JSON.stringify(s.counts) === JSON.stringify({ deposits: 1, withdrawalsRequested: 1, withdrawalsSettled: 1, claims: 1, navReports: 3 }), s.counts);
  check("inception = first deposit time", s.inception === 1_000 + 2 * 10);
  check("recent: newest first with tx hash", s.recent[0].type === "WithdrawalClaimed" && s.recent[0].txHash.startsWith("0x") && s.recent.length === events.length);
  check("chain id passed through", s.chainId === 46630);
}

/* drawdown, two investors, out-of-order input */
{
  const events = [
    ev("NavReported", 40, { previousAssets: U(220), newAssets: U(176), at: "0" }), // 0.8
    ev("Deposit", 10, { investor: A, assetsIn: U(101.1), fee: U(1.1), shares: U(100) }),
    ev("Deposit", 11, { investor: B, assetsIn: U(101.1), fee: U(1.1), shares: U(100) }),
    ev("NavReported", 20, { previousAssets: U(200), newAssets: U(240), at: "0" }), // 1.2
    ev("NavReported", 30, { previousAssets: U(240), newAssets: U(220), at: "0" }), // 1.1
    ev("WithdrawalRequested", 35, { investor: B, shares: U(100), at: "0" }),
  ];
  const s = buildSummary({ vault: "0xv", lastBlock: 40, events, transfers: [] });
  check("events sorted by block before replay", s.navSeries.map((p) => p.block).join() === "20,30,40", s.navSeries);
  check("pending shares still priced until settled", Math.abs(s.navPerShare - 0.88) < 1e-9, s.navPerShare);
  check("max drawdown from the peak (1.2 → 0.88)", Math.abs(s.maxDrawdownPct - ((1.2 - 0.88) / 1.2) * 100) < 1e-6, s.maxDrawdownPct);
  check("negative return reported honestly", s.returnPct < 0);
  check("two investors, both still exposed", s.investors.total === 2 && s.investors.holding === 2, s.investors);
}

/* events without a timestamp never enter the dated series */
{
  const e = ev("NavReported", 5, { previousAssets: "0", newAssets: "0", at: "0" });
  delete e.ts;
  const s = buildSummary({ vault: "0xv", lastBlock: 5, events: [e], transfers: [] });
  check("undated report not plotted", s.navSeries.length === 0 && s.counts.navReports === 1);
}

/* portfolio ledger backfill from an investor's indexed events (real 46630 shape) */
{
  const inv = "0x141DB8c1C42B0fa5b13eE17136e4E037597886a8";
  const E = (event: string, blockNumber: number, txHash: string, args: Record<string, string>) => ({ event, blockNumber, txHash, logIndex: 0, ts: 1794180000 + blockNumber - 150590000, args: { investor: inv, ...args } });
  const events = [
    E("Deposit", 150590385, "0xdep", { assetsIn: "10000000", fee: "200000", shares: "9800000" }),
    E("WithdrawalRequested", 150590456, "0xreq", { shares: "9800000", at: "1" }),
    E("PositionsClosed", 150590827, "0xclose", {}),
    E("WithdrawalSettled", 150590871, "0xsettle", { netAssets: "9602000" }),
    E("WithdrawalClaimed", 150590945, "0xclaim", { assets: "9602000" }),
  ];
  // this device recorded the deposit and the request, but never the claim
  const ledger: LedgerRow[] = [
    { id: "r", ts: "2026-11-08T23:22:10Z", kind: "withdrawal_request", label: "Withdrawal requested · 9.8 shares", amountUsd: 9.6, state: "pending", txHash: "0xREQ" },
    { id: "d", ts: "2026-11-08T23:21:50Z", kind: "deposit", label: "Deposited 10 USDG", amountUsd: 10, state: "settled", txHash: "0xDEP" },
    { id: "p", ts: "2026-11-01T00:00:00Z", kind: "pnl", label: "practice", amountUsd: 1, state: "settled" },
  ];
  const r = mergeChainActivity(ledger, events);
  const claim = r.ledger.find((l) => l.txHash === "0xclaim");
  check("missing claim added with its tx hash and amount", r.added === 1 && !!claim && claim.amountUsd === 9.602 && claim.kind === "withdrawal_claim", r.ledger);
  check("claimed request no longer pending", r.updated === 1 && r.ledger.find((l) => l.id === "r")?.state === "settled");
  check("rows already recorded are not duplicated (hash case-insensitive)", r.ledger.filter((l) => l.txHash?.toLowerCase() === "0xdep").length === 1);
  check("close/settle events are not ledger rows; practice rows kept", r.ledger.length === 4 && r.ledger.some((l) => l.id === "p"));
  check("idempotent", (() => { const again = mergeChainActivity(r.ledger, events); return again.added === 0 && again.updated === 0 && again.ledger === r.ledger; })());

  const empty = mergeChainActivity([], events);
  const req = empty.ledger.find((l) => l.kind === "withdrawal_request");
  check("fresh device: full history from the chain", empty.added === 3 && req?.amountUsd === 9.602 && req.state === "settled", empty.ledger);
  const open = mergeChainActivity([], events.slice(0, 2));
  check("open request stays pending with no invented amount", open.ledger.find((l) => l.kind === "withdrawal_request")?.state === "pending" && open.ledger.find((l) => l.kind === "withdrawal_request")?.amountUsd === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
