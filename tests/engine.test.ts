/**
 * Covar engine checks — run with `npm test`.
 * These are the deterministic assertions the brief asks to prove before anything is
 * shown to an investor: rule parsing, validation ceilings, reproducible backtests and
 * the fee split. They test the library layer, not the UI.
 */
import { buildStrategy, validateStrategy, PLATFORM_LIMITS } from "../src/lib/strategy";
import { runBacktest, feeSplit } from "../src/lib/backtest";

let pass = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name: string, a: unknown, b: unknown) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

console.log("\nStrategy parsing & validation");

const fade = buildStrategy(
  "Fade ETH panic wicks on the 15m: long only below the lower Bollinger band while RSI is under 32, above the 200 EMA, stop 1.5%."
).strategy;
ok("mean-reversion prompt produces an RSI entry condition", fade.entry.some((c) => c.left.includes("RSI")));
ok("timeframe parsed from prompt (15m)", fade.timeframe === "15m");
ok("market parsed from prompt (ETH-PERP)", fade.market === "ETH-PERP");
ok("exit conditions are generated, never left empty", fade.exit.length > 0);
ok("fresh strategy passes validation", validateStrategy(fade).length === 0);

const greedy = buildStrategy("BTC 20x leverage, all in, guaranteed profit, swing trade").strategy;
ok(
  `leverage request above the ${PLATFORM_LIMITS.leverage}x ceiling is clamped`,
  greedy.risk.leverage <= PLATFORM_LIMITS.leverage,
  `got ${greedy.risk.leverage}`
);
ok("guarantee language is reported as unsupported rather than encoded", /guarantee/i.test(
  buildStrategy("guaranteed profit strategy on ETH").unsupported.join(" ")
));

const broken = { ...fade, entry: [] };
ok("strategy with no entry condition fails validation", validateStrategy(broken).some((i) => i.level === "error"));
const over = { ...fade, risk: { ...fade.risk, leverage: 9, maxDrawdownPct: 40 } };
ok("leverage above ceiling fails validation", validateStrategy(over).some((i) => i.field === "risk.leverage"));
ok("drawdown stop above ceiling fails validation", validateStrategy(over).some((i) => i.field === "risk.maxDrawdownPct"));

console.log("\nBacktest reproducibility");

const a = runBacktest(fade, 10_000);
const b = runBacktest(fade, 10_000);
eq("same strategy → identical seed", a.seed, b.seed);
eq("same strategy → identical final equity", a.equity[a.equity.length - 1], b.equity[b.equity.length - 1]);
eq("same strategy → identical trade count", a.trades.length, b.trades.length);
ok("equity and benchmark series are the same length", a.equity.length === a.benchmark.length);
ok("drawdown never positive", a.drawdown.every((d) => d <= 0.0000001));
ok("every trade records its costs", a.trades.every((t) => t.feesUsd > 0));
ok("trades have an exit reason", a.trades.every((t) => t.reason.length > 0));

const other = runBacktest({ ...fade, market: "BTC-PERP" }, 10_000);
ok("a different market produces a different result", other.seed !== a.seed);
ok("cost assumptions are attached to the run", a.dataset.takerFeeBps > 0 && a.dataset.slippageBps > 0);

console.log("\nEconomics");

const split = feeSplit(
  [
    { id: 1, side: "long", entryIdx: 0, exitIdx: 1, entryPrice: 1, exitPrice: 2, pnlPct: 1, pnlUsd: 100, feesUsd: 1, bars: 1, reason: "x" },
    { id: 2, side: "long", entryIdx: 2, exitIdx: 3, entryPrice: 1, exitPrice: 0.5, pnlPct: -1, pnlUsd: -60, feesUsd: 1, bars: 1, reason: "y" },
  ],
  10
);
eq("fee is 10% of winning profit only", split.feeUsd, 10);
eq("creator share is 80%", split.creatorUsd, 8);
eq("platform share is 20%", split.platformUsd, 2);
eq("losing trades are not netted against the fee base", split.winningProfit, 100);

const depositFee = (amount: number) => amount * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
eq("deposit fee on 1000 USDG is 1% + 0.10", depositFee(1000), 10.1);
const shares = (1_000 - depositFee(1_000)) / 1.25;
eq("shares minted against NAV", Math.round(shares * 10000) / 10000, 791.92);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(`Failing: ${fails.join("; ")}`);
  process.exit(1);
}
