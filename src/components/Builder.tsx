"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { Strategy } from "@/lib/types";
import {
  PLATFORM_LIMITS,
  buildStrategy,
  clampLeverage,
  diffStrategies,
  opLabel,
  readPrompt,
  strategyToCode,
  validateStrategy,
} from "@/lib/strategy";
import { feeSplit, runBacktest, type BacktestResult } from "@/lib/backtest";
import { actions, uid } from "@/lib/store";
import { cx, num, pct, pctSigned, usd } from "@/lib/format";
import { LineChart } from "./Chart";
import { CovarMark, Field, Modal, ProvenanceBadge, useToast } from "./ui";
import { RulesEditor } from "./RulesEditor";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  bullets?: string[];
  warnings?: string[];
  questions?: string[];
  diff?: { kind: string; text: string }[];
};

const STARTERS = [
  "Fade ETH panic wicks on the 15m: long only below the lower Bollinger band while RSI is under 32, above the 200 EMA, stop 1.5%.",
  "Trend follow BTC on the 4h with EMA 20/60 cross, exit on cross back, keep it conservative.",
  "Carry strategy: long ETH perp only when 8h funding is negative, close when funding turns positive, low leverage.",
  "Breakout on SOL: enter above the 20-bar high with volume, exit below the 20 EMA, moderate risk, AI must approve.",
];

const TABS = ["Chat", "Rules", "Code", "Backtest"] as const;
type Tab = (typeof TABS)[number];

export function Builder() {
  const router = useRouter();
  const { toast, node } = useToast();

  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "m0",
      role: "assistant",
      text:
        "Describe the strategy in plain language. I'll turn it into a typed rule set, show you every field, and ask about anything you left out — I won't invent conditions you didn't ask for.",
    },
  ]);
  const [input, setInput] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [previous, setPrevious] = useState<Strategy | null>(null);
  const [tab, setTab] = useState<Tab>("Chat");
  const [thinking, setThinking] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [ack, setAck] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => (strategy ? validateStrategy(strategy) : []), [strategy]);
  const errors = issues.filter((i) => i.level === "error");
  const diff = useMemo(
    () => (previous && strategy ? diffStrategies(previous, strategy) : []),
    [previous, strategy]
  );

  const scrollChat = () => setTimeout(() => chatRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 30);

  const respond = (prompt: string) => {
    setThinking(true);
    scrollChat();
    void applyPrompt(prompt);
  };

  async function applyPrompt(prompt: string) {
    if (!strategy) {
      // Ask the Copilot route: a model interprets when configured, otherwise the
      // deterministic rules parser answers. The engine label travels with the result.
      let engineLabel = "local rules parser";
      let s: Strategy | null = null;
      let unsupported: string[] = [];
      let questions: string[] = [];
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = (await res.json()) as import("@/lib/copilot").CopilotResponse;
        if (data.ok && data.strategy) {
          s = data.strategy;
          unsupported = data.unsupported;
          questions = data.questions;
          engineLabel =
            data.engine === "model"
              ? `${data.providerLabel}${data.credits ? ` · charged $${data.credits.chargedUsd.toFixed(4)} of credits (balance $${data.credits.balanceUsd.toFixed(4)})` : ""}`
              : data.engine === "rules-fallback"
                ? `rules parser (model failed${data.credits ? `; provider usage still billed $${data.credits.chargedUsd.toFixed(4)}` : ""})${data.note ? `. ${data.note.replace(/; the deterministic rules parser produced this draft instead\.$/, "").replace(/^Model call failed \((.*)\)$/, "Reason: $1")}` : ""}`
                : data.engine === "rules-credits"
                  ? `rules parser, free (${data.note ?? "no Copilot credits"})`
                  : "rules parser — no model key configured";
        }
      } catch {
        /* route unreachable — fall through to the local parser */
      }
      if (!s) {
        const local = buildStrategy(prompt);
        s = local.strategy;
        unsupported = local.unsupported;
        questions = local.questions;
        engineLabel = "local rules parser — API route unreachable";
      }
      setTimeout(() => {
        setStrategy(s);
        setPrevious(null);
        const bullets = [
          `${s.market} · ${s.timeframe} · ${s.entry.length} entry condition${s.entry.length === 1 ? "" : "s"} (${s.entryLogic.toUpperCase()}), ${s.exit.length} exit conditions (${s.exitLogic.toUpperCase()}).`,
          `Risk: ${s.risk.leverage}x leverage, ${s.risk.maxPositionPct}% max position, ${s.risk.stopLossPct}% stop, ${s.risk.dailyLossPausePct}% daily pause, ${s.risk.maxDrawdownPct}% drawdown stop.`,
          `Copilot mode: ${s.copilot.mode} · rules-only twin ${s.copilot.rulesOnlyTwin ? "recorded" : "not recorded"}.`,
        ];
        setMessages((m) => [
          ...m,
          { id: uid("m"), role: "user", text: prompt },
          {
            id: uid("m"),
            role: "assistant",
            text: `Draft created — “${s.name}”. Interpreted by: ${engineLabel}. Here is exactly what I encoded, and what I could not:`,
            bullets,
            warnings: unsupported,
            questions,
          },
        ]);
        setThinking(false);
        scrollChat();
      }, 500);
      return;
    }
    setTimeout(() => {
        const intent = readPrompt(prompt);
        const next: Strategy = clampLeverage({
          ...strategy,
          market: /\b(eth|btc|sol|hype)\b/i.test(prompt) ? intent.intent.market : strategy.market,
          timeframe: /\b(5m|15m|4h|1h|scalp|swing)\b/i.test(prompt) ? intent.intent.timeframe : strategy.timeframe,
          risk: {
            ...strategy.risk,
            leverage: /\b(\d+(\.\d+)?)x\b/.test(prompt)
              ? Number(prompt.match(/\b(\d+(?:\.\d+)?)x\b/i)?.[1] ?? strategy.risk.leverage)
              : strategy.risk.leverage,
            stopLossPct: /stop (?:at |of )?(\d+(?:\.\d+)?)%/i.test(prompt)
              ? Number(prompt.match(/stop (?:at |of )?(\d+(?:\.\d+)?)%/i)?.[1] ?? strategy.risk.stopLossPct)
              : strategy.risk.stopLossPct,
            dailyLossPausePct: /daily (?:loss )?(?:pause|limit) (?:of |at )?(\d+(?:\.\d+)?)%/i.test(prompt)
              ? Number(prompt.match(/daily (?:loss )?(?:pause|limit) (?:of |at )?(\d+(?:\.\d+)?)%/i)?.[1] ?? strategy.risk.dailyLossPausePct)
              : strategy.risk.dailyLossPausePct,
            maxDrawdownPct: /(?:drawdown|dd) (?:stop |limit )?(?:of |at )?(\d+(?:\.\d+)?)%/i.test(prompt)
              ? Number(prompt.match(/(?:drawdown|dd) (?:stop |limit )?(?:of |at )?(\d+(?:\.\d+)?)%/i)?.[1] ?? strategy.risk.maxDrawdownPct)
              : strategy.risk.maxDrawdownPct,
          },
          copilot: {
            ...strategy.copilot,
            mode: /\b(no ai|rules only|disable copilot)\b/i.test(prompt)
              ? "off"
              : /\b(veto|must approve)\b/i.test(prompt)
                ? "veto"
                : strategy.copilot.mode,
          },
        });
        setPrevious(strategy);
        setStrategy(next);
        setBacktest(null);
        setShowDiff(true);
        setMessages((m) => [
          ...m,
          { id: uid("m"), role: "user", text: prompt },
          {
            id: uid("m"),
            role: "assistant",
            text: "Applied as a new draft revision. The diff is open on the right — nothing is live until you publish a version.",
            warnings: intent.unsupported,
          },
        ]);
        setThinking(false);
        scrollChat();
      }, 520);
  }

  const send = () => {
    const p = input.trim();
    if (!p || thinking) return;
    setInput("");
    respond(p);
  };

  const run = () => {
    if (!strategy) return;
    setRunning(true);
    setTab("Backtest");
    setTimeout(() => {
      const result = runBacktest(strategy, 10_000);
      setBacktest(result);
      setRunning(false);
      toast("Backtest finished · seed recorded for reproducibility");
    }, 700);
  };

  const updateStrategy = (s: Strategy) => {
    setPrevious(strategy);
    setStrategy(s);
    setBacktest(null);
  };

  const publish = () => {
    if (!strategy) return;
    const agent = actions.publishStrategy({ ...strategy, name: agentName || strategy.name }, agentName || strategy.name);
    setPublishOpen(false);
    toast("Version 1 published · practice session available");
    router.push(`/agents/${agent.id}`);
  };

  const fee = backtest ? feeSplit(backtest.trades, strategy?.feeChoicePct ?? 10) : null;

  return (
    <div className="container section-tight">
      {node}
      <div className="row between wrap gap-12" style={{ marginBottom: 18 }}>
        <div className="stack gap-4">
          <div className="row gap-8">
            <Link href="/studio" className="tiny link-primary">
              Studio
            </Link>
            <span className="tiny">/</span>
            <span className="tiny">New strategy</span>
          </div>
          <h1 className="h2" style={{ fontSize: 26 }}>
            {strategy ? strategy.name : "Describe your strategy"}
          </h1>
        </div>
        <div className="row gap-8">
          <span className={cx("badge", strategy ? "badge-blue" : "badge-outline")}>
            {strategy ? `Draft v${strategy.version}` : "No draft"}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={!strategy}
            onClick={() => {
              if (!strategy) return;
              actions.saveDraft(strategy);
              toast("Draft saved to Studio");
            }}
          >
            Save draft
          </button>
          <button className="btn btn-primary btn-sm" disabled={!strategy || errors.length > 0} onClick={run}>
            Run backtest
          </button>
        </div>
      </div>

      <div className="two-col">
        {/* ------------------------------- main ------------------------------- */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="row between" style={{ padding: "0 8px" }}>
            <div className="tabs" style={{ borderBottom: 0, flex: 1 }}>
              {TABS.map((t) => (
                <button key={t} className="tab" data-active={tab === t} onClick={() => setTab(t)} disabled={!strategy && t !== "Chat"}>
                  {t}
                </button>
              ))}
            </div>
            <span className="tiny nav-hide-sm">{strategy ? `${strategy.market} · ${strategy.timeframe}` : "assistant"}</span>
          </div>
          <hr className="divider" />

          {tab === "Chat" && (
            <div className="stack">
              <div className="chat" ref={chatRef} style={{ padding: 16, minHeight: 300 }}>
                {messages.map((m) => (
                  <div key={m.id} className={cx("msg", m.role === "user" ? "msg-user" : "msg-assistant")}>
                    {m.role === "assistant" && <CovarMark />}
                    <div className="msg-body stack gap-8">
                      <span>{m.text}</span>
                      {m.bullets && (
                        <ul className="msg-list">
                          {m.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {m.warnings?.length ? (
                        <div className="stack gap-4" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          <span className="tiny strong" style={{ color: "var(--warning)" }}>
                            Not encoded
                          </span>
                          {m.warnings.map((w) => (
                            <span key={w} className="tiny">
                              • {w}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {m.questions?.length ? (
                        <div className="stack gap-4" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          <span className="tiny strong" style={{ color: "var(--primary)" }}>
                            Confirm with me
                          </span>
                          {m.questions.map((w) => (
                            <span key={w} className="tiny">
                              • {w}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="msg msg-assistant">
                    <CovarMark />
                    <div className="msg-body row gap-6">
                      <span className="skel" style={{ width: 120, height: 8 }} />
                    </div>
                  </div>
                )}
              </div>

              {!strategy && (
                <div className="row gap-6 wrap" style={{ padding: "0 16px 12px" }}>
                  {STARTERS.map((s) => (
                    <button key={s} className="chip" onClick={() => respond(s)} style={{ height: "auto", padding: "6px 11px" }}>
                      {s.length > 74 ? `${s.slice(0, 74)}…` : s}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
                <div className="row gap-8" style={{ alignItems: "flex-end" }}>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 44, maxHeight: 120 }}
                    placeholder={strategy ? "Refine it: “switch to 4h”, “stop at 2%”, “disable Copilot”…" : "Describe the idea…"}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    aria-label="Message to the strategy assistant"
                  />
                  <button className="btn btn-primary" onClick={send} disabled={!input.trim() || thinking}>
                    Send
                  </button>
                </div>
                <span className="tiny" style={{ display: "block", marginTop: 6 }}>
                  Enter to send · Shift+Enter for a new line · generated rules never place orders directly
                </span>
              </div>
            </div>
          )}

          {tab === "Rules" && strategy && (
            <div style={{ padding: 16 }}>
              <RulesEditor strategy={strategy} onChange={updateStrategy} issues={issues} />
            </div>
          )}

          {tab === "Code" && strategy && (
            <div style={{ padding: 16 }} className="stack gap-12">
              <div className="row between">
                <span className="small">
                  Read-only view of the compiled rule set. This is the same representation the execution service evaluates.
                </span>
                <span className="badge badge-outline">strategy.ts</span>
              </div>
              <pre className="code">{strategyToCode(strategy)}</pre>
              <span className="tiny">
                Indicators compile to deterministic helpers; no generated text is executed as code. Unsupported helpers
                would fail validation instead of being silently ignored.
              </span>
            </div>
          )}

          {tab === "Backtest" && (
            <div style={{ padding: 16 }} className="stack gap-16">
              {running && (
                <div className="stack center gap-12" style={{ padding: "48px 0" }}>
                  <span className="spin" style={{ width: 22, height: 22, border: "2px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%" }} />
                  <span className="small">Replaying dataset · applying fees, slippage and funding…</span>
                </div>
              )}

              {!running && !backtest && (
                <div className="stack center gap-12" style={{ padding: "48px 0", textAlign: "center" }}>
                  <h4 className="h4">No backtest yet</h4>
                  <p className="body" style={{ maxWidth: 380 }}>
                    {strategy
                      ? "Run the strategy against the pinned research dataset. Costs are applied on every fill and the seed is recorded so the run can be reproduced."
                      : "Create a draft first, then run a backtest."}
                  </p>
                  {strategy && (
                    <button className="btn btn-primary" onClick={run}>
                      Run backtest
                    </button>
                  )}
                </div>
              )}

              {!running && backtest && (
                <>
                  <div className="grid-4">
                    <div className="panel" style={{ padding: 12 }}>
                      <span className="tiny">Total return</span>
                      <div className={cx("num strong", backtest.metrics.returnPct >= 0 ? "pos" : "neg")} style={{ fontSize: 19 }}>
                        {pctSigned(backtest.metrics.returnPct)}
                      </div>
                      <span className="tiny">benchmark {pctSigned(backtest.metrics.benchmarkPct)}</span>
                    </div>
                    <div className="panel" style={{ padding: 12 }}>
                      <span className="tiny">Max drawdown</span>
                      <div className="num strong neg" style={{ fontSize: 19 }}>
                        {pct(backtest.metrics.maxDrawdownPct)}
                      </div>
                      <span className="tiny">limit {strategy?.risk.maxDrawdownPct}%</span>
                    </div>
                    <div className="panel" style={{ padding: 12 }}>
                      <span className="tiny">Sharpe</span>
                      <div className="num strong" style={{ fontSize: 19 }}>
                        {backtest.metrics.sharpe.toFixed(2)}
                      </div>
                      <span className="tiny">daily, annualised</span>
                    </div>
                    <div className="panel" style={{ padding: 12 }}>
                      <span className="tiny">Trades</span>
                      <div className="num strong" style={{ fontSize: 19 }}>
                        {backtest.metrics.tradeCount}
                      </div>
                      <span className="tiny">win {backtest.metrics.winRatePct.toFixed(0)}%</span>
                    </div>
                  </div>

                  <LineChart
                    height={250}
                    baseline={10_000}
                    series={[
                      { key: "eq", label: "Strategy (net)", color: "#3B5BDB", data: backtest.equity, area: true, width: 2 },
                      { key: "bm", label: "Buy & hold benchmark", color: "#9AA3B5", data: backtest.benchmark, dash: "4 4", width: 1.4 },
                      { key: "tw", label: "Rules-only twin", color: "#6B7280", data: backtest.twin, dash: "2 3", width: 1.4 },
                    ]}
                    yFormat={(n) => `$${Math.round(n).toLocaleString("en-US")}`}
                  />

                  {backtest.stoppedAtBar !== undefined && (
                    <div className="notice notice-warn">
                      <div>
                        <strong>Emergency stop triggered at bar {backtest.stoppedAtBar}.</strong> {backtest.stopReason}
                      </div>
                    </div>
                  )}

                  <div className="grid-2" style={{ gap: 14 }}>
                    <div className="panel stack gap-8" style={{ padding: 14 }}>
                      <span className="small strong">Assumptions</span>
                      <span className="tiny">{backtest.dataset.dataset}</span>
                      <span className="tiny">
                        taker {backtest.dataset.takerFeeBps} bps · slippage {backtest.dataset.slippageBps} bps · funding{" "}
                        {backtest.dataset.fundingBpsPer8h} bps/8h · latency {backtest.dataset.latencyMs} ms
                      </span>
                      <span className="tiny">{backtest.bars} bars · starting capital $10,000 · reproducible seed recorded</span>
                      {fee && (
                        <span className="tiny">
                          Fee model at {strategy?.feeChoicePct}%: {usd(fee.feeUsd)} on {usd(fee.winningProfit)} winning profit →
                          creator {usd(fee.creatorUsd)} / platform {usd(fee.platformUsd)}. {fee.losingTradedNotNetted} losing
                          trades not netted.
                        </span>
                      )}
                    </div>
                    <div className="panel stack gap-8" style={{ padding: 14 }}>
                      <span className="small strong">Read this before believing the number</span>
                      <span className="tiny">
                        Backtest results are historical simulations on a fixed dataset. They are not live performance, not
                        annualised promises, and they exclude market impact beyond the modelled slippage.
                      </span>
                      <ProvenanceBadge kind="backtest" />
                    </div>
                  </div>

                  <div className="panel table-wrap">
                    <table className="table table-min">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Side</th>
                          <th className="right">Entry</th>
                          <th className="right">Exit</th>
                          <th className="right">P&amp;L</th>
                          <th className="right">Fees</th>
                          <th className="right">Bars</th>
                          <th>Exit reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtest.trades.slice(0, 8).map((t) => (
                          <tr key={t.id}>
                            <td className="num">{t.id}</td>
                            <td>
                              <span className={cx("badge", t.side === "long" ? "badge-blue" : "badge-amber")}>{t.side}</span>
                            </td>
                            <td className="right num">
                              {t.entryPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="right num">{t.exitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                            <td className={cx("right num strong", t.pnlUsd >= 0 ? "pos" : "neg")}>{usd(t.pnlUsd)}</td>
                            <td className="right num tiny">{usd(t.feesUsd)}</td>
                            <td className="right num">{t.bars}</td>
                            <td className="small">{t.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {backtest.trades.length > 8 && (
                      <div className="tiny" style={{ padding: "8px 14px" }}>
                        Showing 8 of {backtest.trades.length} trades.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------- sidebar ------------------------------- */}
        <div className="stack gap-16 sticky-side">
          <div className="card card-pad stack gap-12">
            <div className="row between">
              <span className="small strong">Validation</span>
              <span className={cx("badge", errors.length ? "badge-red" : "badge-green")}>
                {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : strategy ? "Passing" : "Waiting"}
              </span>
            </div>
            {!strategy && <span className="tiny">Create a draft from the chat to run validation.</span>}
            {strategy && issues.length === 0 && (
              <span className="tiny">All rules typed, risk caps within platform limits, exit conditions present.</span>
            )}
            <div className="stack gap-8">
              {issues.map((i, idx) => (
                <div key={idx} className={cx("notice", i.level === "warning" && "notice-warn")} style={{ padding: "8px 10px" }}>
                  <span className="tiny" style={{ color: "inherit" }}>
                    <strong>{i.level === "error" ? "Error" : "Warning"}</strong> · {i.message}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {strategy && (
            <div className="card card-pad stack gap-10">
              <span className="small strong">Rule summary</span>
              <div className="stack gap-6">
                <div className="row between">
                  <span className="tiny">Entry ({strategy.entryLogic})</span>
                  <span className="tiny mono">{strategy.entry.length} cond.</span>
                </div>
                {strategy.entry.map((c) => (
                  <span key={c.id} className="mono" style={{ fontSize: 11.5 }}>
                    {c.left} {opLabel[c.op]} {c.right}
                  </span>
                ))}
                <div className="row between" style={{ marginTop: 4 }}>
                  <span className="tiny">Exit ({strategy.exitLogic})</span>
                  <span className="tiny mono">{strategy.exit.length} cond.</span>
                </div>
                {strategy.exit.map((c) => (
                  <span key={c.id} className="mono" style={{ fontSize: 11.5 }}>
                    {c.left} {opLabel[c.op]} {c.right}
                  </span>
                ))}
              </div>
              <hr className="divider" />
              <div className="row between">
                <span className="tiny">Leverage</span>
                <span className="small strong num">{strategy.risk.leverage}x / {PLATFORM_LIMITS.leverage}x</span>
              </div>
              <div className="row between">
                <span className="tiny">Daily pause</span>
                <span className="small strong num">{strategy.risk.dailyLossPausePct}%</span>
              </div>
              <div className="row between">
                <span className="tiny">Drawdown stop</span>
                <span className="small strong num">{strategy.risk.maxDrawdownPct}%</span>
              </div>
              <div className="row between">
                <span className="tiny">Copilot</span>
                <span className="small strong">{strategy.copilot.mode}</span>
              </div>
              {diff.length > 0 && (
                <button className="btn btn-soft btn-sm" onClick={() => setShowDiff(true)}>
                  View diff ({diff.filter((d) => d.kind !== "same").length} changed lines)
                </button>
              )}
            </div>
          )}

          <div className="card card-pad stack gap-10">
            <span className="small strong">Next step</span>
            <ol className="stack gap-8" style={{ paddingLeft: 18, margin: 0 }}>
              {[
                ["Draft rules", !!strategy],
                ["Validation passing", !!strategy && errors.length === 0],
                ["Backtest run", !!backtest],
                ["Publish version 1", false],
              ].map(([label, done]) => (
                <li key={label as string} className="small" style={{ color: done ? "var(--positive)" : "var(--muted)" }}>
                  {label as string} {done ? "✓" : ""}
                </li>
              ))}
            </ol>
            <button
              className="btn btn-primary btn-block"
              disabled={!strategy || errors.length > 0 || !backtest}
              onClick={() => {
                setAgentName(strategy?.name ?? "");
                setPublishOpen(true);
              }}
            >
              Publish version 1
            </button>
            <span className="tiny">
              Publishing requires a passing backtest. The vault stays closed until practice completes and you explicitly
              open it with an investor notice.
            </span>
          </div>
        </div>
      </div>

      {/* --------------------------------- diff modal -------------------------------- */}
      <Modal
        open={showDiff && diff.length > 0}
        onClose={() => setShowDiff(false)}
        title="Draft revision diff"
        subtitle="Nothing is live. This is a new draft revision, not a published version."
        footer={
          <>
            <span className="tiny">Draft revisions are local until published.</span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowDiff(false)}>
              Accept revision
            </button>
          </>
        }
      >
        <div className="code">
          {diff.map((d, i) => (
            <div key={i} className={d.kind === "add" ? "diff-add" : d.kind === "del" ? "diff-del" : undefined}>
              {d.kind === "add" ? "+ " : d.kind === "del" ? "− " : "  "}
              {d.text}
            </div>
          ))}
        </div>
      </Modal>

      {/* -------------------------------- publish modal ------------------------------- */}
      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="Publish version 1"
        subtitle="Creates the agent, its version record and a practice session. No vault is opened yet."
        footer={
          <>
            <span className="tiny">{agentName.trim() ? "Ready" : "Name required"}</span>
            <button className="btn btn-primary btn-sm" disabled={!agentName.trim() || !ack} onClick={publish}>
              Publish
            </button>
          </>
        }
      >
        <div className="stack gap-16">
          <Field label="Agent name" hint="Public name on Discover and the agent page.">
            <input className="input" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
          </Field>
          <div className="panel stack gap-8" style={{ padding: 14 }}>
            <div className="row between">
              <span className="tiny">Backtest return (labelled)</span>
              <span className={cx("small strong num", (backtest?.metrics.returnPct ?? 0) >= 0 ? "pos" : "neg")}>
                {backtest ? pctSigned(backtest.metrics.returnPct) : "—"}
              </span>
            </div>
            <div className="row between">
              <span className="tiny">Max drawdown</span>
              <span className="small strong num neg">{backtest ? pct(backtest.metrics.maxDrawdownPct) : "—"}</span>
            </div>
            <div className="row between">
              <span className="tiny">Trades</span>
              <span className="small strong num">{backtest ? num(backtest.metrics.tradeCount) : "—"}</span>
            </div>
            <div className="tiny">These figures stay attached to the backtest label and are never displayed as live results.</div>
          </div>
          <label className="row gap-8" style={{ alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" className="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
            <span className="small">
              I understand this publishes the rule set publicly, that practice results are simulated, and that opening a
              vault requires a separate investor notice 48 hours before activation.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
