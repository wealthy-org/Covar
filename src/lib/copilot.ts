/**
 * Copilot interpretation providers.
 *
 * The Copilot never writes rules directly. A model (when configured) proposes a
 * structured interpretation — intent, market, risk fields — and the deterministic
 * strategy engine encodes/validates/clamps it. If no model key is configured, or
 * the model fails, the same deterministic rules parser answers and the response
 * says exactly which engine produced it.
 */
import type { Strategy } from "./types";
import { buildStrategy, readPrompt, strategyFromIntent, type PromptIntent } from "./strategy";

export type CopilotProvider =
  | { kind: "none"; label: string; reason: string }
  | { kind: "anthropic"; label: string; model: string };

const VALID_STYLES = ["trend", "meanReversion", "breakout", "carry", "momentum"] as const;
const VALID_TF = ["5m", "15m", "1h", "4h"] as const;
const VALID_RISK = ["tight", "balanced", "aggressive"] as const;
const VALID_MODES = ["off", "advisory", "veto"] as const;
const VALID_MARKETS = ["BTC-PERP", "ETH-PERP", "SOL-PERP", "HYPE-PERP"] as const;

/** The bounded interpretation contract a model is allowed to propose. */
export interface ModelInterpretation {
  name?: string;
  style: (typeof VALID_STYLES)[number];
  market: (typeof VALID_MARKETS)[number];
  timeframe: (typeof VALID_TF)[number];
  risk: (typeof VALID_RISK)[number];
  copilot: (typeof VALID_MODES)[number];
  leverage?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  dailyLossPausePct?: number;
  maxDrawdownPct?: number;
  notes?: string;
}

/** What an interpretation is not allowed to say — no promises, no invented data. */
const SYSTEM = `You are the Covar Copilot interpreter. Convert the user's trading-strategy description into ONE JSON object only, no prose.

Schema: {"name": string (1-3 words, neutral), "style": "trend"|"meanReversion"|"breakout"|"carry"|"momentum", "market": "BTC-PERP"|"ETH-PERP"|"SOL-PERP"|"HYPE-PERP", "timeframe": "5m"|"15m"|"1h"|"4h", "risk": "tight"|"balanced"|"aggressive", "copilot": "off"|"advisory"|"veto", "leverage"?: number, "stopLossPct"?: number, "takeProfitPct"?: number, "dailyLossPausePct"?: number, "maxDrawdownPct"?: number}

Rules:
- Only perpetuals BTC/ETH/SOL/HYPE exist. If the user mentions anything else, pick the closest and note nothing.
- copilot "veto" only when the user explicitly says the AI must approve trades; "off" only when they disable AI; otherwise "advisory".
- risk: "tight" for conservative/small/low-risk, "aggressive" for high-risk requests, else "balanced".
- Only include the numeric overrides the user actually stated. Never invent numbers.
- Output raw JSON only.`;

export function copilotProvider(): CopilotProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      label: "Anthropic (Claude)",
      model: process.env.COPILOT_MODEL || "claude-haiku-4-5-20251001",
    };
  }
  return {
    kind: "none",
    label: "rules parser",
    reason:
      "No model key configured. Set ANTHROPIC_API_KEY to enable the language model; the deterministic rules parser answers until then, and every response is labelled accordingly.",
  };
}

/** Strict validation of model output. Anything outside the contract is rejected. */
export function sanitizeInterpretation(raw: unknown): ModelInterpretation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const num = (k: string): number | undefined =>
    typeof o[k] === "number" && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 ? (o[k] as number) : undefined;
  if (!VALID_STYLES.includes(o.style as never)) return null;
  if (!VALID_MARKETS.includes(o.market as never)) return null;
  if (!VALID_TF.includes(o.timeframe as never)) return null;
  if (!VALID_RISK.includes(o.risk as never)) return null;
  if (!VALID_MODES.includes(o.copilot as never)) return null;
  return {
    name: typeof o.name === "string" ? o.name : undefined,
    style: o.style as ModelInterpretation["style"],
    market: o.market as ModelInterpretation["market"],
    timeframe: o.timeframe as ModelInterpretation["timeframe"],
    risk: o.risk as ModelInterpretation["risk"],
    copilot: o.copilot as ModelInterpretation["copilot"],
    leverage: num("leverage"),
    stopLossPct: num("stopLossPct"),
    takeProfitPct: num("takeProfitPct"),
    dailyLossPausePct: num("dailyLossPausePct"),
    maxDrawdownPct: num("maxDrawdownPct"),
  };
}

async function callAnthropic(prompt: string, model: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`anthropic → HTTP ${res.status}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("anthropic returned an empty response");
  return text;
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in the model response");
  return JSON.parse(match[0]);
}

export interface CopilotResponse {
  ok: boolean;
  /** Exactly which engine answered. The UI must show this. */
  engine: "model" | "rules" | "rules-fallback";
  providerLabel: string;
  strategy?: Strategy;
  unsupported: string[];
  questions: string[];
  note?: string;
}

/** Interpret a first draft prompt. Never throws; provenance travels with the result. */
export async function interpretDraft(prompt: string): Promise<CopilotResponse> {
  const provider = copilotProvider();

  if (provider.kind === "anthropic") {
    try {
      const raw = await callAnthropic(prompt, provider.model);
      const parsed = sanitizeInterpretation(extractJson(raw));
      if (!parsed) throw new Error("model response failed interpretation validation");
      const intent: PromptIntent = {
        style: parsed.style,
        market: parsed.market,
        timeframe: parsed.timeframe,
        risk: parsed.risk,
        copilot: parsed.copilot,
        keywords: [parsed.market.replace("-PERP", ""), parsed.style],
      };
      let strategy = strategyFromIntent(intent, prompt, "draft", parsed.name);
      if (parsed.leverage || parsed.stopLossPct || parsed.takeProfitPct || parsed.dailyLossPausePct || parsed.maxDrawdownPct) {
        strategy = {
          ...strategy,
          risk: {
            leverage: Math.min(parsed.leverage ?? strategy.risk.leverage, 5),
            maxPositionPct: strategy.risk.maxPositionPct,
            stopLossPct: parsed.stopLossPct ?? strategy.risk.stopLossPct,
            takeProfitPct: parsed.takeProfitPct ?? strategy.risk.takeProfitPct,
            dailyLossPausePct: Math.min(parsed.dailyLossPausePct ?? strategy.risk.dailyLossPausePct, 10),
            maxDrawdownPct: Math.min(parsed.maxDrawdownPct ?? strategy.risk.maxDrawdownPct, 25),
          },
        };
      }
      // The deterministic audit still applies — the model cannot promise outcomes.
      const { unsupported, questions } = readPrompt(prompt);
      return {
        ok: true,
        engine: "model",
        providerLabel: `${provider.label} · ${provider.model}`,
        strategy,
        unsupported,
        questions,
      };
    } catch (err) {
      const { strategy, unsupported, questions } = buildStrategy(prompt);
      return {
        ok: true,
        engine: "rules-fallback",
        providerLabel: provider.label,
        strategy,
        unsupported,
        questions,
        note: `Model call failed (${(err as Error).message}); the deterministic rules parser produced this draft instead.`,
      };
    }
  }

  const { strategy, unsupported, questions } = buildStrategy(prompt);
  return {
    ok: true,
    engine: "rules",
    providerLabel: provider.label,
    strategy,
    unsupported,
    questions,
    note: provider.reason,
  };
}
