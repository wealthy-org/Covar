/**
 * Copilot interpretation providers.
 *
 * The Copilot never writes rules directly. A model (when configured) proposes a
 * structured interpretation — intent, market, risk fields — and the deterministic
 * strategy engine encodes/validates/clamps it. If no model key is configured, or
 * the model fails, the same deterministic rules parser answers and the response
 * says exactly which engine produced it.
 */
import { COPILOT_MAX_OUTPUT_TOKENS } from "./aiLimits";
import type { Strategy } from "./types";
import { buildStrategy, readPrompt, strategyFromIntent, type PromptIntent } from "./strategy";

/** Token usage of one successful provider call (3.7 metering). */
export interface ModelUsage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  providerCostUsd?: number;
}

export type CopilotProvider =
  | { kind: "none"; label: string; reason: string }
  | { kind: "anthropic"; label: string; model: string; apiKey: string; baseUrl: string }
  | { kind: "openai-compatible"; label: string; model: string; apiKey: string; baseUrl: string };

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

/**
 * Provider selection (server-side env only — keys never reach the browser).
 *
 *   AI_PROVIDER          orbio | anthropic | openai | groq | gemini   (optional; inferred from the key prefix)
 *   AI_PROVIDER_API_KEY  sk-orbio-… / sk-ant-… / sk-… / gsk_… (Groq) / AIza… (Gemini)
 *   AI_MODEL             optional model id override
 *   AI_BASE_URL          optional gateway override (OpenAI-compatible providers)
 *
 * Orbio is the reference product's AI dependency (brief §7/§8): an
 * OpenAI-compatible gateway at api.orbio.so with one key for many models.
 * Groq and Gemini have free tiers (no card) with OpenAI-compatible endpoints —
 * handy for development; their free quotas are rate-limited.
 * Legacy ANTHROPIC_API_KEY / COPILOT_MODEL are still honoured.
 */
const PROVIDERS = {
  orbio: { label: "Orbio", baseUrl: "https://api.orbio.so/api/v1", model: "anthropic/claude-haiku-4.5", wire: "openai-compatible" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", wire: "openai-compatible" },
  anthropic: { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", wire: "anthropic" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", wire: "openai-compatible" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite", wire: "openai-compatible" },
} as const;
type ProviderName = keyof typeof PROVIDERS;

const envValue = (k: string) => {
  const v = process.env[k]?.trim();
  return v && !v.includes("<") && !v.includes("...") ? v : undefined;
};

export function copilotProvider(): CopilotProvider {
  const apiKey = envValue("AI_PROVIDER_API_KEY") ?? envValue("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      kind: "none",
      label: "rules parser",
      reason:
        "No model key configured. Set AI_PROVIDER_API_KEY (Orbio, Anthropic or OpenAI) to enable the language model; the deterministic rules parser answers until then, and every response is labelled accordingly.",
    };
  }
  const declared = envValue("AI_PROVIDER")?.toLowerCase();
  const name: ProviderName | undefined =
    declared && declared in PROVIDERS
      ? (declared as ProviderName)
      : !envValue("AI_PROVIDER_API_KEY") || apiKey.startsWith("sk-ant-")
        ? "anthropic"
        : apiKey.startsWith("sk-orbio-")
          ? "orbio"
          : apiKey.startsWith("gsk_")
            ? "groq"
            : apiKey.startsWith("AIza")
              ? "gemini"
              : apiKey.startsWith("sk-")
                ? "openai"
                : undefined;
  if (!name) {
    return {
      kind: "none",
      label: "rules parser",
      reason: `AI_PROVIDER "${declared ?? "(unset)"}" is not recognised and the key prefix is unknown. Use orbio, anthropic, openai, groq or gemini; the rules parser answers until then.`,
    };
  }
  const cfg = PROVIDERS[name];
  const model = envValue("AI_MODEL") ?? (name === "anthropic" ? envValue("COPILOT_MODEL") : undefined) ?? cfg.model;
  const baseUrl = (envValue("AI_BASE_URL") ?? cfg.baseUrl).replace(/\/+$/, "");
  return cfg.wire === "anthropic"
    ? { kind: "anthropic", label: cfg.label, model, apiKey, baseUrl }
    : { kind: "openai-compatible", label: cfg.label, model, apiKey, baseUrl };
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

async function callAnthropic(prompt: string, p: Extract<CopilotProvider, { kind: "anthropic" }>, onUsage: (u: ModelUsage) => void): Promise<string> {
  const res = await fetch(`${p.baseUrl}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: COPILOT_MAX_OUTPUT_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw await providerError(p.label, res);
  const json = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  if (json.usage) onUsage({ provider: p.label, model: p.model, tokensIn: json.usage.input_tokens ?? 0, tokensOut: json.usage.output_tokens ?? 0 });
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`${p.label} returned an empty response`);
  return text;
}

/** Provider error → one short, key-free line (the provider's own reason when it gives one). */
async function providerError(label: string, res: Response): Promise<Error> {
  let reason = "";
  try {
    const parsed = (await res.json()) as unknown;
    // Gemini wraps the error in an array: [{ error: { message } }]
    const body = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: string; code?: string } | string; message?: string };
    const e = body.error;
    reason = (typeof e === "string" ? e : e?.message ?? e?.code ?? body.message ?? "").toString();
  } catch {
    /* no JSON body */
  }
  reason = reason.replace(/\b(sk|pk|key)[-_][A-Za-z0-9_-]{6,}/g, "<key>").replace(/\s+/g, " ").trim().slice(0, 180);
  const hint =
    res.status === 401 || res.status === 403 || /api key/i.test(reason)
      ? " (check AI_PROVIDER_API_KEY)"
      : res.status === 402
        ? " (provider balance/credits exhausted)"
        : res.status === 404
          ? " (check AI_MODEL / AI_BASE_URL)"
          : res.status === 429
            ? " (provider rate limit)"
            : "";
  return new Error(`${label} → HTTP ${res.status}${hint}${reason ? `: ${reason}` : ""}`);
}

/** Orbio and OpenAI speak the same chat-completions wire format. */
async function callOpenAICompatible(prompt: string, p: Extract<CopilotProvider, { kind: "openai-compatible" }>, onUsage: (u: ModelUsage) => void): Promise<string> {
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      max_tokens: COPILOT_MAX_OUTPUT_TOKENS,
      // reasoning models: think briefly — the answer is a ~100-token JSON object
      ...(/api\.groq\.com|generativelanguage\.googleapis\.com/.test(p.baseUrl) ? { reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });
  // 402 = balance/credits exhausted on Orbio: surfaced, then the rules parser answers.
  if (!res.ok) throw await providerError(p.label, res);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  if (json.usage) {
    onUsage({
      provider: p.label,
      model: p.model,
      tokensIn: json.usage.prompt_tokens ?? 0,
      tokensOut: json.usage.completion_tokens ?? 0,
      ...(typeof json.usage.cost === "number" ? { providerCostUsd: json.usage.cost } : {}),
    });
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${p.label} returned an empty response`);
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
  engine: "model" | "rules" | "rules-fallback" | "rules-credits";
  providerLabel: string;
  strategy?: Strategy;
  unsupported: string[];
  questions: string[];
  note?: string;
  /** Usage of the provider call, when one completed (billed even if its output was then rejected). */
  usage?: ModelUsage;
  /** Filled by the route when credits are enforced. */
  credits?: { chargedUsd: number; balanceUsd: number; basis: string };
}

/** Interpret a first draft prompt. Never throws; provenance travels with the result. */
export async function interpretDraft(prompt: string, opts: { skipModel?: string } = {}): Promise<CopilotResponse> {
  const provider = copilotProvider();

  if (provider.kind !== "none" && opts.skipModel) {
    const { strategy, unsupported, questions } = buildStrategy(prompt);
    return { ok: true, engine: "rules-credits", providerLabel: provider.label, strategy, unsupported, questions, note: opts.skipModel };
  }

  if (provider.kind !== "none") {
    let usage: ModelUsage | undefined;
    const onUsage = (u: ModelUsage) => {
      usage = u;
    };
    try {
      const raw =
        provider.kind === "anthropic" ? await callAnthropic(prompt, provider, onUsage) : await callOpenAICompatible(prompt, provider, onUsage);
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
        usage,
      };
    } catch (err) {
      const e = err as Error;
      const why = e.name === "TimeoutError" || e.name === "AbortError" ? `${provider.label} did not answer within 20 s` : e.message;
      console.warn(`[copilot] model call failed (${provider.label} · ${provider.model}): ${why}`);
      const { strategy, unsupported, questions } = buildStrategy(prompt);
      return {
        ok: true,
        engine: "rules-fallback",
        providerLabel: provider.label,
        strategy,
        unsupported,
        questions,
        note: `Model call failed (${why}); the deterministic rules parser produced this draft instead.`,
        usage,
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
