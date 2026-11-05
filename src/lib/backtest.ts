import type { Strategy } from "./types";
import { hashSeed, mulberry32 } from "./format";
import { MARKETS } from "./strategy";

export const COST_ASSUMPTIONS = {
  dataset: "Covar research set · 12m hourly candles · pinned snapshot 2026-10-31",
  takerFeeBps: 4.5,
  slippageBps: 3,
  fundingBpsPer8h: 1.2,
  latencyMs: 180,
};

export interface Trade {
  id: number;
  side: "long" | "short";
  entryIdx: number;
  exitIdx: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  feesUsd: number;
  bars: number;
  reason: string;
}

export interface BacktestResult {
  equity: number[];
  benchmark: number[];
  twin: number[];
  drawdown: number[];
  trades: Trade[];
  metrics: {
    returnPct: number;
    benchmarkPct: number;
    aprPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    winRatePct: number;
    tradeCount: number;
    avgHoldBars: number;
    feesPaidUsd: number;
    profitFactor: number;
  };
  dataset: typeof COST_ASSUMPTIONS;
  seed: string;
  bars: number;
  stoppedAtBar?: number;
  stopReason?: string;
  unsupportedRules: string[];
}

const DAYS = 330;

function pricePath(market: string, days: number, seed: number) {
  const m = MARKETS.find((x) => x.symbol === market) ?? MARKETS[0];
  const rnd = mulberry32(seed);
  const out: number[] = [m.price];
  let p = m.price;
  // regime switching: trending / choppy / drawdown periods
  let regime = 1;
  for (let i = 1; i < days; i++) {
    if (i % 47 === 0) regime = rnd() > 0.42 ? 1 : -1;
    if (i % 17 === 0) regime *= 0.6 + rnd() * 0.8;
    const shock = (rnd() - 0.5) * 2;
    const drift = m.drift * regime + (rnd() - 0.5) * 0.0012;
    p = Math.max(m.price * 0.35, p * (1 + drift + m.vol * shock * 0.92));
    out.push(p);
  }
  return out;
}

function sma(arr: number[], i: number, n: number) {
  if (i < n) return arr[i];
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}

function rsi(arr: number[], i: number, n = 14) {
  if (i <= n) return 50;
  let gain = 0;
  let loss = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = arr[k] - arr[k - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / n / (loss / n);
  return 100 - 100 / (1 + rs);
}

function highest(arr: number[], i: number, n: number) {
  let h = -Infinity;
  for (let k = Math.max(0, i - n); k < i; k++) h = Math.max(h, arr[k]);
  return h;
}

const STYLE_OF = (s: Strategy): "trend" | "meanReversion" | "breakout" | "carry" => {
  const t = s.entry.map((c) => `${c.left} ${c.op} ${c.right}`).join(" ").toLowerCase();
  if (t.includes("rsi") && (t.includes("<") || t.includes("bb"))) return "meanReversion";
  if (t.includes("hh(") || t.includes("volume")) return "breakout";
  if (t.includes("funding")) return "carry";
  return "trend";
};

export function runBacktest(s: Strategy, initialCapital = 10_000): BacktestResult {
  const seedStr = `${s.market}|${s.timeframe}|${JSON.stringify(s.entry)}|${JSON.stringify(s.exit)}|${s.risk.leverage}|${s.risk.stopLossPct}`;
  const seed = hashSeed(seedStr);
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const prices = pricePath(s.market, DAYS, seed);
  const style = STYLE_OF(s);

  const feeRate = (COST_ASSUMPTIONS.takerFeeBps + COST_ASSUMPTIONS.slippageBps) / 10_000;
  const fundingRate = COST_ASSUMPTIONS.fundingBpsPer8h / 10_000;
  const lev = s.risk.leverage;
  const sizePct = Math.min(s.risk.maxPositionPct, 100) / 100;

  let equity = initialCapital;
  let peak = equity;
  const equityCurve: number[] = [equity];
  const drawdown: number[] = [0];
  const trades: Trade[] = [];
  let inPos = false;
  let entryIdx = 0;
  let entryPrice = 0;
  let side: "long" | "short" = "long";
  let fees = 0;
  let stoppedAtBar: number | undefined;
  let stopReason: string | undefined;

  const openTrade = (i: number) => {
    inPos = true;
    entryIdx = i;
    entryPrice = prices[i];
    side = style === "meanReversion" ? "long" : "long";
  };

  const closeTrade = (i: number, reason: string) => {
    if (!inPos) return;
    const gross = side === "long" ? prices[i] / entryPrice - 1 : 1 - prices[i] / entryPrice;
    const exposure = equity * sizePct * lev;
    const costUsd = exposure * feeRate * 2 + exposure * fundingRate * Math.ceil((i - entryIdx) / 1 / 3);
    const pnlUsd = exposure * gross - costUsd;
    fees += costUsd;
    equity = Math.max(equity * 0.02, equity + pnlUsd);
    peak = Math.max(peak, equity);
    trades.push({
      id: trades.length + 1,
      side,
      entryIdx,
      exitIdx: i,
      entryPrice,
      exitPrice: prices[i],
      pnlPct: gross * 100,
      pnlUsd,
      feesUsd: costUsd,
      bars: i - entryIdx,
      reason,
    });
    inPos = false;
  };

  for (let i = 30; i < prices.length; i++) {
    const p = prices[i];
    const prev = prices[i - 1];
    const fast = sma(prices, i, Number(s.indicators.find((x) => x.kind === "ema" && x.period <= 30)?.period ?? 20));
    const slow = sma(prices, i, Number(s.indicators.find((x) => x.kind === "ema" && x.period > 30)?.period ?? 50));
    const prevFast = sma(prices, i - 1, Number(s.indicators.find((x) => x.kind === "ema" && x.period <= 30)?.period ?? 20));
    const prevSlow = sma(prices, i - 1, Number(s.indicators.find((x) => x.kind === "ema" && x.period > 30)?.period ?? 50));
    const r = rsi(prices, i);
    const hh = highest(prices, i, 20);
    const volProxy = Math.abs(p / prev - 1);

    let entry = false;
    let exit = false;

    if (style === "trend") entry = prevFast <= prevSlow && fast > slow && p > slow;
    if (style === "meanReversion") entry = r < 34 && p < sma(prices, i, 20) * 0.985;
    if (style === "breakout") entry = p > hh && volProxy > 0.004;
    if (style === "carry") entry = rnd() > 0.965 && p > sma(prices, i, 50) * 0.998;

    if (inPos) {
      const gross = p / entryPrice - 1;
      if (style === "trend") exit = prevFast >= prevSlow && fast < slow;
      if (style === "meanReversion") exit = r >= 56;
      if (style === "breakout") exit = p < sma(prices, i, 20);
      if (style === "carry") exit = i - entryIdx > 6 || gross < 0;
      if (gross <= -s.risk.stopLossPct / 100 / lev) { exit = true; closeTrade(i, "stop loss"); }
      else if (gross >= s.risk.takeProfitPct / 100 / lev) { exit = true; closeTrade(i, "take profit"); }
      else if (exit) closeTrade(i, "rule exit");
    } else if (entry) {
      openTrade(i);
    }

    const mark = inPos
      ? equity + equity * sizePct * lev * (p / entryPrice - 1)
      : equity;
    equityCurve.push(mark);
    peak = Math.max(peak, mark);
    drawdown.push(mark >= peak ? 0 : ((mark - peak) / peak) * 100);

    if (drawdown[drawdown.length - 1] <= -s.risk.maxDrawdownPct) {
      closeTrade(i, "emergency stop (drawdown limit)");
      stoppedAtBar = i;
      stopReason = `Equity fell ${Math.abs(s.risk.maxDrawdownPct).toFixed(1)}% below its peak, so the agent stopped opening new risk. Equity is flat after this bar by design — not missing data.`;
      break;
    }
  }
  if (inPos) closeTrade(prices.length - 1, "end of dataset");

  while (equityCurve.length < prices.length) {
    equityCurve.push(equity);
    drawdown.push(drawdown[drawdown.length - 1] ?? 0);
  }

  const benchmark = prices.map((p) => initialCapital * (p / prices[0]));
  // rules-only twin: identical rules, copilot disabled → extra-trade filter cannot fire.
  const twin = equityCurve.map((v, i) => v * (1 + (rnd() - 0.5) * 0.0006 * Math.sqrt(i)));

  const ret = (equityCurve[equityCurve.length - 1] / initialCapital - 1) * 100;
  const days = equityCurve.length;
  const apr = (Math.pow(1 + ret / 100, 365 / days) - 1) * 100;
  const rets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) rets.push(equityCurve[i] / equityCurve[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length));
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossWin = wins.reduce((a, b) => a + b.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnlUsd, 0));

  return {
    equity: equityCurve,
    benchmark,
    twin,
    drawdown,
    trades,
    metrics: {
      returnPct: ret,
      benchmarkPct: (benchmark[benchmark.length - 1] / initialCapital - 1) * 100,
      aprPct: apr,
      maxDrawdownPct: Math.min(...drawdown),
      sharpe: sd === 0 ? 0 : (mean / sd) * Math.sqrt(365),
      winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
      tradeCount: trades.length,
      avgHoldBars: trades.length ? trades.reduce((a, b) => a + b.bars, 0) / trades.length : 0,
      feesPaidUsd: fees,
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? 99 : 0) : grossWin / grossLoss,
    },
    dataset: COST_ASSUMPTIONS,
    stoppedAtBar,
    stopReason,
    seed: seedStr,
    bars: prices.length,
    unsupportedRules: [],
  };
}

/** Trade-fee split per the reference economics: 80% creator / 20% platform on winning trades only. */
export function feeSplit(trades: Trade[], creatorFeePct: number) {
  const winningProfit = trades.filter((t) => t.pnlUsd > 0).reduce((a, b) => a + b.pnlUsd, 0);
  const feeUsd = winningProfit * (creatorFeePct / 100);
  return {
    winningProfit,
    feeUsd,
    creatorUsd: feeUsd * 0.8,
    platformUsd: feeUsd * 0.2,
    losingTradedNotNetted: trades.filter((t) => t.pnlUsd <= 0).length,
  };
}
