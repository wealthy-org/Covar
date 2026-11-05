"use client";

import type { Condition, Strategy } from "@/lib/types";
import { MARKETS, PLATFORM_LIMITS, opLabel, type ValidationIssue } from "@/lib/strategy";
import { Field } from "./ui";
import { uid } from "@/lib/store";

const OPS: Condition["op"][] = ["crossesAbove", "crossesBelow", ">", "<", ">=", "<="];

function ConditionList({
  title,
  logic,
  items,
  onChange,
  onLogic,
  issues,
  prefix,
}: {
  title: string;
  logic: "and" | "or";
  items: Condition[];
  onChange: (c: Condition[]) => void;
  onLogic: (l: "and" | "or") => void;
  issues: ValidationIssue[];
  prefix: "entry" | "exit";
}) {
  const fieldIssues = issues.filter((i) => i.field === prefix);

  const update = (id: string, patch: Partial<Condition>) =>
    onChange(items.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="panel stack gap-12" style={{ padding: 16 }}>
      <div className="row between">
        <div className="row gap-8">
          <span className="h4" style={{ fontSize: 14 }}>
            {title}
          </span>
          <span className="tiny">match</span>
          <div className="row gap-4">
            {(["and", "or"] as const).map((l) => (
              <button key={l} className="chip" data-active={logic === l} onClick={() => onLogic(l)} style={{ height: 26 }}>
                {l === "and" ? "all (AND)" : "any (OR)"}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...items, { id: uid("c"), left: "close", op: ">", right: "EMA(20)" }])}
        >
          + condition
        </button>
      </div>

      {items.length === 0 && <span className="error-text">At least one condition is required.</span>}

      <div className="stack gap-8">
        {items.map((c, i) => (
          <div key={c.id} className="row gap-8">
            <span className="tiny" style={{ width: 22 }}>
              {i === 0 ? "if" : logic}
            </span>
            <input
              className="input mono"
              style={{ minHeight: 34, height: 34 }}
              value={c.left}
              onChange={(e) => update(c.id, { left: e.target.value })}
              aria-label={`${prefix} condition ${i + 1} left side`}
            />
            <select
              className="select"
              style={{ width: 132, minHeight: 34, height: 34, padding: "0 8px" }}
              value={c.op}
              onChange={(e) => update(c.id, { op: e.target.value as Condition["op"] })}
              aria-label={`${prefix} condition ${i + 1} operator`}
            >
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {opLabel[o]}
                </option>
              ))}
            </select>
            <input
              className="input mono"
              style={{ minHeight: 34, height: 34 }}
              value={c.right}
              onChange={(e) => update(c.id, { right: e.target.value })}
              aria-label={`${prefix} condition ${i + 1} right side`}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onChange(items.filter((x) => x.id !== c.id))}
              aria-label={`Remove ${prefix} condition ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {fieldIssues.map((f) => (
        <span key={f.message} className="error-text">
          {f.message}
        </span>
      ))}
    </div>
  );
}

export function RulesEditor({
  strategy,
  onChange,
  issues,
}: {
  strategy: Strategy;
  onChange: (s: Strategy) => void;
  issues: ValidationIssue[];
}) {
  const patch = (p: Partial<Strategy>) => onChange({ ...strategy, ...p });
  const patchRisk = (p: Partial<Strategy["risk"]>) => onChange({ ...strategy, risk: { ...strategy.risk, ...p } });
  const patchCopilot = (p: Partial<Strategy["copilot"]>) =>
    onChange({ ...strategy, copilot: { ...strategy.copilot, ...p } });
  const issueFor = (field: string) => issues.find((i) => i.field === field && i.level === "error")?.message;
  const warnFor = (field: string) => issues.find((i) => i.field === field && i.level === "warning")?.message;

  return (
    <div className="stack gap-16">
      <div className="grid-2" style={{ gap: 16 }}>
        <Field label="Strategy name" error={issueFor("name")}>
          <input className="input" value={strategy.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Market">
            <select className="select" value={strategy.market} onChange={(e) => patch({ market: e.target.value })}>
              {MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timeframe">
            <select
              className="select"
              value={strategy.timeframe}
              onChange={(e) => patch({ timeframe: e.target.value as Strategy["timeframe"] })}
            >
              {["5m", "15m", "1h", "4h"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <ConditionList
        title="Entry"
        logic={strategy.entryLogic}
        items={strategy.entry}
        onChange={(entry) => patch({ entry })}
        onLogic={(entryLogic) => patch({ entryLogic })}
        issues={issues}
        prefix="entry"
      />
      <ConditionList
        title="Exit"
        logic={strategy.exitLogic}
        items={strategy.exit}
        onChange={(exit) => patch({ exit })}
        onLogic={(exitLogic) => patch({ exitLogic })}
        issues={issues}
        prefix="exit"
      />

      <div className="panel stack gap-16" style={{ padding: 16 }}>
        <div className="row between">
          <span className="h4" style={{ fontSize: 14 }}>
            Risk caps
          </span>
          <span className="tiny">platform ceiling: {PLATFORM_LIMITS.leverage}x · {PLATFORM_LIMITS.dailyLossPausePct}% daily · {PLATFORM_LIMITS.maxDrawdownPct}% drawdown</span>
        </div>

        <div className="grid-2" style={{ gap: 14 }}>
          <Field label={`Leverage · ${strategy.risk.leverage}x`} error={issueFor("risk.leverage")}>
            <input
              type="range"
              className="range"
              min={1}
              max={PLATFORM_LIMITS.leverage}
              step={0.5}
              value={strategy.risk.leverage}
              onChange={(e) => patchRisk({ leverage: Number(e.target.value) })}
            />
          </Field>
          <Field label={`Max position · ${strategy.risk.maxPositionPct}% of equity`} hint={warnFor("risk.maxPositionPct")}>
            <input
              type="range"
              className="range"
              min={5}
              max={100}
              step={5}
              value={strategy.risk.maxPositionPct}
              onChange={(e) => patchRisk({ maxPositionPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="Per-trade stop (%)" error={issueFor("risk.stopLossPct")} hint={warnFor("risk.stopLossPct")}>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0.1}
              value={strategy.risk.stopLossPct}
              onChange={(e) => patchRisk({ stopLossPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="Take profit (%)">
            <input
              className="input"
              type="number"
              step={0.1}
              min={0.1}
              value={strategy.risk.takeProfitPct}
              onChange={(e) => patchRisk({ takeProfitPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="Daily loss pause (%)" error={issueFor("risk.dailyLossPausePct")}>
            <input
              className="input"
              type="number"
              step={1}
              min={1}
              max={PLATFORM_LIMITS.dailyLossPausePct}
              value={strategy.risk.dailyLossPausePct}
              onChange={(e) => patchRisk({ dailyLossPausePct: Number(e.target.value) })}
            />
          </Field>
          <Field label="Emergency stop (% drawdown)" error={issueFor("risk.maxDrawdownPct")}>
            <input
              className="input"
              type="number"
              step={1}
              min={3}
              max={PLATFORM_LIMITS.maxDrawdownPct}
              value={strategy.risk.maxDrawdownPct}
              onChange={(e) => patchRisk({ maxDrawdownPct: Number(e.target.value) })}
            />
          </Field>
        </div>
        <span className="tiny">
          These caps are enforced by the risk service on every order, independent of the Copilot. They are server-side
          limits — not an on-chain guarantee — and loss triggers are not a guarantee of maximum realised loss during gaps.
        </span>
      </div>

      <div className="panel stack gap-14" style={{ padding: 16 }}>
        <div className="row between">
          <span className="h4" style={{ fontSize: 14 }}>
            Copilot
          </span>
          <span className="tiny">reference-equivalent configuration</span>
        </div>
        <div className="row gap-6 wrap">
          {(["advisory", "veto", "off"] as const).map((m) => (
            <button key={m} className="chip" data-active={strategy.copilot.mode === m} onClick={() => patchCopilot({ mode: m })}>
              {m === "advisory" ? "Advisory (can trim)" : m === "veto" ? "Veto only" : "Off (rules only)"}
            </button>
          ))}
        </div>
        {["allowExtraTrades", "fallbackToRules", "rulesOnlyTwin"].map((k) => (
          <label key={k} className="row gap-8" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={strategy.copilot[k as keyof Strategy["copilot"]] as boolean}
              onChange={(e) => patchCopilot({ [k]: e.target.checked } as Partial<Strategy["copilot"]>)}
            />
            <span className="small">
              {k === "allowExtraTrades"
                ? "Allow Copilot to propose additional trades (still bounded by risk caps)"
                : k === "fallbackToRules"
                  ? "Fall back to rules-only when the provider errors or credits run out"
                  : "Record a rules-only twin for every session"}
            </span>
          </label>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <Field
          label="Creator fee on winning trades"
          hint="Max 20% of the profit of each winning trade. Losing trades are not netted against it."
          error={issueFor("feeChoicePct")}
        >
          <select
            className="select"
            value={strategy.feeChoicePct}
            onChange={(e) => patch({ feeChoicePct: Number(e.target.value) })}
          >
            {[0, 5, 10, 15, 20].map((f) => (
              <option key={f} value={f}>
                {f}%
              </option>
            ))}
          </select>
        </Field>
        <Field label="Strategy description (public)" hint="Shown on the agent page. Grounded in the rules above.">
          <input className="input" value={strategy.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
