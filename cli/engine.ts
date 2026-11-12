/**
 * CLI step 3 — strategy compile + the 7-gate risk check, on the REAL modules.
 *
 *   node cli/run.js            (spawns this through tsx; prints one JSON line)
 *
 * Nothing here is re-implemented for the demo: buildStrategy / validateStrategy /
 * clampLeverage come from src/lib/strategy.ts, the gates are createRisk() from
 * services/risk and createSigner() from services/signer. Prices are the live
 * Hyperliquid mids passed in by run.js. Equity is paper (no funds involved).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStrategy, clampLeverage, strategyToCode, validateStrategy } from "../src/lib/strategy";
import { createRisk } from "../services/risk/app";
import { createSigner } from "../services/signer/app";
import type { OrderIntent } from "../services/shared/types";

const mids = JSON.parse(process.env.COVAR_MIDS || "{}") as Record<string, number>;
const eth = mids["ETH"];
if (!eth) {
  console.log(JSON.stringify({ ok: false, error: "no live ETH mid passed in (step 2 must run first)" }));
  process.exit(1);
}

const PROMPT = "Aggressive ETH trend follower on 1h, 10x leverage, copilot veto";
const built = buildStrategy(PROMPT, "cli");
const s = built.strategy;
const code = strategyToCode(s);
const issues = validateStrategy(s);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covar-cli-risk-"));
const EQUITY = 10_000;
const risk = createRisk({ dir, equity: EQUITY });
const signer = createSigner({ dir });

let seq = 0;
const intent = (o: Partial<OrderIntent> & { notionalPct?: number }): OrderIntent => {
  const market = o.market ?? "ETH-PERP";
  const price = o.price ?? (mids[market.replace("-PERP", "")] || eth);
  const notional = ((o.notionalPct ?? 20) / 100) * EQUITY;
  return {
    intentId: `cli-${++seq}`,
    agentId: "cli",
    market,
    side: o.side ?? "buy",
    qty: o.qty ?? Number((notional / price).toFixed(4)),
    price,
    reduceOnly: o.reduceOnly ?? false,
    leverage: o.leverage ?? s.risk.leverage,
    strategyVersion: 1,
    proposedBy: o.proposedBy ?? "rules",
    copilotDecision: o.copilotDecision ?? "rules_only",
    createdAt: new Date().toISOString(),
  };
};

type Row = { gate: string; probe: string; expect: "PASS" | "BLOCK"; result: "PASS" | "BLOCK"; detail: string };
const rows: Row[] = [];
const check = (gate: string, probe: string, expect: Row["expect"], i: OrderIntent, checkName: string) => {
  const d = risk.evaluate(i);
  const c = d.checks.find((x) => x.name === checkName);
  // the verdict of THIS gate (the order as a whole is also logged by the engine's own journal)
  const result: Row["result"] = c?.ok ? "PASS" : "BLOCK";
  rows.push({ gate, probe, expect, result, detail: `${checkName} · ${c?.detail ?? d.reason}` });
};

// 1 allowlist
check("1 market allowlist", "DOGE-PERP buy", "BLOCK", intent({ market: "DOGE-PERP", price: 0.2 }), "market_allowlist");
check("1 market allowlist", "ETH-PERP buy", "PASS", intent({}), "market_allowlist");
// 2 leverage
check("2 leverage ≤ 5x", "ETH 8x", "BLOCK", intent({ leverage: 8 }), "leverage_ceiling");
check("2 leverage ≤ 5x", "ETH 5x", "PASS", intent({ leverage: 5 }), "leverage_ceiling");
// 3 position size (cap = 40% of equity × leverage)
check("3 position ≤ 40%", "ETH 45% @1x", "BLOCK", intent({ leverage: 1, notionalPct: 45 }), "position_size_cap");
check("3 position ≤ 40%", "ETH 35% @1x", "PASS", intent({ leverage: 1, notionalPct: 35 }), "position_size_cap");
// open a small long so exits below are verified exits
const opened = intent({ leverage: 1, notionalPct: 10 });
risk.applyFill({ market: "ETH-PERP", side: "buy", qty: opened.qty, price: eth, fee: 0 });
// 4 daily loss pause (10%)
risk.setEquity(EQUITY * 0.895);
check("4 daily loss 10%", "new risk at −10.5% today", "BLOCK", intent({ leverage: 1, notionalPct: 5 }), "daily_loss_pause");
check("4 daily loss 10%", "reduce-only exit", "PASS", intent({ side: "sell", reduceOnly: true, qty: opened.qty / 2, leverage: 1 }), "daily_loss_pause");
// 5 drawdown stop (25% from peak)
risk.setEquity(EQUITY * 0.74);
check("5 drawdown 25%", "new risk at −26% from peak", "BLOCK", intent({ leverage: 1, notionalPct: 5 }), "drawdown_stop");
check("5 drawdown 25%", "reduce-only exit", "PASS", intent({ side: "sell", reduceOnly: true, qty: opened.qty / 2, leverage: 1 }), "drawdown_stop");
const modeAfter = risk.state().mode;

// 6 signer clamp: only an order intent for an enabled market can ever be signed
const sigRows: Row[] = [];
const sig = (probe: string, expect: Row["expect"], req: Parameters<typeof signer.sign>[0]) => {
  const r = signer.sign(req);
  sigRows.push({ gate: "6 signer clamp", probe, expect, result: r.ok ? "PASS" : "BLOCK", detail: r.ok ? `signed ${r.signature.slice(0, 18)}…` : r.error });
};
const base = intent({ leverage: 1, notionalPct: 5 });
sig("ETH order intent", "PASS", { clientOrderId: "c-cli-sign-1", intent: base });
sig("order + withdrawal destination", "BLOCK", { clientOrderId: "c-cli-sign-2", intent: base, destination: "0x000000000000000000000000000000000000dEaD" });
sig("PEPE-PERP (not enabled)", "BLOCK", { clientOrderId: "c-cli-sign-3", intent: { ...base, market: "PEPE-PERP" } });

// 7 Copilot ceiling: a Copilot suggestion is clamped, and "approve" never overrides a gate
const copilotLev = 8;
const clamped = clampLeverage({ ...s, risk: { ...s.risk, leverage: copilotLev } });
const fresh = createRisk({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "covar-cli-risk2-")), equity: EQUITY });
const cop = fresh.evaluate(intent({ leverage: copilotLev, proposedBy: "copilot", copilotDecision: "approve" }));
const copRows: Row[] = [
  { gate: "7 Copilot ceiling", probe: `Copilot suggests ${copilotLev}x`, expect: "BLOCK", result: clamped.risk.leverage <= 5 ? "BLOCK" : "PASS", detail: `strategy clamp → ${clamped.risk.leverage}x (platform ceiling 5x)` },
  { gate: "7 Copilot ceiling", probe: `Copilot "approve" on ${copilotLev}x order`, expect: "BLOCK", result: cop.approved ? "PASS" : "BLOCK", detail: cop.reason },
];

const all = [...rows, ...sigRows, ...copRows];
console.log(
  JSON.stringify({
    ok: all.every((r) => r.result === r.expect),
    prompt: PROMPT,
    strategy: {
      name: s.name,
      market: s.market,
      venue: s.venue,
      timeframe: s.timeframe,
      indicators: s.indicators.map((i) => `${i.kind}(${i.period})`),
      entry: s.entry.length,
      exit: s.exit.length,
      risk: s.risk,
      copilot: s.copilot.mode,
      unsupported: built.unsupported,
      issues: issues.map((i) => `${i.level}: ${i.message}`),
      codeLines: code.split("\n").length,
      codeSha256: crypto.createHash("sha256").update(code).digest("hex"),
      codeHead: code.split("\n").slice(0, 14),
    },
    equity: EQUITY,
    ethMid: eth,
    modeAfter,
    rows: all,
  })
);
fs.rmSync(dir, { recursive: true, force: true });
