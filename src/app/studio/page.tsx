"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Builder } from "@/components/Builder";
import { InstantStockAgent } from "@/components/stock/InstantStockAgent";
import { Icon } from "@/components/Icon";
import { actions, useCovar } from "@/lib/store";
import { cx, pctSigned, timeAgo, usd, usdSigned } from "@/lib/format";
import { Empty, ProvenanceBadge, TokenLogo, useToast } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useCredits } from "@/lib/creditsClient";
import { STALE_AFTER_MS, VENUE_SHORT, bookFor, priceFor, sourceLabel, usePrices } from "@/lib/usePrices";
import { Sparkline } from "@/components/Chart";
import { buildStrategy } from "@/lib/strategy";
import type { PriceSnapshot } from "@/lib/prices";
import type { Agent, PracticeRun, Strategy } from "@/lib/types";

const CAPITAL_CHOICES = [1_000, 10_000, 50_000, 100_000];

/** Practice capital at work: the agent's own position % × leverage, else 35% of capital. */
const notionalPctOf = (s?: Strategy) => (s ? Math.min(500, Math.max(5, s.risk.maxPositionPct * s.risk.leverage)) : 35);

const fmtPrice = (p?: number) =>
  p === undefined
    ? "—"
    : `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: p < 10 ? 4 : p < 1000 ? 3 : 2 })}`;

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Feed provenance badge: green only while marks are live and fresh. */
function FeedBadge({ prices, now }: { prices: PriceSnapshot | null; now: number }) {
  if (!prices) return <span className="pill">connecting…</span>;
  const age = now - Date.parse(prices.at);
  if (prices.ok && age < STALE_AFTER_MS)
    return (
      <span className="pill pill-onchain" data-testid="live-marks-badge" title={`Live marks from ${sourceLabel(prices)}. Read-only market data; fills are simulated.`}>
        <span className="pill-dot" aria-hidden />
        Live marks · {VENUE_SHORT[prices.source]}
      </span>
    );
  if (prices.stale || prices.ok)
    return (
      <span className="pill pill-amber" data-testid="live-marks-badge" title="The feed has not refreshed recently. P&L holds the last mark until it does.">
        Stale marks · {VENUE_SHORT[prices.source]}
      </span>
    );
  return (
    <span className="pill" data-testid="live-marks-badge" title="No market feed reachable. Practice runs on simulated ticks and says so.">
      Simulated ticks
    </span>
  );
}

/** Live mark with a calm up/down flash, top of book and freshness. */
function LiveTicker({ market, prices, now, entry }: { market: string; prices: PriceSnapshot | null; now: number; entry?: number }) {
  const price = priceFor(prices, market);
  const book = bookFor(prices, market);
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; k: number } | null>(null);
  useEffect(() => {
    if (price === undefined) return;
    if (prev.current !== undefined && price !== prev.current) setFlash({ dir: price > prev.current ? "up" : "down", k: Date.now() });
    prev.current = price;
  }, [price]);
  const age = prices ? Math.max(0, Math.round((now - Date.parse(prices.at)) / 1000)) : null;
  const spreadBps = book ? ((book.ask - book.bid) / ((book.ask + book.bid) / 2)) * 10_000 : null;
  const sinceEntry = entry && price ? ((price - entry) / entry) * 100 : null;
  return (
    <div className="ticker" data-testid="live-ticker">
      <div className="row gap-8" style={{ alignItems: "baseline", flexWrap: "nowrap" }}>
        <span className="stat-label">{market} mark</span>
        {flash && (
          <span key={`a${flash.k}`} className={cx("ticker-arrow", flash.dir === "up" ? "pos" : "neg")} aria-hidden>
            {flash.dir === "up" ? "▲" : "▼"}
          </span>
        )}
      </div>
      <div className="row gap-10" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <span key={flash?.k ?? 0} className={cx("ticker-price mono-num", flash && `flash-${flash.dir}`)} data-testid="live-price">
          {fmtPrice(price)}
        </span>
        {sinceEntry !== null && (
          <span className={cx("mono-num tiny", sinceEntry >= 0 ? "pos" : "neg")}>{pctSigned(sinceEntry, 3)} since entry</span>
        )}
      </div>
      <span className="tiny mono">
        {book ? `bid ${fmtPrice(book.bid)} · ask ${fmtPrice(book.ask)} · spread ${spreadBps!.toFixed(1)} bps · ` : ""}
        {age === null ? "connecting…" : `updated ${age}s ago`}
      </span>
    </div>
  );
}

type CardItem = {
  id: string;
  name: string;
  market: string;
  timeframe: string;
  kind: "draft" | "agent";
  runs: string;
  agent?: Agent;
  strategy?: Strategy;
};

function AgentCard({
  item,
  run,
  prices,
  now,
  onStart,
  onStop,
  onDelete,
  onPauseToggle,
}: {
  item: CardItem;
  run?: PracticeRun;
  prices: PriceSnapshot | null;
  now: number;
  onStart: (capital: number) => void;
  onStop: () => void;
  onDelete?: () => void;
  onPauseToggle?: () => void;
}) {
  const [capital, setCapital] = useState(10_000);
  const running = run?.status === "running";
  const a = item.agent;
  const up = (run?.pnlUsd ?? 0) >= 0;
  return (
    <div className={cx("rcard practice-card", running && "practice-card-on")} data-testid="agent-card">
      <div className="row gap-10" style={{ flexWrap: "nowrap", minWidth: 0 }}>
        <TokenLogo market={item.market} size={30} />
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          {a ? (
            <Link href={`/agents/${a.id}`} className="strong truncate" style={{ color: "var(--ink)", fontSize: 14.5 }}>
              {item.name}
            </Link>
          ) : (
            <span className="strong truncate" style={{ color: "var(--ink)", fontSize: 14.5 }}>
              {item.name}
            </span>
          )}
          <span className="tiny mono">
            {item.market} · {item.timeframe} · {item.runs}
          </span>
        </div>
        <span className="spacer" />
        {item.kind === "draft" ? <span className="pill">draft</span> : <ProvenanceBadge kind={a!.provenance} />}
      </div>

      {running ? (
        <>
          <div className="row between gap-8 wrap">
            {run!.priceMode === "live" ? <FeedBadge prices={prices} now={now} /> : <span className="pill" data-testid="live-marks-badge">Simulated ticks</span>}
            <span className="pill pill-accent">practice · pretend money</span>
          </div>
          {run!.priceMode === "live" ? (
            <LiveTicker market={item.market} prices={prices} now={now} entry={run!.entryPrice} />
          ) : (
            <span className="tiny">Started without a market feed, so this run stays on simulated ticks until you restart it.</span>
          )}
          <div className="practice-mini">
            <div className="stack" style={{ gap: 2 }}>
              <span className="stat-label">Equity</span>
              <span className="mono-num">{usd(run!.capitalUsd + run!.pnlUsd)}</span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="stat-label">P&amp;L</span>
              <span className={cx("mono-num", up ? "pos" : "neg")}>
                {usdSigned(run!.pnlUsd)} <span className="tiny">({pctSigned((run!.pnlUsd / run!.capitalUsd) * 100)})</span>
              </span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="stat-label">Running</span>
              <span className="mono-num">{fmtDuration(now - Date.parse(run!.startedAt))}</span>
            </div>
          </div>
          <button className="btn btn-danger btn-block" data-testid="stop-practice" onClick={onStop}>
            Stop practice
          </button>
        </>
      ) : (
        <>
          <p className="tiny" style={{ margin: 0 }}>
            Practice runs {item.kind === "draft" ? "this draft" : `the published ${item.runs}`} on live Lighter marks with pretend money.
            Fills are simulated; nothing touches your wallet or vault.
          </p>
          <label className="row between gap-8">
            <span className="stat-label">Pretend capital</span>
            <select className="select select-sm" value={capital} onChange={(e) => setCapital(Number(e.target.value))} aria-label="Practice capital" data-testid="practice-capital">
              {CAPITAL_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {usd(c)}
                </option>
              ))}
            </select>
          </label>
          {run?.status === "stopped" && (
            <span className="tiny mono">
              last run {usdSigned(run.pnlUsd)} · saved to practice history
            </span>
          )}
          <button className="btn btn-primary btn-block" data-testid="start-practice" onClick={() => onStart(capital)}>
            Start practice
          </button>
        </>
      )}

      <div className="row gap-6 wrap">
        {item.kind === "draft" ? (
          <>
            <Link href="/studio?new=1" className="btn btn-ghost btn-sm">
              Open in builder
            </Link>
            {onDelete && !running && (
              <button className="btn btn-ghost btn-sm" onClick={onDelete}>
                Delete
              </button>
            )}
          </>
        ) : (
          <>
            <Link href={`/agents/${a!.id}`} className="btn btn-ghost btn-sm">
              Agent page
            </Link>
            {onPauseToggle && (a!.status === "live" || a!.status === "paused") && (
              <button className="btn btn-ghost btn-sm" onClick={onPauseToggle}>
                {a!.status === "live" ? "Pause live" : "Resume live"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- modes */

type StudioMode = "quant" | "stock";
const MODE_KEY = "covar.studio.mode.v1";

/** ?mode=stock wins; otherwise the last choice in this browser; default: the quant builder. */
function useStudioMode(fromUrl: string | null): [StudioMode, (m: StudioMode) => void] {
  const [mode, setMode] = useState<StudioMode>(fromUrl === "stock" ? "stock" : "quant");
  useEffect(() => {
    if (fromUrl === "stock" || fromUrl === "quant") return setMode(fromUrl);
    try {
      if (localStorage.getItem(MODE_KEY) === "stock") setMode("stock");
    } catch {
      /* ignore */
    }
  }, [fromUrl]);
  const set = (m: StudioMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  return [mode, set];
}

function StudioModeSwitch({ mode, onMode }: { mode: StudioMode; onMode: (m: StudioMode) => void }) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Studio mode" data-testid="studio-mode">
      <button role="tab" aria-selected={mode === "stock"} data-active={mode === "stock"} onClick={() => onMode("stock")} data-testid="mode-stock">
        <span className="mode-glyph"><Icon name="zap" size={18} /></span>
        <span className="stack" style={{ gap: 1 }}>
          <span className="mode-title">Instant Stock Agent</span>
          <span className="mode-sub">Chat → on-chain swap → take-profit watcher</span>
        </span>
      </button>
      <button role="tab" aria-selected={mode === "quant"} data-active={mode === "quant"} onClick={() => onMode("quant")} data-testid="mode-quant">
        <span className="mode-glyph"><Icon name="candles" size={18} /></span>
        <span className="stack" style={{ gap: 1 }}>
          <span className="mode-title">Quant Strategy Builder</span>
          <span className="mode-sub">EMA / RSI rules → backtest → publish vault</span>
        </span>
      </button>
    </div>
  );
}

function StudioHeader({ mode, onMode }: { mode: StudioMode; onMode: (m: StudioMode) => void }) {
  return (
    <>
      <StudioModeSwitch mode={mode} onMode={onMode} />
      <div className="stack gap-8" style={{ maxWidth: 680 }}>
        <span className="label-dot">Studio · US stocks</span>
        <h1 className="page-title">Instant Stock Agent</h1>
        <p className="page-sub">
          Type a trade in plain words. Covar prepares the route on Robinhood Chain, you confirm in your own wallet, and a
          watcher follows the price until your take-profit hits. Official Robinhood Stock Tokens only.
        </p>
      </div>
    </>
  );
}

function StudioInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { agents, drafts, practice, practiceSessions, liveStrategy } = useCovar();
  const { toast, node } = useToast();
  const credits = useCredits();
  const isNew = params.get("new") === "1";
  const [mode, setModeState] = useStudioMode(params.get("mode"));
  const setMode = (m: StudioMode) => {
    setModeState(m);
    router.replace(m === "stock" ? "/studio?mode=stock" : "/studio", { scroll: false });
  };
  const prices = usePrices(2000);
  const now = useNow(1000);

  const mine = agents.filter((a) => a.isMine);
  const items: CardItem[] = useMemo(
    () => [
      ...mine.map((a) => ({
        id: a.id,
        name: a.name,
        market: a.market,
        timeframe: a.timeframe,
        kind: "agent" as const,
        runs: `v${a.version}`,
        agent: a,
        strategy: liveStrategy[a.id],
      })),
      ...drafts.map((d) => ({ id: d.id, name: d.name, market: d.market, timeframe: d.timeframe, kind: "draft" as const, runs: "draft", strategy: d })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, drafts, liveStrategy]
  );
  const ids = new Set(items.map((i) => i.id));
  const runningRuns = Object.values(practice).filter((p) => p.status === "running" && ids.has(p.agentId));
  const history = practiceSessions ?? [];

  // Tick running sessions every 2 s against the latest mark (refs keep one steady clock).
  const latest = useRef({ practice, prices, items });
  latest.current = { practice, prices, items };
  useEffect(() => {
    const t = setInterval(() => {
      const { practice: pr, prices: px, items: its } = latest.current;
      Object.values(pr)
        .filter((p) => p.status === "running")
        .forEach((p) => {
          const market = p.market ?? its.find((i) => i.id === p.agentId)?.market;
          actions.tickPractice(p.agentId, market ? priceFor(px, market) : undefined);
        });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const start = (item: CardItem, capital: number) => {
    const mark = priceFor(prices, item.market);
    const fresh = !!prices?.ok && now - Date.parse(prices.at) < STALE_AFTER_MS;
    const book = bookFor(prices, item.market);
    actions.startPractice(
      item.id,
      capital,
      fresh && mark ? { price: mark, source: sourceLabel(prices), ask: book?.ask } : undefined,
      { name: item.name, market: item.market, runs: item.runs, notionalPct: notionalPctOf(item.strategy) }
    );
    toast(
      fresh && mark
        ? `Practice started · ${item.market} at ${fmtPrice(book?.ask ?? mark)} (${VENUE_SHORT[prices!.source]}) with ${usd(capital)} pretend money`
        : `Practice started with ${usd(capital)} pretend money — simulated ticks (no live feed)`
    );
  };
  const stop = (item: CardItem) => {
    const run = practice[item.id];
    actions.stopPractice(item.id);
    toast(`Session saved to practice history (${run ? usdSigned(run.pnlUsd) : "—"}) — practice only, your balances are unchanged`);
  };
  const addSample = () => {
    const { strategy } = buildStrategy("Long ETH when EMA 20 crosses above EMA 50 on the 1h. Stop 2%, take profit 4%.");
    actions.saveDraft({ ...strategy, name: "Sample · ETH trend", notes: `Sample draft for trying practice. Delete it any time. ${strategy.notes}`.trim() });
    toast("Sample draft added — start practice on its card");
  };

  if (isNew) return <Builder />;
  if (mode === "stock") {
    return (
      <div className="wrap-lg page-pad stack gap-24">
        <StudioHeader mode={mode} onMode={setMode} />
        <InstantStockAgent />
      </div>
    );
  }

  const capitalTotal = runningRuns.reduce((s, r) => s + r.capitalUsd, 0);
  const pnlTotal = runningRuns.reduce((s, r) => s + r.pnlUsd, 0);

  return (
    <div className="wrap-md page-pad stack gap-24">
      {node}
      <StudioModeSwitch mode={mode} onMode={setMode} />
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 620 }}>
          <span className="label-dot">Studio</span>
          <h1 className="page-title">Your agents</h1>
          <p className="page-sub">
            Build, version and operate agents. Drafts and published versions are separate objects: editing a draft never
            silently changes what investors are funding.
          </p>
        </div>
        <Link href="/studio?new=1" className="btn btn-primary" onClick={() => router.refresh()}>
          New agent
        </Link>
      </div>

      <div className="grid-4">
        <div className="card card-pad">
          <span className="tiny">Agents</span>
          <div className="stat-value">{mine.length}</div>
          <span className="tiny">{mine.filter((a) => a.status === "live").length} live · {mine.filter((a) => a.status === "practice").length} practice</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Drafts</span>
          <div className="stat-value">{drafts.length}</div>
          <span className="tiny">unpublished rule sets</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Practice sessions running</span>
          <div className="stat-value">{runningRuns.length}</div>
          <span className="tiny">marks: {prices?.ok ? sourceLabel(prices) : "simulated ticks"}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Copilot credits</span>
          <div className="stat-value">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          <Link className="btn btn-soft btn-sm" style={{ marginTop: 6 }} href="/portfolio#credits">
            {credits.signedIn ? "Top up" : "Sign in to use"}
          </Link>
        </div>
      </div>

      <section className="stack gap-14">
        <div className="row between wrap gap-12">
          <div className="stack" style={{ gap: 4 }}>
            <span className="label-dot">Agents &amp; drafts</span>
            <span className="mono-note">Set up practice on any card: choose pretend capital, start, stop. Test money and real money only run published versions.</span>
          </div>
          <FeedBadge prices={prices} now={now} />
        </div>
        {items.length === 0 ? (
          <Empty
            title="No agents yet"
            body="Describe a strategy in the builder to create a draft, then practise it on live prices with pretend money. Or add a sample draft to try practice now."
            action={
              <div className="row gap-8 wrap" style={{ justifyContent: "center" }}>
                <Link href="/studio?new=1" className="btn btn-primary">
                  Create your first agent
                </Link>
                <button className="btn btn-secondary" onClick={addSample} data-testid="add-sample">
                  Try a sample agent
                </button>
              </div>
            }
          />
        ) : (
          <div className="arena-grid">
            {items.map((item) => (
              <AgentCard
                key={item.id}
                item={item}
                run={practice[item.id]}
                prices={prices}
                now={now}
                onStart={(c) => start(item, c)}
                onStop={() => stop(item)}
                onDelete={item.kind === "draft" ? () => actions.removeDraft(item.id) : undefined}
                onPauseToggle={
                  item.agent
                    ? () => {
                        const a = item.agent!;
                        actions.setAgentStatus(a.id, a.status === "live" ? "paused" : "live");
                        toast(a.status === "live" ? "Agent paused — close-only, exits still enabled" : "Agent resumed");
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="rcard" id="practice-ledger" data-testid="practice-ledger">
        <div className="rcard-head" style={{ paddingBottom: 14 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label-dot">Practice ledger</span>
            <span className="mono-note">Isolated pretend-money ledger. Live marks, simulated fills. Never mixed with My money.</span>
          </div>
          <span className="pill pill-accent">practice · simulated</span>
        </div>
        <div className="ledger-sum">
          <div className="stack" style={{ gap: 2 }}>
            <span className="stat-label">Starting balance</span>
            <span className="mono-num ledger-num">{usd(capitalTotal)}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="stat-label">Equity</span>
            <span className="mono-num ledger-num" data-testid="ledger-equity">{usd(capitalTotal + pnlTotal)}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="stat-label">Unrealised P&amp;L</span>
            <span className={cx("mono-num ledger-num", pnlTotal >= 0 ? "pos" : "neg")} data-testid="ledger-pnl">
              {usdSigned(pnlTotal)}
            </span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="stat-label">Return</span>
            <span className={cx("mono-num ledger-num", pnlTotal >= 0 ? "pos" : "neg")}>{capitalTotal ? pctSigned((pnlTotal / capitalTotal) * 100) : "—"}</span>
          </div>
        </div>
        <div className="table-wrap" style={{ border: 0, borderTop: "1px solid var(--border)", borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Position</th>
                <th className="right">Entry fill</th>
                <th className="right">Mark</th>
                <th className="right">Equity</th>
                <th className="right">P&amp;L</th>
                <th className="hide-md">Equity curve</th>
                <th className="hide-sm">Marks</th>
              </tr>
            </thead>
            <tbody>
              {runningRuns.map((r) => {
                const up = r.pnlUsd >= 0;
                const sym = (r.market ?? "").replace("-PERP", "");
                return (
                  <tr key={r.agentId} data-testid="ledger-row">
                    <td>
                      <div className="stack" style={{ gap: 2 }}>
                        <span className="table-strong" style={{ color: "var(--ink)" }}>{r.name ?? r.agentId}</span>
                        <span className="tiny mono">{r.market} · {r.runs ?? "—"} · {fmtDuration(now - Date.parse(r.startedAt))}</span>
                      </div>
                    </td>
                    <td className="mono tiny">
                      {r.sizeUnits ? `Long ${r.sizeUnits.toFixed(4)} ${sym}` : "Simulated wave"}
                      {r.notionalUsd ? <div className="faint">{usd(r.notionalUsd)} notional</div> : null}
                    </td>
                    <td className="right mono-num">{fmtPrice(r.entryPrice)}</td>
                    <td className="right mono-num">{fmtPrice(r.lastPrice)}</td>
                    <td className="right mono-num">{usd(r.capitalUsd + r.pnlUsd)}</td>
                    <td className={cx("right mono-num", up ? "pos" : "neg")}>
                      {usdSigned(r.pnlUsd)}
                      <div className="tiny">{pctSigned((r.pnlUsd / r.capitalUsd) * 100, 3)}</div>
                    </td>
                    <td className="hide-md" style={{ width: 120 }}>
                      <Sparkline data={r.equity ?? []} width={110} height={28} color={up ? "#137A4B" : "#B42318"} />
                    </td>
                    <td className="tiny mono hide-sm">
                      {r.ticks} · {r.priceMode === "live" ? (r.priceSource ?? "live") : "simulated"}
                    </td>
                  </tr>
                );
              })}
              {runningRuns.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 28 }}>
                    <span className="small">No practice running. Start one on a card above; the ledger fills with pretend money and follows live marks.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rcard" id="practice-history" data-testid="practice-history">
        <div className="rcard-head" style={{ paddingBottom: 14 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label-dot">Practice history</span>
            <span className="mono-note">Stopped sessions are saved here, labelled practice. They never appear in My money.</span>
          </div>
          <span className="tiny">{history.length} saved</span>
        </div>
        <div className="table-wrap" style={{ border: 0, borderTop: "1px solid var(--border)", borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th className="right">Pretend capital</th>
                <th className="right">Result</th>
                <th className="right">Return</th>
                <th className="right hide-sm">Duration</th>
                <th className="hide-sm">Marks</th>
                <th className="right">Ended</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((h) => (
                <tr key={h.id} data-testid="history-row">
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="table-strong" style={{ color: "var(--ink)" }}>{h.name ?? h.agentId}</span>
                      <span className="tiny mono">{h.market} · {h.runs ?? "—"} · practice</span>
                    </div>
                  </td>
                  <td className="right mono-num">{usd(h.capitalUsd)}</td>
                  <td className={cx("right mono-num", h.pnlUsd >= 0 ? "pos" : "neg")}>{usdSigned(h.pnlUsd)}</td>
                  <td className={cx("right mono-num", h.pnlUsd >= 0 ? "pos" : "neg")}>{pctSigned((h.pnlUsd / h.capitalUsd) * 100, 3)}</td>
                  <td className="right mono-num hide-sm">{fmtDuration(Date.parse(h.stoppedAt) - Date.parse(h.startedAt))}</td>
                  <td className="tiny mono hide-sm">{h.ticks} · {h.priceMode === "live" ? (h.priceSource ?? "live") : "simulated"}</td>
                  <td className="right tiny">{timeAgo(h.stoppedAt)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 28 }}>
                    <span className="small">No saved sessions yet. Stopping a practice run saves it here.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notice notice-neutral">
        <div>
          <strong>Practice, test exchange and real money are separate ledgers.</strong> Practice uses live marks and pretend
          money; starting or stopping it never touches your wallet, vault positions or the My money ledger. A live agent
          paused here keeps its exit and claim path open — pausing stops new risk, it does not trap investor funds.
        </div>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <WalletGate
      title="Welcome to Covar"
      blurb="Build a strategy in plain English, test it on real history, then run it in practice before a single real dollar moves."
      bullets={[
        "Connect your wallet (Robinhood Chain)",
        "Published rules and versions are public",
        "You only pay for AI when you use it",
      ]}
    >
      <Suspense fallback={<div className="wrap-md page-pad"><div className="skel" style={{ height: 240 }} /></div>}>
        <StudioInner />
      </Suspense>
    </WalletGate>
  );
}
