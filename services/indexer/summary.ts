/**
 * Pure vault summary from indexed chain data (package 3.6).
 *
 * Input: decoded vault events + USDG transfers OUT of the vault, each with its
 * block timestamp. Output: what Discover, the agent record and the treasury
 * page show. Every figure is derived from those logs. Nothing is estimated.
 *
 *   NAV per share at each NavReported = newAssets / totalShares(at that point),
 *   where totalShares is replayed exactly from Deposit.shares (+) and the shares
 *   of each settled request (−). Deposits and settlements mint/burn at NAV, so
 *   they do not move NAV per share; the reports are the price series.
 *
 *   Fees = USDG the vault transferred to the fee recipient (exact), split into
 *   deposit fees (Deposit.fee) and withdrawal fees (the remainder).
 */
export interface IndexedEvent {
  event: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  ts?: number; // block timestamp (s)
  args: Record<string, string>;
}

export interface TransferOut {
  to: string;
  value: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  ts?: number;
}

export interface VaultSummary {
  vault: string;
  chainId: number | null;
  lastBlock: number;
  asOf: number | null;
  inception: number | null;
  navSeries: { t: number; block: number; navPerShare: number; assets: string }[];
  navPerShare: number;
  returnPct: number;
  maxDrawdownPct: number;
  reportedAssets: string;
  totalShares: string;
  investors: { total: number; holding: number };
  totals: {
    depositsGross: string;
    depositFees: string;
    withdrawalFees: string;
    feesToTreasury: string;
    settledToInvestors: string;
    claimed: string;
    allocatedToVenue: string;
  };
  counts: { deposits: number; withdrawalsRequested: number; withdrawalsSettled: number; claims: number; navReports: number };
  pendingWithdrawals: { investor: string; shares: string; state: "ClosingPositions" | "Settling" }[];
  recent: { type: string; t: number | null; block: number; txHash: string; investor?: string; amount?: string; shares?: string }[];
  /** each USDG transfer from the vault to the fee recipient, newest first (last 50) */
  feeReceipts: { t: number | null; block: number; txHash: string; amount: string; kind: "deposit" | "withdrawal" }[];
}

const order = (a: { blockNumber: number; logIndex: number }, b: { blockNumber: number; logIndex: number }) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
const big = (s: string | undefined) => BigInt(s ?? "0");

export function buildSummary(input: {
  vault: string;
  chainId?: number | null;
  lastBlock: number;
  events: IndexedEvent[];
  transfers: TransferOut[];
  feeRecipient?: string | null;
  tradingAccount?: string | null;
}): VaultSummary {
  const events = [...input.events].sort(order);
  let totalShares = 0n;
  let reportedAssets = 0n;
  const balances = new Map<string, bigint>();
  const pending = new Map<string, { shares: bigint; state: "ClosingPositions" | "Settling" }>();
  const depositors = new Set<string>();
  const navSeries: VaultSummary["navSeries"] = [];
  const c = { deposits: 0, withdrawalsRequested: 0, withdrawalsSettled: 0, claims: 0, navReports: 0 };
  let depositsGross = 0n;
  let depositFees = 0n;
  let settled = 0n;
  let claimed = 0n;
  let allocatedEv = 0n;

  for (const e of events) {
    const who = (e.args.investor ?? "").toLowerCase();
    switch (e.event) {
      case "Deposit": {
        const shares = big(e.args.shares);
        const net = big(e.args.assetsIn) - big(e.args.fee);
        totalShares += shares;
        reportedAssets += net;
        balances.set(who, (balances.get(who) ?? 0n) + shares);
        depositors.add(who);
        depositsGross += big(e.args.assetsIn);
        depositFees += big(e.args.fee);
        c.deposits++;
        break;
      }
      case "WithdrawalRequested": {
        const shares = big(e.args.shares);
        balances.set(who, (balances.get(who) ?? 0n) - shares);
        pending.set(who, { shares, state: "ClosingPositions" });
        c.withdrawalsRequested++;
        break;
      }
      case "PositionsClosed": {
        const p = pending.get(who);
        if (p) p.state = "Settling";
        break;
      }
      case "WithdrawalSettled": {
        const p = pending.get(who);
        if (p) totalShares -= p.shares;
        pending.delete(who);
        settled += big(e.args.netAssets);
        c.withdrawalsSettled++;
        break;
      }
      case "WithdrawalClaimed":
        claimed += big(e.args.assets);
        c.claims++;
        break;
      case "NavReported": {
        reportedAssets = big(e.args.newAssets);
        c.navReports++;
        const nav = totalShares === 0n ? 1 : Number((reportedAssets * 10n ** 18n) / totalShares) / 1e18;
        if (e.ts !== undefined) navSeries.push({ t: e.ts, block: e.blockNumber, navPerShare: nav, assets: reportedAssets.toString() });
        break;
      }
      case "AllocatedToVenue":
        allocatedEv += big(e.args.amount);
        break;
    }
  }

  const fee = (input.feeRecipient ?? "").toLowerCase();
  const trading = (input.tradingAccount ?? "").toLowerCase();
  let feesToTreasury = 0n;
  let allocatedTx = 0n;
  for (const t of input.transfers) {
    if (fee && t.to.toLowerCase() === fee) feesToTreasury += big(t.value);
    else if (trading && t.to.toLowerCase() === trading) allocatedTx += big(t.value);
  }
  const withdrawalFees = feesToTreasury > depositFees ? feesToTreasury - depositFees : 0n;

  // itemised receipts: a fee transfer in the same transaction as a Deposit event is a deposit fee,
  // anything else the vault sends the fee recipient is charged at settlement (withdrawal fee)
  const depositTxs = new Set(events.filter((e) => e.event === "Deposit").map((e) => e.txHash.toLowerCase()));
  const feeReceipts = fee
    ? [...input.transfers]
        .filter((t) => t.to.toLowerCase() === fee)
        .sort(order)
        .slice(-50)
        .reverse()
        .map((t) => ({
          t: t.ts ?? null,
          block: t.blockNumber,
          txHash: t.txHash,
          amount: big(t.value).toString(),
          kind: (depositTxs.has(t.txHash.toLowerCase()) ? "deposit" : "withdrawal") as "deposit" | "withdrawal",
        }))
    : [];

  // return and drawdown from the share-price series (first deposit mints at 1.0)
  const prices = navSeries.filter((p) => p.navPerShare > 0).map((p) => p.navPerShare);
  const navNow = prices.at(-1) ?? 1;
  let peak = 1;
  let mdd = 0;
  for (const p of prices) {
    peak = Math.max(peak, p);
    mdd = Math.max(mdd, (peak - p) / peak);
  }

  const recent = events
    .slice(-50)
    .reverse()
    .map((e) => ({
      type: e.event,
      t: e.ts ?? null,
      block: e.blockNumber,
      txHash: e.txHash,
      investor: e.args.investor,
      amount: e.args.assetsIn ?? e.args.netAssets ?? e.args.assets ?? e.args.newAssets ?? e.args.amount,
      shares: e.args.shares,
    }));

  const withTs = events.filter((e) => e.ts !== undefined);
  return {
    vault: input.vault,
    chainId: input.chainId ?? null,
    lastBlock: input.lastBlock,
    asOf: withTs.at(-1)?.ts ?? null,
    inception: withTs.find((e) => e.event === "Deposit")?.ts ?? withTs[0]?.ts ?? null,
    navSeries,
    navPerShare: navNow,
    returnPct: (navNow - 1) * 100,
    maxDrawdownPct: mdd * 100,
    reportedAssets: reportedAssets.toString(),
    totalShares: totalShares.toString(),
    investors: { total: depositors.size, holding: [...balances.values()].filter((b) => b > 0n).length + [...pending.keys()].filter((k) => !((balances.get(k) ?? 0n) > 0n)).length },
    totals: {
      depositsGross: depositsGross.toString(),
      depositFees: depositFees.toString(),
      withdrawalFees: withdrawalFees.toString(),
      feesToTreasury: feesToTreasury.toString(),
      settledToInvestors: settled.toString(),
      claimed: claimed.toString(),
      allocatedToVenue: (allocatedEv > allocatedTx ? allocatedEv : allocatedTx).toString(),
    },
    counts: c,
    pendingWithdrawals: [...pending.entries()].map(([investor, p]) => ({ investor, shares: p.shares.toString(), state: p.state })),
    recent,
    feeReceipts,
  };
}
