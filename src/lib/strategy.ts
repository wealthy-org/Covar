import type { Condition, Strategy } from "./types";
import { clamp, hashSeed, mulberry32 } from "./format";

export const MARKETS = [
  { symbol: "ETH-PERP", name: "Ethereum perpetual", tick: 0.01, price: 3180, vol: 0.021, drift: 0.00035 },
  { symbol: "BTC-PERP", name: "Bitcoin perpetual", tick: 1, price: 96400, vol: 0.017, drift: 0.0003 },
  { symbol: "SOL-PERP", name: "Solana perpetual", tick: 0.01, price: 194, vol: 0.031, drift: 0.0004 },
  { symbol: "HYPE-PERP", name: "Hyperliquid perpetual", tick: 0.001, price: 38.2, vol: 0.038, drift: 0.0005 },
  { symbol: "USDG-PERP", name: "USDG inverse (funding carry)", tick: 0.0001, price: 1.0, vol: 0.0012, drift: 0.00002 },
];

export const PLATFORM_LIMITS = {
  leverage: 5,
  dailyLossPausePct: 10,
  maxDrawdownPct: 25,
  feeCapPct: 20,
  depositFeePct: 1,
  depositFeeFlat: 0.1,
  creatorSplitPct: 80,
  platformSplitPct: 20,
};

let condSeq = 0;
const cond = (left: string, op: Condition["op"], right: string): Condition => ({
  id: `c${++condSeq}`,
  left,
  op,
  right,
});

export interface PromptIntent {
  style: "trend" | "meanReversion" | "breakout" | "carry" | "momentum";
  market: string;
  timeframe: Strategy["timeframe"];
  risk: "tight" | "balanced" | "aggressive";
  copilot: Strategy["copilot"]["mode"];
  keywords: string[];
}

/** Deterministic, explainable prompt reading. No hidden model call, no invented conditions. */
export function readPrompt(prompt: string): { intent: PromptIntent; unsupported: string[]; questions: string[] } {
  const p = prompt.toLowerCase();
  const keywords: string[] = [];
  let style: PromptIntent["style"] = "trend";
  if (/\b(mean|revert|fade|range|sideways|oscillat)/.test(p)) { style = "meanReversion"; keywords.push("mean-reversion"); }
  else if (/\b(breakout|break out|range break|momentum ignition)/.test(p)) { style = "breakout"; keywords.push("breakout"); }
  else if (/\b(funding|carry|basis|delta.?neutral)/.test(p)) { style = "carry"; keywords.push("carry"); }
  else if (/\b(momentum|trend|follow)/.test(p)) { style = "momentum"; keywords.push("momentum"); }

  const marketMatch = p.match(/\b(eth|btc|sol|hype)\b/);
  const market = marketMatch
    ? `${marketMatch[1].toUpperCase()}-PERP`
    : "ETH-PERP";
  if (marketMatch) keywords.push(marketMatch[1].toUpperCase());

  let timeframe: Strategy["timeframe"] = "1h";
  if (/\b(5m|5 min|scalp)/.test(p)) timeframe = "5m";
  else if (/\b(15m|15 min)/.test(p)) timeframe = "15m";
  else if (/\b(4h|4 hour|swing)/.test(p)) timeframe = "4h";

  let risk: PromptIntent["risk"] = "balanced";
  if (/\b(tight|conservative|small|low risk|careful|low leverage)/.test(p)) risk = "tight";
  if (/\b(aggressive|high risk|max leverage|bold)/.test(p)) risk = "aggressive";

  const copilot: Strategy["copilot"]["mode"] = /\b(no ai|rules only|without ai)\b/.test(p)
    ? "off"
    : /\b(ai must approve|ai approves|veto)\b/.test(p)
      ? "veto"
      : "advisory";

  const unsupported: string[] = [];
  if (/\b(guarantee|guaranteed|risk.?free|sure profit)\b/.test(p))
    unsupported.push("Guaranteed returns cannot be encoded — every rule is a conditional, not a promise of outcome.");
  if (/\b(options?|calls?|puts?)\b/.test(p))
    unsupported.push("Options are not a supported market on the configured venue; only perpetuals are available.");
  if (/\b(news|twitter|sentiment|social)\b/.test(p))
    unsupported.push("Off-chain sentiment/news feeds are not in scope for this version — no data source is configured for them.");
  if (/\b(all in|100x|10x leverage|20x)\b/.test(p))
    unsupported.push("Requested leverage exceeds the platform ceiling of 5x. Clamped, not silently accepted.");

  const questions: string[] = [];
  if (!/\b(stop|exit|close)\b/.test(p)) questions.push("No exit condition was stated. Suggested default below — confirm or edit it.");
  if (!/\b(risk|drawdown|daily)\b/.test(p)) questions.push("No loss limit was stated. Platform defaults (10% daily pause / 25% drawdown stop) will apply.");

  return { intent: { style, market, timeframe, risk, copilot, keywords }, unsupported, questions };
}

const RISK_PRESETS = {
  tight: { leverage: 2, maxPositionPct: 15, stopLossPct: 1.5, takeProfitPct: 3, dailyLossPausePct: 4, maxDrawdownPct: 10 },
  balanced: { leverage: 3, maxPositionPct: 25, stopLossPct: 2.5, takeProfitPct: 6, dailyLossPausePct: 7, maxDrawdownPct: 18 },
  aggressive: { leverage: 5, maxPositionPct: 40, stopLossPct: 4, takeProfitPct: 11, dailyLossPausePct: 10, maxDrawdownPct: 25 },
};

export function buildStrategy(prompt: string, agentId = "draft"): { strategy: Strategy; unsupported: string[]; questions: string[] } {
  const { intent, unsupported, questions } = readPrompt(prompt);
  return { strategy: strategyFromIntent(intent, prompt, agentId), unsupported, questions };
}

/**
 * Deterministic encoding of an interpretation into a typed strategy. This is the
 * only path that creates conditions or risk numbers, so a model can propose an
 * interpretation but can never bypass validation, clamping, or the risk presets.
 */
export function strategyFromIntent(intent: PromptIntent, prompt: string, agentId = "draft", nameOverride?: string): Strategy {
  const tf = intent.timeframe;
  const base = 8 + (tf === "5m" ? 0 : tf === "15m" ? 4 : tf === "4h" ? 12 : 8);
  const risk = RISK_PRESETS[intent.risk];

  const builder = (): Pick<Strategy, "indicators" | "entry" | "exit" | "entryLogic" | "exitLogic"> => {
    switch (intent.style) {
      case "meanReversion":
        return {
          indicators: [
            { id: "i1", kind: "rsi", period: 14 },
            { id: "i2", kind: "bollinger", period: 20 },
            { id: "i3", kind: "ema", period: 200 },
          ],
          entryLogic: "and",
          entry: [
            cond("RSI(14)", "<", "32"),
            cond("close", "<", "BB(20,2).lower"),
            cond("close", ">", "EMA(200)"),
          ],
          exitLogic: "or",
          exit: [cond("RSI(14)", ">", "55"), cond("close", ">", "BB(20,2).middle"), cond("P&L", "<", `−${risk.stopLossPct}%`)],
        };
      case "breakout":
        return {
          indicators: [
            { id: "i1", kind: "ema", period: 20 },
            { id: "i2", kind: "atr", period: 14 },
            { id: "i3", kind: "volume", period: 20 },
          ],
          entryLogic: "and",
          entry: [
            cond("close", ">", `HH(${base})`),
            cond("volume", ">", "1.6 × SMA(volume,20)"),
            cond("ATR(14)", ">", "0.8 × ATR(14).avg20"),
          ],
          exitLogic: "or",
          exit: [cond("close", "<", "EMA(20)"), cond("P&L", "<", `−${risk.stopLossPct}%`), cond("P&L", ">", `+${risk.takeProfitPct}%`)],
        };
      case "carry":
        return {
          indicators: [
            { id: "i1", kind: "ema", period: 50 },
            { id: "i2", kind: "atr", period: 14 },
          ],
          entryLogic: "and",
          entry: [cond("fundingRate(8h)", "<", "−0.004%"), cond("openInterestDelta(24h)", ">", "0")],
          exitLogic: "or",
          exit: [cond("fundingRate(8h)", ">=", "0.010%"), cond("P&L", "<", `−${risk.stopLossPct}%`)],
        };
      case "momentum":
        return {
          indicators: [
            { id: "i1", kind: "ema", period: 20 },
            { id: "i2", kind: "ema", period: 60 },
            { id: "i3", kind: "atr", period: 14 },
          ],
          entryLogic: "and",
          entry: [cond("EMA(20)", "crossesAbove", "EMA(60)"), cond("close", ">", "EMA(200)"), cond("EMA(60).slope", ">", "0")],
          exitLogic: "or",
          exit: [cond("EMA(20)", "crossesBelow", "EMA(60)"), cond("P&L", "<", `−${risk.stopLossPct}%`), cond("P&L", ">", `+${risk.takeProfitPct}%`)],
        };
      default:
        return {
          indicators: [
            { id: "i1", kind: "ema", period: 20 },
            { id: "i2", kind: "ema", period: 50 },
            { id: "i3", kind: "atr", period: 14 },
          ],
          entryLogic: "and",
          entry: [cond("EMA(20)", "crossesAbove", "EMA(50)"), cond("RSI(14)", ">", "50"), cond("close", ">", "EMA(200)")],
          exitLogic: "or",
          exit: [cond("EMA(20)", "crossesBelow", "EMA(50)"), cond("P&L", "<", `−${risk.stopLossPct}%`), cond("P&L", ">", `+${risk.takeProfitPct}%`)],
        };
    }
  };

  const part = builder();
  const seed = hashSeed(prompt);
  const rnd = mulberry32(seed);
  const adjectives = ["Quiet", "Patient", "Steady", "Lean", "Calm", "Measured", "Tidal", "Northern", "Cobalt", "Granite"];
  const nouns = ["Drift", "Vector", "Ladder", "Anchor", "Ridge", "Compass", "Ledger", "Harbor", "Signal", "Baseline"];
  const name =
    nameOverride?.trim().slice(0, 48) ||
    `${adjectives[Math.floor(rnd() * adjectives.length)]} ${nouns[Math.floor(rnd() * nouns.length)]}`;

  const strategy: Strategy = {
    id: `st-${seed.toString(36)}`,
    agentId,
    version: 1,
    name,
    market: intent.market,
    venue: "Lighter",
    timeframe: tf,
    ...part,
    risk,
    copilot: {
      mode: intent.copilot,
      allowExtraTrades: false,
      fallbackToRules: true,
      rulesOnlyTwin: true,
    },
    feeChoicePct: 10,
    notes: prompt.trim(),
    createdAt: new Date().toISOString(),
  };

  return clampLeverage(strategy);
}

export function clampLeverage(s: Strategy): Strategy {
  return {
    ...s,
    risk: {
      ...s.risk,
      leverage: clamp(s.risk.leverage, 1, PLATFORM_LIMITS.leverage),
      dailyLossPausePct: clamp(s.risk.dailyLossPausePct, 1, PLATFORM_LIMITS.dailyLossPausePct),
      maxDrawdownPct: clamp(s.risk.maxDrawdownPct, 3, PLATFORM_LIMITS.maxDrawdownPct),
    },
    feeChoicePct: clamp(s.feeChoicePct, 0, PLATFORM_LIMITS.feeCapPct),
  };
}

export interface ValidationIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

export function validateStrategy(s: Strategy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!s.name.trim()) issues.push({ level: "error", field: "name", message: "Strategy needs a name." });
  if (s.entry.length === 0)
    issues.push({ level: "error", field: "entry", message: "Entry needs at least one condition — otherwise the agent would enter on every bar." });
  if (s.exit.length === 0)
    issues.push({ level: "error", field: "exit", message: "Exit needs at least one condition; an agent without an exit cannot be published." });
  if (s.risk.leverage > PLATFORM_LIMITS.leverage)
    issues.push({ level: "error", field: "risk.leverage", message: `Leverage above the ${PLATFORM_LIMITS.leverage}x platform ceiling.` });
  if (s.risk.dailyLossPausePct > PLATFORM_LIMITS.dailyLossPausePct)
    issues.push({ level: "error", field: "risk.dailyLossPausePct", message: `Daily loss pause cannot exceed ${PLATFORM_LIMITS.dailyLossPausePct}%.` });
  if (s.risk.maxDrawdownPct > PLATFORM_LIMITS.maxDrawdownPct)
    issues.push({ level: "error", field: "risk.maxDrawdownPct", message: `Emergency stop cannot exceed ${PLATFORM_LIMITS.maxDrawdownPct}%.` });
  if (s.risk.stopLossPct <= 0)
    issues.push({ level: "error", field: "risk.stopLossPct", message: "A per-trade stop is required." });
  if (s.risk.stopLossPct > s.risk.maxDrawdownPct / 2)
    issues.push({ level: "warning", field: "risk.stopLossPct", message: "Per-trade stop is large relative to the drawdown stop — a few losses will trigger the emergency stop." });
  if (s.risk.maxPositionPct > 50)
    issues.push({ level: "warning", field: "risk.maxPositionPct", message: "Position size above 50% of equity leaves little room for adverse gaps." });
  if (s.entryLogic === "or" && s.entry.length > 3)
    issues.push({ level: "warning", field: "entryLogic", message: "OR entry with many conditions fires very often; cost assumptions will dominate." });
  if (s.copilot.mode === "off" && !s.copilot.rulesOnlyTwin)
    issues.push({ level: "warning", field: "copilot", message: "Copilot is off and no rules-only twin record is kept, so results cannot be compared." });
  if (s.feeChoicePct > PLATFORM_LIMITS.feeCapPct)
    issues.push({ level: "error", field: "feeChoicePct", message: `Creator fee cannot exceed ${PLATFORM_LIMITS.feeCapPct}%.` });
  return issues;
}

export const opLabel: Record<Condition["op"], string> = {
  crossesAbove: "crosses above",
  crossesBelow: "crosses below",
  ">": ">",
  "<": "<",
  ">=": "≥",
  "<=": "≤",
};

export function strategyToCode(s: Strategy): string {
  const conds = (list: Condition[], logic: string) =>
    list.map((c, i) => `      ${i === 0 ? "" : logic === "and" ? "&& " : "|| "}${c.left} ${c.op === "crossesAbove" ? "crossAbove" : c.op === "crossesBelow" ? "crossBelow" : c.op} ${/^-?[\d.]+$/.test(c.right) ? c.right : `"${c.right}"`}`).join("\n");

  return `export const strategy = {
  name: "${s.name}",
  version: ${s.version},
  market: "${s.market}",
  venue: "${s.venue}",
  timeframe: "${s.timeframe}",
  indicators: [${s.indicators.map((i) => `${i.kind}(${i.period})`).join(", ")}],

  entry: (ctx) =>
${conds(s.entry, s.entryLogic) || "      false"},

  exit: (ctx) =>
${conds(s.exit, s.exitLogic) || "      false"},

  risk: {
    leverage: ${s.risk.leverage},
    maxPositionPct: ${s.risk.maxPositionPct},
    stopLossPct: ${s.risk.stopLossPct},
    takeProfitPct: ${s.risk.takeProfitPct},
    dailyLossPausePct: ${s.risk.dailyLossPausePct},
    maxDrawdownPct: ${s.risk.maxDrawdownPct},
  },

  copilot: {
    mode: "${s.copilot.mode}",
    allowExtraTrades: ${s.copilot.allowExtraTrades},
    fallbackToRules: ${s.copilot.fallbackToRules},
    rulesOnlyTwin: ${s.copilot.rulesOnlyTwin},
  },

  creatorFeePct: ${s.feeChoicePct},
};`;
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

export function diffStrategies(a: Strategy, b: Strategy): DiffLine[] {
  const flat = (s: Strategy) => [
    `name: ${s.name}`,
    `market: ${s.market} · ${s.timeframe}`,
    `entry (${s.entryLogic}): ${s.entry.map((c) => `${c.left} ${opLabel[c.op]} ${c.right}`).join(" · ") || "—"}`,
    `exit (${s.exitLogic}): ${s.exit.map((c) => `${c.left} ${opLabel[c.op]} ${c.right}`).join(" · ") || "—"}`,
    `leverage: ${s.risk.leverage}x · max position ${s.risk.maxPositionPct}%`,
    `stop: ${s.risk.stopLossPct}% · target: ${s.risk.takeProfitPct}%`,
    `daily pause: ${s.risk.dailyLossPausePct}% · drawdown stop: ${s.risk.maxDrawdownPct}%`,
    `copilot: ${s.copilot.mode} · extra trades: ${s.copilot.allowExtraTrades}`,
    `creator fee: ${s.feeChoicePct}%`,
  ];
  const aL = flat(a);
  const bL = flat(b);
  const out: DiffLine[] = [];
  const max = Math.max(aL.length, bL.length);
  for (let i = 0; i < max; i++) {
    if (aL[i] === bL[i]) out.push({ kind: "same", text: bL[i] ?? "" });
    else {
      if (aL[i]) out.push({ kind: "del", text: aL[i] });
      if (bL[i]) out.push({ kind: "add", text: bL[i] });
    }
  }
  return out;
}
