import type { Agent, Creator, CovarState, Decision, VersionEntry } from "./types";
import { hashSeed, mulberry32 } from "./format";

const iso = (daysAgo: number, h = 0) =>
  new Date(Date.now() - daysAgo * 864e5 - h * 36e5).toISOString();

/** Deterministic equity curve with a target total return and drawdown character. */
function curve(seedKey: string, totalReturnPct: number, n = 120, vol = 0.014): number[] {
  const rnd = mulberry32(hashSeed(seedKey));
  const out: number[] = [100];
  let v = 100;
  const target = 100 + totalReturnPct;
  for (let i = 1; i < n; i++) {
    const remaining = target - v;
    const pull = remaining / (n - i);
    v = v + pull * (0.7 + rnd() * 0.6) + (rnd() - 0.5) * 2 * vol * v * 0.55;
    out.push(v);
  }
  out[out.length - 1] = target;
  return out;
}

function bench(seedKey: string, totalReturnPct: number, n = 120): number[] {
  const rnd = mulberry32(hashSeed(seedKey + "bench"));
  const out: number[] = [100];
  let v = 100;
  const target = 100 + totalReturnPct;
  for (let i = 1; i < n; i++) {
    v = v + (target - v) / (n - i) + (rnd() - 0.5) * 2.1;
    out.push(v);
  }
  out[out.length - 1] = target;
  return out;
}

const decision = (
  id: string,
  daysAgo: number,
  market: string,
  inputs: string,
  proposed: string,
  ai: Decision["aiDecision"],
  risk: Decision["riskDecision"],
  order?: string,
  outcome?: string,
  riskReason?: string
): Decision => ({ id, ts: iso(daysAgo, Math.floor(daysAgo * 3) % 20), market, inputs, proposed, aiDecision: ai, riskDecision: risk, order, outcome, riskReason });

/** Copilot's recorded reason per seeded decision (rules-only rows have none — Copilot was not consulted). */
const AI_REASONS: Record<string, string> = {
  d1: "Negative funding with expanding open interest matches the carry setup; no event risk in the next 8h.",
  d2: "Funding near zero is not an exit signal on its own; holding the existing position.",
  d3: "Fast drop with widening ATR — keep the trade but halve exposure until volatility settles.",
  d4: "Funding flipped positive, which is the published normalisation exit.",
  d5: "Leverage above the published 3x ceiling is outside the strategy; declined.",
  d7: "Oversold at the lower band while the long-term trend is still up — a valid fade entry.",
  d8: "Price has not recovered; adding the full 5% would stack risk, so half size.",
  d9: "RSI back above 60 meets the exit rule.",
  d14: "Trend filters agree and slope is positive; entry allowed at published size.",
  d15: "Signal is valid on the rules, so Copilot approved; the risk service refused on budget.",
  d16: "Funding inversion is the published exit trigger.",
  d17: "Operator flagged an unstable funding regime; pausing new entries is within policy.",
  d18: "Short signal at resistance, but momentum is strong — trimmed size from 10% to 6%.",
};

const HOUR = 36e5;
const NOTICE_HOURS = 48;

interface PendingSeed {
  summary: string;
  /** hours since investors were notified */
  notifiedHoursAgo: number;
  changes: string[];
  positionHandling: string;
}

const versions = (current: number, base: number, summaries: string[], hasInvestors: boolean, pending?: PendingSeed): VersionEntry[] => {
  const out: VersionEntry[] = summaries.map((summary, i) => {
    const ts = iso((summaries.length - i) * 9, 3);
    const isCurrent = base + i === current;
    return {
      version: base + i,
      ts,
      summary,
      status: isCurrent ? "active" : "superseded",
      ...(hasInvestors && i > 0
        ? { noticeAt: new Date(Date.parse(ts) - NOTICE_HOURS * HOUR).toISOString(), effectiveAt: ts }
        : { effectiveAt: ts }),
      notice: isCurrent
        ? hasInvestors && i > 0
          ? "Active version. Investors were notified 48h before activation."
          : "Active version."
        : "Superseded — historical results kept for audit, not recalculated.",
    };
  });
  if (pending) {
    const noticeAt = Date.now() - pending.notifiedHoursAgo * HOUR;
    out.push({
      version: base + summaries.length,
      ts: new Date(noticeAt).toISOString(),
      summary: pending.summary,
      status: "pending_investor_notice",
      noticeAt: new Date(noticeAt).toISOString(),
      effectiveAt: new Date(noticeAt + NOTICE_HOURS * HOUR).toISOString(),
      changes: pending.changes,
      positionHandling: pending.positionHandling,
      notice: "Published with investors in the vault — waits out the 48h notice before it trades.",
    });
  }
  return out;
};

export const creators: Creator[] = [
  { id: "cr-01", handle: "meridian", name: "Meridian Research", joined: iso(420), bio: "Systematic perp basis and trend research. Publishes every version change, including the ones that lost money.", agentIds: ["ag-01", "ag-06"], followers: 1284, verified: true },
  { id: "cr-02", handle: "sagara", name: "Sagara Labs", joined: iso(310), bio: "Mean-reversion on majors. Slow, small, boring by design.", agentIds: ["ag-02", "ag-07"], followers: 640, verified: true },
  { id: "cr-03", handle: "northloop", name: "northloop", joined: iso(190), bio: "Breakout specialist. One strategy family, four markets.", agentIds: ["ag-03", "ag-08"], followers: 312, verified: false },
  { id: "cr-04", handle: "kade", name: "Kade Arsitek", joined: iso(140), bio: "Funding carry with rules-only execution — no Copilot in the loop.", agentIds: ["ag-04"], followers: 178, verified: false },
  { id: "cr-05", handle: "verity", name: "Verity Quant", joined: iso(96), bio: "Momentum with a hard 6% drawdown stop. Publishes the losing month too.", agentIds: ["ag-05", "ag-09"], followers: 902, verified: true },
];

const mk = (
  a: Omit<Agent, "curve" | "benchmark" | "twin" | "versions" | "decisions"> & {
    decisions: Decision[];
    versionSummaries: string[];
    pendingVersion?: PendingSeed;
    twinOffset?: number;
  }
): Agent => {
  const { versionSummaries, pendingVersion, twinOffset, ...rest } = a;
  return {
  ...rest,
  curve: curve(a.id + "c", a.returnPct, 120, a.provenance === "backtest" ? 0.009 : 0.016),
  benchmark: bench(a.id, a.provenance === "backtest" ? a.returnPct * 0.42 : a.returnPct * 0.35),
  twin: curve(a.id + "twin", a.returnPct * (twinOffset ?? 0.86), 120, 0.013),
  decisions: a.decisions.map((d) => ({
    ...d,
    strategyVersion: a.version,
    ...(AI_REASONS[d.id] && d.aiDecision !== "rules_only" ? { aiReason: AI_REASONS[d.id] } : {}),
  })),
  versions: versions(a.version, 1, versionSummaries, !!a.vault, pendingVersion),
  };
};

export const seedAgents: Agent[] = [
  mk({
    id: "ag-01",
    name: "Meridian Basis",
    tagline: "Funding carry on ETH-PERP with rules-only execution and a 4% drawdown stop.",
    creatorId: "cr-01",
    status: "live",
    market: "ETH-PERP",
    timeframe: "1h",
    provenance: "live",
    score: 82,
    tvlUsd: 486_300,
    returnPct: 18.4,
    drawdownPct: -6.2,
    liveAgeDays: 96,
    tradeCount: 214,
    version: 4,
    strategySummary:
      "Enters long when 8h funding is negative and open interest is expanding; exits when funding normalises or the per-trade stop hits. Rules-only twin kept for every session so Copilot decisions can be measured against the raw rules.",
    riskSummary: "3x leverage cap, 25% max position, 2.5% per-trade stop, 7% daily loss pause, 18% drawdown emergency stop.",
    vault: {
      address: "0x7A31c0eB4b2fD9F4aC0e8F2B5b1D7c9E3a4F6B21",
      chain: "robinhood-testnet",
      navPerShare: 1.1842,
      tvlUsd: 486_300,
      sharesOutstanding: 410_600,
      sharePriceHistory: curve("ag-01nav", 18.4, 96, 0.004),
      depositFeePct: 1,
      depositFeeFlat: 0.1,
      pendingDeposits: 12_400,
      pendingWithdrawals: 3_100,
      unwindDays: 2,
    },
    decisions: [
      decision("d1", 0.2, "ETH-PERP", "funding −0.0041%, OI +2.1%, EMA20 > EMA50", "open long 25% of equity @ 3x", "approve", "approved", "filled 0.84 ETH @ 3,178.40", "+$412.90 open", undefined),
      decision("d2", 0.9, "ETH-PERP", "funding −0.0002%, RSI 58", "hold", "approve", "approved", "—", "no action", undefined),
      decision("d3", 1.4, "ETH-PERP", "price −1.9% in 40m, ATR expanding", "reduce size 50%", "reduce", "approved", "reduced to 12.5% exposure", "slippage 3bps", undefined),
      decision("d4", 2.1, "ETH-PERP", "funding +0.011%", "close long", "approve", "approved", "filled @ 3,241.10", "+$289.14 realized", undefined),
      decision("d5", 3.2, "ETH-PERP", "proposed 4x leverage", "raise leverage to 4x", "reject", "rejected", "no order", "blocked", "Above agent ceiling 3x — risk service rejected independently of Copilot."),
      decision("d6", 4.0, "ETH-PERP", "AI provider timeout (302)", "open long", "rules_only", "approved", "filled @ 3,102.55", "+$102.40 realized", "Copilot unavailable — fallback to rules-only per configuration."),
    ],
    versionSummaries: [
      "Initial carry rules, 2x leverage, 12% drawdown stop.",
      "Raised max position to 20%; added funding normalisation exit.",
      "Added drawdown-triggered close-only mode after March gap.",
      "Current: 3x cap, 25% position, rules-only twin per session.",
    ],
    pendingVersion: {
      summary: "Tighter stop and a funding z-score exit.",
      notifiedHoursAgo: 16.5,
      changes: [
        "Per-trade stop 2.5% → 2.0%",
        "New exit: close when 8h funding z-score > +1.5",
        "Max position unchanged at 25%, leverage cap unchanged at 3x",
      ],
      positionHandling:
        "Positions opened under v4 keep v4 exits until they close. From activation, new entries use v5. Investors can withdraw before activation at the normal fee.",
    },
  }),
  mk({
    id: "ag-02",
    name: "Sagara Fade",
    tagline: "Buys panic wicks on BTC-PERP with RSI 32 and lower-band confluence.",
    creatorId: "cr-02",
    status: "live",
    market: "BTC-PERP",
    timeframe: "15m",
    provenance: "live",
    score: 74,
    tvlUsd: 214_900,
    returnPct: 11.2,
    drawdownPct: -9.4,
    liveAgeDays: 51,
    tradeCount: 388,
    version: 2,
    strategySummary:
      "Long only when RSI(14) < 32, price is below the lower Bollinger band and above EMA(200). Exits at RSI 56, band midline, or the stop.",
    riskSummary: "2x leverage, 15% max position, 1.5% stop, 4% daily pause, 10% drawdown stop.",
    vault: {
      address: "0x2C9e5A8dF1b7Ee04C3a6B0d9F7E1a2C4b8D6f0A3",
      chain: "robinhood-testnet",
      navPerShare: 1.1121,
      tvlUsd: 214_900,
      sharesOutstanding: 193_200,
      sharePriceHistory: curve("ag-02nav", 11.2, 51, 0.005),
      depositFeePct: 1,
      depositFeeFlat: 0.1,
      pendingDeposits: 4_800,
      pendingWithdrawals: 900,
      unwindDays: 1,
    },
    decisions: [
      decision("d7", 0.1, "BTC-PERP", "RSI 29.4, close < BB lower, EMA200 slope +", "open long 15%", "approve", "approved", "filled 0.031 BTC @ 95,820", "+$88.10 open"),
      decision("d8", 1.1, "BTC-PERP", "RSI 33, price still under band", "add 5%", "reduce", "approved", "added 2.5%", "within cap after risk trim"),
      decision("d9", 2.6, "BTC-PERP", "RSI 61", "close", "approve", "approved", "filled @ 97,140", "+$164.22 realized"),
    ],
    versionSummaries: ["Initial fade rules at 1.5x.", "Current: 2x cap, RSI 32 (was 28), added band confluence."],
    rulesVisibility: "summary",
  }),
  mk({
    id: "ag-03",
    name: "Northloop Break",
    tagline: "20-bar range breakout on SOL-PERP with volume expansion filter.",
    creatorId: "cr-03",
    status: "practice",
    market: "SOL-PERP",
    timeframe: "1h",
    provenance: "practice",
    score: 61,
    tvlUsd: 0,
    returnPct: 26.8,
    drawdownPct: -14.1,
    liveAgeDays: 22,
    tradeCount: 61,
    version: 1,
    strategySummary:
      "Practice-only run on simulated ticks. Enters long above the 20-bar high with 1.6× volume, exits below EMA(20) or on stop.",
    riskSummary: "4x leverage, 30% max position, 3% stop, 8% daily pause, 20% drawdown stop.",
    disclosure: "Practice run — simulated ticks and simulated fills. Not a real-money record and not comparable to a vault NAV.",
    decisions: [
      decision("d10", 0.3, "SOL-PERP", "close > HH(20), volume 1.9× avg", "open long 30%", "approve", "approved", "simulated fill @ 193.82", "+$141.20 simulated"),
      decision("d11", 1.8, "SOL-PERP", "close < EMA(20)", "close", "approve", "approved", "simulated exit @ 191.40", "−$62.10 simulated"),
    ],
    versionSummaries: ["Initial breakout rules, practice mode only."],
  }),
  mk({
    id: "ag-04",
    name: "Kade Carry",
    tagline: "Delta-neutral funding capture with Copilot disabled entirely.",
    creatorId: "cr-04",
    status: "live",
    market: "USDG-PERP",
    timeframe: "4h",
    provenance: "live",
    score: 69,
    tvlUsd: 97_600,
    returnPct: 6.9,
    drawdownPct: -2.1,
    liveAgeDays: 63,
    tradeCount: 44,
    version: 2,
    strategySummary: "Holds inverse carry only while 8h funding is below −0.004%. No AI in the loop; every action is rules-only and recorded as such.",
    riskSummary: "1x leverage, 60% max position, 0.6% stop, 3% daily pause, 6% drawdown stop.",
    vault: {
      address: "0x9F2b1A7cE4d3B8a05F6c2D9e1A7b3C4d5E6f8091",
      chain: "robinhood-testnet",
      navPerShare: 1.0694,
      tvlUsd: 97_600,
      sharesOutstanding: 91_260,
      sharePriceHistory: curve("ag-04nav", 6.9, 63, 0.002),
      depositFeePct: 1,
      depositFeeFlat: 0.1,
      pendingDeposits: 0,
      pendingWithdrawals: 0,
      unwindDays: 1,
    },
    decisions: [
      decision("d12", 0.5, "USDG-PERP", "funding −0.0052%, OI flat", "hold carry", "rules_only", "approved", "no rebalance", "carry accruing"),
      decision("d13", 3.1, "USDG-PERP", "funding −0.0031%", "reduce to 40%", "rules_only", "approved", "reduce filled", "+$21.60 realized"),
    ],
    versionSummaries: ["Initial carry rules.", "Current: position cap 60% (was 40%), funding threshold widened."],
  }),
  mk({
    id: "ag-05",
    name: "Verity Momentum",
    tagline: "EMA stack momentum on ETH with a hard 6% drawdown stop.",
    creatorId: "cr-05",
    status: "live",
    market: "ETH-PERP",
    timeframe: "4h",
    provenance: "live",
    score: 78,
    tvlUsd: 331_200,
    returnPct: 14.7,
    drawdownPct: -5.8,
    liveAgeDays: 74,
    tradeCount: 96,
    version: 3,
    strategySummary: "Long when EMA(20) crosses above EMA(60), price above EMA(200) and slope positive. Copilot may veto or trim, never add.",
    riskSummary: "3x leverage, 25% position cap, 2% stop, 6% daily pause, 12% drawdown stop (tighter than platform 25%).",
    vault: {
      address: "0x5B8e2F1a9C4d7E3b06A2f5D8c1B4e7A9d2F6c803",
      chain: "robinhood-testnet",
      navPerShare: 1.1468,
      tvlUsd: 331_200,
      sharesOutstanding: 288_900,
      sharePriceHistory: curve("ag-05nav", 14.7, 74, 0.004),
      depositFeePct: 1,
      depositFeeFlat: 0.1,
      pendingDeposits: 9_200,
      pendingWithdrawals: 1_400,
      unwindDays: 2,
    },
    decisions: [
      decision("d14", 0.15, "ETH-PERP", "EMA20 > EMA60, slope +0.4%, RSI 61", "open long 25%", "approve", "approved", "filled @ 3,174.80", "+$298.40 open"),
      decision("d15", 1.2, "ETH-PERP", "realized loss today −4.1%", "open long 25%", "approve", "rejected", "no order", "blocked", "Daily loss pause 6% not yet hit; size would breach remaining daily risk budget after two stops."),
    ],
    versionSummaries: ["Initial momentum rules, 20% position.", "Widened to 25%, added slope filter.", "Current: 3x cap, 12% drawdown stop after April retune."],
  }),
  mk({
    id: "ag-06",
    name: "Meridian Drift",
    tagline: "Slower cousin of Basis: 4h carry with a wider funding window.",
    creatorId: "cr-01",
    status: "paused",
    market: "ETH-PERP",
    timeframe: "4h",
    provenance: "live",
    score: 58,
    tvlUsd: 41_800,
    returnPct: -3.4,
    drawdownPct: -8.9,
    liveAgeDays: 38,
    tradeCount: 27,
    version: 2,
    strategySummary: "Same creator as Meridian Basis, wider entry window. Paused by the operator during a funding inversion; deposits closed, withdrawals open.",
    riskSummary: "2x leverage, 20% position, 2% stop, 5% daily pause, 12% drawdown stop.",
    disclosure: "This agent is currently paused and negative since launch. It is kept public — unsuccessful live records are not hidden.",
    decisions: [
      decision("d16", 2.2, "ETH-PERP", "funding inverted +0.009%", "close", "approve", "approved", "filled", "−$204.10 realized"),
      decision("d17", 4.5, "ETH-PERP", "operator notice: funding regime unstable", "pause new entries", "approve", "approved", "agent paused", "close-only mode"),
    ],
    versionSummaries: ["Initial slow carry.", "Current: paused, close-only."],
  }),
  mk({
    id: "ag-07",
    name: "Sagara Range",
    tagline: "Range fade on HYPE-PERP. Young agent: 9 days live, small size.",
    creatorId: "cr-02",
    status: "live",
    market: "HYPE-PERP",
    timeframe: "15m",
    provenance: "live",
    score: 55,
    tvlUsd: 22_100,
    returnPct: 2.8,
    drawdownPct: -4.6,
    liveAgeDays: 9,
    tradeCount: 58,
    version: 1,
    strategySummary: "Short-lived record. Live age 9 days — treat any annualised figure as statistically meaningless.",
    riskSummary: "2x leverage, 10% position, 1.2% stop, 3% daily pause, 8% drawdown stop.",
    disclosure: "Young agent: live record under 30 days. Ranking uses live data only, no backtest substitution.",
    decisions: [decision("d18", 0.4, "HYPE-PERP", "RSI 76, price > BB upper", "open short 10%", "reduce", "approved", "short 6%", "Copilot trimmed size at resistance")],
    versionSummaries: ["Initial range fade."],
  }),
  mk({
    id: "ag-08",
    name: "Northloop Beta",
    tagline: "Backtest-only breakout study. No vault, no live capital.",
    creatorId: "cr-03",
    status: "draft",
    market: "BTC-PERP",
    timeframe: "1h",
    provenance: "backtest",
    score: 0,
    tvlUsd: 0,
    returnPct: 41.3,
    drawdownPct: -22.7,
    liveAgeDays: 0,
    tradeCount: 132,
    version: 1,
    strategySummary: "Historical backtest on a pinned dataset. 41.3% is a backtest figure and is never presented as live performance.",
    riskSummary: "5x leverage, 40% position, 4% stop, 10% daily pause, 25% drawdown stop.",
    disclosure: "Historical backtest only. Not ranked against live agents and not investable.",
    decisions: [decision("d19", 6, "BTC-PERP", "replay bar 4,182", "open long 40%", "rules_only", "approved", "replay fill", "+$118.40 replay")],
    versionSummaries: ["Backtest iteration 1 — 20-bar breakout."],
  }),
  mk({
    id: "ag-09",
    name: "Verity Testnet",
    tagline: "Real orders on the Robinhood Chain test exchange, no real value.",
    creatorId: "cr-05",
    status: "live",
    market: "ETH-PERP",
    timeframe: "1h",
    provenance: "testnet",
    score: 0,
    tvlUsd: 0,
    returnPct: 4.1,
    drawdownPct: -1.8,
    liveAgeDays: 12,
    tradeCount: 34,
    version: 1,
    strategySummary: "Test-exchange execution rehearsal: real order placement against chain 46630 with faucet funds. Excluded from ranking and investment.",
    riskSummary: "2x leverage, 15% position, 2% stop, 5% daily pause, 10% drawdown stop.",
    disclosure: "Test-money execution. Balances and fills are test funds and are never mixed with real-money records.",
    decisions: [decision("d20", 0.6, "ETH-PERP", "order intent 6f2a…", "open long 15%", "rules_only", "approved", "fill 0xabc…", "test funds")],
    versionSummaries: ["Testnet rehearsal build."],
  }),
];

export const seedPortfolio: CovarState["portfolio"] = {
  wallet: "0x4dE9a1C7B2f05E8a3C6b9D1f4A7c2E5b8D0a3F61",
  chain: "Robinhood Chain · testnet 46630",
  cashUsd: 2_145.32,
  creditUsd: 18.4,
  holdings: [
    {
      agentId: "ag-01",
      shares: 421.8,
      costBasisUsd: 450,
      entryNav: 1.0668,
    },
    {
      agentId: "ag-05",
      shares: 120.0,
      costBasisUsd: 130,
      entryNav: 1.0833,
      requestedWithdrawal: {
        shares: 40,
        requestedAt: iso(1.2),
        state: "settling",
        estUsd: 45.87,
      },
    },
  ],
  ledger: [
    { id: "l1", ts: iso(0.1), kind: "deposit", agentId: "ag-01", label: "Deposit into Meridian Basis", amountUsd: 300, state: "settled", note: "Fee $3.10 (1% + 0.10 USDG) taken at deposit" },
    { id: "l2", ts: iso(1.2), kind: "withdrawal_request", agentId: "ag-05", label: "Withdrawal request · 40 shares", amountUsd: 45.87, state: "pending", note: "Position closure in progress · est. 2 days" },
    { id: "l3", ts: iso(2.4), kind: "ai_credit", label: "Copilot usage · 1,240 tokens", amountUsd: -0.32, state: "settled", note: "Orbio usage reconciled to provider invoice" },
    { id: "l4", ts: iso(3.1), kind: "trade_fee", agentId: "ag-01", label: "Creator fee · winning trade", amountUsd: -2.18, state: "settled", note: "10% of profit · $1.74 creator / $0.44 platform" },
    { id: "l5", ts: iso(6.2), kind: "deposit", agentId: "ag-05", label: "Deposit into Verity Momentum", amountUsd: 130, state: "settled", note: "Fee $1.40 (1% + 0.10 USDG)" },
    { id: "l6", ts: iso(9.5), kind: "pnl", agentId: "ag-01", label: "Vault NAV accrual (not a deposit)", amountUsd: 49.6, state: "settled", note: "Capital flow vs P&L kept separate" },
  ],
};

export const emptyStrategy = null;

export function seedState(): CovarState {
  return {
    walletConnected: false,
    notifications: [],
    agents: seedAgents,
    creators,
    portfolio: seedPortfolio,
    practice: {
      "ag-03": {
        agentId: "ag-03",
        startedAt: iso(0.4),
        capitalUsd: 10_000,
        pnlUsd: 268.4,
        ticks: 132,
        status: "running",
        priceMode: "simulated",
      },
    },
    drafts: [],
    liveStrategy: {},
  };
}
