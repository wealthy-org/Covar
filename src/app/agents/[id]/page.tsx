"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { actions, useCovar } from "@/lib/store";
import { PLATFORM_LIMITS, buildStrategy, opLabel, validateStrategy } from "@/lib/strategy";
import { PROVENANCE_LABEL } from "@/lib/types";
import type { Agent, Decision } from "@/lib/types";
import { cx, dateOnly, dateTime, hashSeed, pct, pctSigned, timeAgo, usd } from "@/lib/format";
import { activeVersionOf, copilotWhy, fmtRemaining, noticeWindow, resolveVersions } from "@/lib/versions";
import { NETWORK_LABEL, VAULT_ADDRESS } from "@/lib/chain";
import { VAULT_AGENT_ID, chainLabel } from "@/lib/vaultAgent";
import VaultActivity, { useVaultFeed } from "@/components/VaultActivity";
import { useMounted } from "@/lib/useMounted";
import { LineChart } from "@/components/Chart";
import { Empty, Field, Modal, TokenLogo, TokenStack, useToast } from "@/components/ui";
import { OnChainVaultCard } from "@/components/ChainPanel";
import { InvestPanel } from "@/components/InvestPanel";

/**
 * Reference layout (sharpe.ac vault page): back link, header with pills, then a
 * main column of stacked cards (return + chart, what the agent is doing, the full
 * record, about, how it trades / risk limits, how it stays up to date / versions,
 * where your money goes) next to a sticky sidebar with the vault and deposit box.
 */

type Verdict = "took" | "skipped" | "reduced";
const verdictOf = (d: Decision): Verdict =>
  d.riskDecision === "rejected" || d.aiDecision === "reject" ? "skipped" : d.aiDecision === "reduce" ? "reduced" : "took";
const VERDICT_PILL: Record<Verdict, string> = { took: "pill pill-green", skipped: "pill pill-red", reduced: "pill pill-amber" };

const COPILOT_LABEL = { off: "off · rules only", advisory: "advisory · reviews each signal, can trim size", veto: "veto only · can block a signal" } as const;

type Tab = "activity" | "rules" | "versions";
const TABS: Tab[] = ["activity", "rules", "versions"];

const RETURN_LABEL: Record<Agent["provenance"], string> = {
  live: "Live return",
  vault: "Vault share price",
  practice: "Practice return · pretend money",
  testnet: "Test-exchange return · test funds",
  backtest: "Backtest return · history replay",
};

function csvOf(agent: Agent) {
  const esc = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const head = ["time", "market", "strategy_version", "inputs", "proposed", "copilot", "copilot_reason", "risk", "risk_reason", "order", "outcome"].join(",");
  const rows = agent.decisions.map((d) =>
    [d.ts, d.market, d.strategyVersion ? `v${d.strategyVersion}` : "", d.inputs, d.proposed, d.aiDecision, d.aiReason, d.riskDecision, d.riskReason, d.order, d.outcome]
      .map(esc)
      .join(",")
  );
  return [head, ...rows].join("\n");
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v" style={tone ? { color: tone } : undefined}>
        {v}
      </span>
    </div>
  );
}

export default function AgentPage() {
  const params = useParams<{ id: string }>();
  const { agents, creators, portfolio, practice, liveStrategy, walletConnected } = useCovar();
  const vaultFeedState = useVaultFeed();
  const { toast, node } = useToast();
  const mounted = useMounted();
  const agent = agents.find((a) => a.id === params.id);
  const [tab, setTab] = useState<Tab>("activity");
  const [filter, setFilter] = useState<"all" | Verdict>("all");
  const [rulesView, setRulesView] = useState<"rules" | "code">("rules");
  const [now, setNow] = useState(() => Date.now());

  // deep link: /agents/ag-01#versions opens that tab
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (TABS.includes(h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      clearInterval(t);
    };
  }, []);

  const pickTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `#${t}`);
  };
  const [depositOpen, setDepositOpen] = useState(false);
  const [amount, setAmount] = useState("250");
  const [error, setError] = useState<string | null>(null);
  const [sharesReq, setSharesReq] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const rules = useMemo(() => {
    if (!agent) return null;
    const stored = liveStrategy[agent.id];
    if (stored) return stored;
    const built = buildStrategy(agent.strategySummary || agent.tagline, agent.id).strategy;
    return { ...built, market: agent.market, timeframe: agent.timeframe as typeof built.timeframe };
  }, [agent, liveStrategy]);

  // "What the agent is doing": factual daily roll-up of the decision log — no prose is invented.
  const days = useMemo(() => {
    if (!agent || !mounted) return [];
    const map = new Map<string, Decision[]>();
    for (const d of agent.decisions) {
      const k = dateOnly(d.ts);
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    return Array.from(map.entries()).slice(0, 3);
  }, [agent, mounted]);

  if (!agent) {
    if (params.id === VAULT_AGENT_ID && vaultFeedState.status !== "off") {
      return (
        <div className="wrap-md page-pad">
          <Empty
            title={vaultFeedState.status === "loading" ? "Reading the vault from chain…" : "On-chain vault unavailable"}
            body={
              vaultFeedState.status === "loading"
                ? "This record is built from the vault's on-chain history."
                : "The vault's history couldn't be loaded right now. Please try again in a minute — no figures are estimated in the meantime."
            }
            action={
              <Link className="btn btn-primary" href="/explore">
                Back to Discover
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="wrap-md page-pad">
        <Empty
          title="Agent not found"
          body="This agent id does not exist in the current session. Discovery lists every available agent."
          action={
            <Link className="btn btn-primary" href="/explore">
              Back to Discover
            </Link>
          }
        />
      </div>
    );
  }

  const creator = creators.find((c) => c.id === agent.creatorId);
  const holding = portfolio.holdings.find((h) => h.agentId === agent.id);
  const run = practice[agent.id];
  const vault = agent.vault;
  const isLive = agent.provenance === "live";
  const isInvestable = isLive && !!vault && agent.status !== "paused";
  const navValue = vault && holding ? holding.shares * vault.navPerShare : 0;
  const pnlOnHolding = holding ? navValue - holding.costBasisUsd : 0;
  const deposit = Number(amount) || 0;
  const feePreview = deposit * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
  const issues = rules ? validateStrategy(rules) : [];
  const requested = holding?.requestedWithdrawal;
  const up = agent.returnPct >= 0;
  const onChain = !!vault && !!VAULT_ADDRESS && vault.address.toLowerCase() === VAULT_ADDRESS.toLowerCase();
  const isVaultAgent = agent.id === VAULT_AGENT_ID;

  const versionsNow = resolveVersions(agent.versions ?? [], now);
  const currentV = activeVersionOf(agent.versions ?? [], agent.version, now);
  const pending = versionsNow.find((v) => v.status === "pending_investor_notice");
  const pendingWin = pending ? noticeWindow(pending, now) : null;
  const verdictCounts = agent.decisions.reduce(
    (m, d) => ({ ...m, [verdictOf(d)]: m[verdictOf(d)] + 1 }),
    { took: 0, reduced: 0, skipped: 0 } as Record<Verdict, number>
  );
  const shownDecisions = filter === "all" ? agent.decisions : agent.decisions.filter((d) => verdictOf(d) === filter);
  const visibility = agent.rulesVisibility ?? "public";
  const rulesVisible = visibility === "public" || !!agent.isMine;
  const publicRules = rules && {
    version: currentV,
    market: agent.market,
    venue: "Lighter perps · Robinhood Chain",
    timeframe: agent.timeframe,
    indicators: rules.indicators,
    entry: { match: rules.entryLogic, conditions: rules.entry.map(({ left, op, right }) => ({ left, op, right })) },
    exit: { match: rules.exitLogic, conditions: rules.exit.map(({ left, op, right }) => ({ left, op, right })) },
    risk: rules.risk,
    copilot: rules.copilot,
  };
  const fingerprint = publicRules ? hashSeed(JSON.stringify({ ...publicRules, version: undefined })).toString(16).padStart(8, "0") : "—";

  const base = agent.market.split("-")[0];
  const copilotOff = rules?.copilot.mode === "off";
  const showTwin = !copilotOff && (agent.twin?.length ?? 0) >= 3;
  const showBench = (agent.benchmark?.length ?? 0) >= 3;
  const edgePts = showTwin && agent.curve.length >= 3 ? agent.curve[agent.curve.length - 1] - (agent.twin ?? [])[(agent.twin ?? []).length - 1] : null;
  const benchPts = showBench && agent.curve.length >= 3 ? agent.curve[agent.curve.length - 1] - agent.benchmark[agent.benchmark.length - 1] : null;

  const doDeposit = () => {
    const res = actions.deposit(agent.id, deposit);
    if (!res.ok) {
      setError(res.error ?? "Deposit failed");
      return;
    }
    setDepositOpen(false);
    setError(null);
    toast(`Deposited ${usd(deposit)} · fee ${usd(res.fee ?? 0)} · shares minted at NAV ${vault?.navPerShare.toFixed(4)}`);
  };

  const connect = () =>
    void actions.connectWallet().then((r) => {
      if (!r.ok && r.error) setConnectError(r.error);
    });

  /* ------------------------------------ sidebar ------------------------------------ */
  const sidebar = (
    <aside className="detail-side">
      <div className="rcard rcard-pad stack gap-14">
        {vault ? (
          <>
            <div className="stack" style={{ gap: 4 }}>
              <span className="stat-label">Vault size</span>
              <span className="mono-num" style={{ fontSize: 28, color: "var(--ink)" }}>
                {usd(vault.tvlUsd)}
              </span>
            </div>
            <div>
              <KV k="NAV per share" v={`${vault.navPerShare.toFixed(4)} USDG`} />
              <KV k="Shares outstanding" v={vault.sharesOutstanding.toLocaleString("en-US")} />
              <KV k="Pending deposits" v={usd(vault.pendingDeposits)} />
              <KV k="Pending withdrawals" v={usd(vault.pendingWithdrawals)} />
              <KV k="Withdrawal unwind" v={`up to ${vault.unwindDays} days`} />
            </div>
          </>
        ) : (
          <div className="stack gap-6">
            <span className="stat-label">No vault</span>
            <span className="small">
              This agent&apos;s record is <strong>{PROVENANCE_LABEL[agent.provenance].toLowerCase()}</strong>. Nothing here takes
              deposits — only agents with a real-money record and an open vault do.
            </span>
          </div>
        )}

        {isInvestable && !onChain && !walletConnected && (
          <>
            <div className="rcard-sep" />
            <span className="small">Browse freely. Connect when you want to deposit.</span>
            <button className="btn-ink" style={{ height: 40 }} onClick={connect}>
              Connect to deposit →
            </button>
            {connectError && (
              <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                {connectError}
              </span>
            )}
          </>
        )}

        {isInvestable && !onChain && walletConnected && (
          <>
            <div className="rcard-sep" />
            {holding ? (
              <div className="stack gap-10">
                <span className="stat-label">Your position</span>
                <div>
                  <KV k="Shares" v={holding.shares.toFixed(2)} />
                  <KV k="Value" v={usd(navValue)} />
                  <KV k="Cost basis" v={usd(holding.costBasisUsd)} />
                  <KV
                    k="P&L"
                    v={`${pnlOnHolding >= 0 ? "+" : "−"}${usd(Math.abs(pnlOnHolding))}`}
                    tone={pnlOnHolding >= 0 ? "var(--positive)" : "var(--negative)"}
                  />
                </div>
                {requested ? (
                  <div className="soft stack gap-8" style={{ padding: 12, borderRadius: 6 }}>
                    <div className="row between gap-8">
                      <span className="small strong">Withdrawal · {requested.shares.toFixed(2)} shares</span>
                      <span className="pill pill-accent">{requested.state.replace(/_/g, " ")}</span>
                    </div>
                    <span className="tiny">
                      Requested {mounted ? timeAgo(requested.requestedAt) : "…"} · estimated {usd(requested.estUsd)} after fee · settlement closes the
                      vault position first.
                    </span>
                    {requested.state !== "claimable" && (
                      <button
                        className="btn-out"
                        onClick={() => {
                          actions.advanceWithdrawal(agent.id);
                          toast("Operator step applied: positions closed, settlement pending");
                        }}
                      >
                        Simulate operator step
                      </button>
                    )}
                    <button
                      className="btn-ink"
                      disabled={requested.state !== "claimable"}
                      onClick={() => {
                        actions.claimWithdrawal(agent.id);
                        toast("Claimed to wallet · recorded in the ledger");
                      }}
                    >
                      {requested.state === "claimable" ? `Claim ${usd(requested.estUsd)}` : "Claim locked until settled"}
                    </button>
                  </div>
                ) : (
                  <div className="grid-2" style={{ gap: 8 }}>
                    <button className="btn-ink" style={{ height: 38 }} onClick={() => setDepositOpen(true)}>
                      Add funds
                    </button>
                    <button
                      className="btn-out"
                      style={{ height: 38, justifyContent: "center" }}
                      onClick={() => {
                        setSharesReq(String(holding.shares.toFixed(2)));
                        setWithdrawOpen(true);
                      }}
                    >
                      Withdraw
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="stack gap-10">
                <span className="small">
                  Deposits mint shares at the current NAV after the {PLATFORM_LIMITS.depositFeePct}% +{" "}
                  {PLATFORM_LIMITS.depositFeeFlat.toFixed(2)} USDG fee. Trading authority cannot redirect your withdrawal.
                </span>
                <button className="btn-ink" style={{ height: 40 }} onClick={() => setDepositOpen(true)}>
                  Deposit USDG →
                </button>
              </div>
            )}
          </>
        )}

        {isLive && vault && agent.status === "paused" && (
          <div className="notice notice-warn">
            <div>Vault paused · close-only. New deposits are refused until the agent resumes.</div>
          </div>
        )}
      </div>

      {onChain && <InvestPanel agentId={agent.id} />}

      {run && (
        <div className="rcard rcard-pad stack gap-8">
          <div className="row between">
            <span className="label-dot">Practice session</span>
            <span className={run.status === "running" ? "pill pill-green" : "pill"}>{run.status}</span>
          </div>
          <span className={cx("mono-num", run.pnlUsd >= 0 ? "pos" : "neg")} style={{ fontSize: 20 }}>
            {usd(run.pnlUsd)}
          </span>
          <span className="tiny">
            {usd(run.capitalUsd)} pretend capital · {run.ticks} ticks · marks:{" "}
            {run.priceMode === "live" ? `market feed (${run.priceSource ?? "feed"})` : "simulated"} · started {mounted ? timeAgo(run.startedAt) : "…"}
          </span>
          <Link href="/studio" className="btn-out" style={{ justifyContent: "center" }}>
            Manage in studio
          </Link>
        </div>
      )}

      <div className="rcard rcard-pad stack gap-8">
        <span className="label-dot">Record type</span>
        <span className="small strong" style={{ color: "var(--ink)" }}>
          {PROVENANCE_LABEL[agent.provenance]}
        </span>
        <span className="tiny">
          {agent.provenance === "live"
            ? "Real-money record with reconciled fills. Vault NAV is a separate share-price record."
            : agent.provenance === "backtest"
              ? "Historical simulation on a pinned dataset. Never presented as live performance."
              : agent.provenance === "practice"
                ? "Practice ledger in isolation: marks come from a market feed when reachable, else simulated ticks — the run says which. Fills are always simulated; no investor capital."
                : "Test-exchange orders with faucet funds. Not comparable to real-money results."}
        </span>
      </div>
    </aside>
  );

  return (
    <div className="wrap-lg page-pad">
      {node}

      <Link href="/explore" className="back-link">
        ← {isLive ? "Discover" : "Agent arena"}
      </Link>

      {/* ------------------------------------ header ------------------------------------ */}
      <div className="detail-head">
        <div className="row gap-14" style={{ alignItems: "flex-start", flexWrap: "nowrap", minWidth: 0 }}>
          <TokenLogo market={agent.market} size={46} />
          <div className="stack gap-8" style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: "clamp(26px, 2.6vw, 34px)" }}>
              {agent.name}
            </h1>
            <span className="mono-note" style={{ fontSize: 12 }}>
              by{" "}
              {creator ? (
                <Link href={`/creators/${creator.id}`} className="link-primary">
                  @{creator.handle}
                </Link>
              ) : (
                "you"
              )}{" "}
              · {agent.liveAgeDays ? `${agent.liveAgeDays} day${agent.liveAgeDays === 1 ? "" : "s"} live` : "not live"} · v{currentV}
            </span>
            <div className="row gap-6 wrap">
              {agent.status === "live" && vault && <span className="pill pill-green">● Vault open</span>}
              {agent.status === "paused" && <span className="pill pill-amber">Paused · close-only</span>}
              {agent.status !== "live" && agent.status !== "paused" && <span className="pill">{agent.status.replace("_", " ")}</span>}
              <span className={isLive ? "pill pill-ink" : agent.provenance === "practice" ? "pill pill-accent" : "pill"}>
                {isLive ? "Real money record" : PROVENANCE_LABEL[agent.provenance]}
              </span>
              <span className="tagbox">{agent.market}</span>
              <span className="tagbox">{agent.timeframe}</span>
              {pending && pendingWin && (
                <a href="#versions" className="pill pill-amber" onClick={() => pickTab("versions")} data-testid="pending-pill">
                  v{pending.version} pending · {mounted ? fmtRemaining(pendingWin.remainingMs) : "48h notice"}
                </a>
              )}
            </div>
          </div>
        </div>
        {agent.isMine && (
          <Link href="/studio" className="btn-out">
            Operate in studio
          </Link>
        )}
      </div>

      {agent.disclosure && (
        <div className="notice notice-warn" style={{ marginBottom: 20 }}>
          {agent.disclosure}
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          {/* 1 · return + chart */}
          <section className="rcard">
            <div className="rcard-pad stack gap-16">
              <div className="row between wrap gap-12" style={{ alignItems: "flex-end" }}>
                <div className="stack" style={{ gap: 4 }}>
                  <span className="label-dot">{RETURN_LABEL[agent.provenance]}</span>
                  <span className="mono-num" style={{ fontSize: 40, lineHeight: 1.05, color: up ? "var(--positive)" : "var(--negative)" }}>
                    {pctSigned(agent.returnPct)}
                  </span>
                  <span className="mono-note">net of fees and costs · indexed to 100 at the start of the record</span>
                </div>
                <div className="stack gap-8" style={{ alignItems: "flex-end" }}>
                  <div className="row gap-14 wrap tiny" data-testid="chart-legend">
                    <span className="row gap-6">
                      <i className="legend-swatch legend-main" /> Agent
                    </span>
                    {showBench && (
                      <span className="row gap-6">
                        <i className="legend-swatch legend-thin" /> {base} buy &amp; hold
                      </span>
                    )}
                    {showTwin && (
                      <span className="row gap-6">
                        <i className="legend-swatch legend-dash" style={{ borderColor: "#5F6B7F" }} /> Rules-only twin
                      </span>
                    )}
                  </div>
                  {(edgePts !== null || benchPts !== null || copilotOff) && (
                    <div className="row gap-14 wrap tiny mono" style={{ justifyContent: "flex-end" }}>
                      {edgePts !== null && (
                        <span title="Agent minus the same rules run without Copilot, in percentage points of return" data-testid="copilot-edge">
                          Copilot vs twin{" "}
                          <strong style={{ color: edgePts >= 0 ? "var(--positive)" : "var(--negative)" }}>
                            {edgePts >= 0 ? "+" : "−"}
                            {Math.abs(edgePts).toFixed(1)} pts
                          </strong>
                        </span>
                      )}
                      {benchPts !== null && (
                        <span title={`Agent minus holding ${base} over the same period`}>
                          vs {base}{" "}
                          <strong style={{ color: benchPts >= 0 ? "var(--positive)" : "var(--negative)" }}>
                            {benchPts >= 0 ? "+" : "−"}
                            {Math.abs(benchPts).toFixed(1)} pts
                          </strong>
                        </span>
                      )}
                      {copilotOff && <span>Copilot off · no twin to compare</span>}
                    </div>
                  )}
                </div>
              </div>
              {(agent.curve?.length ?? 0) < 3 ? (
                <div className="stack center gap-8" style={{ padding: "56px 16px", textAlign: "center" }}>
                  <span className="pill">No record yet</span>
                  {isVaultAgent ? (
                    <span className="small" style={{ maxWidth: 420 }}>
                      The share-price chart starts once the operator has reported NAV on-chain a few times. No placeholder curve is drawn.
                    </span>
                  ) : (
                    <>
                      <span className="small">This agent has no performance record yet.</span>
                      <span className="tiny" style={{ maxWidth: 420 }}>
                        Start a practice session in Studio to begin recording. The chart stays empty until there is data — no
                        placeholder curve is drawn.
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <LineChart
                  height={260}
                  baseline={100}
                  series={[
                    { key: "eq", label: "Agent", color: "#3B5BDB", data: agent.curve, area: true, width: 2.4 },
                    ...(showBench ? [{ key: "bm", label: `${base} buy & hold`, color: "#A3ABBD", data: agent.benchmark, width: 1.1 }] : []),
                    ...(showTwin ? [{ key: "tw", label: "Rules-only twin", color: "#5F6B7F", data: agent.twin ?? [], dash: "6 4", width: 1.5 }] : []),
                  ]}
                  yFormat={(n) => n.toFixed(1)}
                  showLegend={false}
                />
              )}
            </div>
            <div className="stat-strip">
              <div>
                <span className="stat-label">Worst drop</span>
                <span className="mono-num neg">{pct(agent.drawdownPct)}</span>
              </div>
              {isVaultAgent ? (
                <div>
                  <span className="stat-label">NAV reports</span>
                  <span className="mono-num">{vaultFeedState.summary?.counts.navReports ?? "—"}</span>
                </div>
              ) : (
                <div>
                  <span className="stat-label">Trades</span>
                  <span className="mono-num">{agent.tradeCount}</span>
                </div>
              )}
              <div>
                <span className="stat-label">Days on record</span>
                <span className="mono-num">{agent.liveAgeDays || agent.curve.length || "—"}</span>
              </div>
              {isVaultAgent ? (
                <div>
                  <span className="stat-label">Investors</span>
                  <span className="mono-num">{vaultFeedState.summary ? `${vaultFeedState.summary.investors.holding} holding` : "—"}</span>
                </div>
              ) : (
                <div>
                  <span className="stat-label">Covar score</span>
                  <span className="mono-num">{agent.score ? agent.score.toFixed(2) : "not ranked"}</span>
                </div>
              )}
            </div>
          </section>

          {isVaultAgent && <VaultActivity />}

          {!isVaultAgent && (
          <>
          {/* 2 · what it is doing | recent decisions */}
          <div className="detail-two">
            <section className="rcard rcard-pad stack gap-14">
              <h2 className="rcard-title">What the agent is doing</h2>
              {days.length === 0 ? (
                <span className="small">{mounted ? "No decisions logged yet." : "…"}</span>
              ) : (
                <div className="stack gap-12">
                  {days.map(([day, list]) => {
                    const took = list.filter((d) => verdictOf(d) === "took").length;
                    const reduced = list.filter((d) => verdictOf(d) === "reduced").length;
                    const skipped = list.length - took - reduced;
                    return (
                      <div key={day} className="stack" style={{ gap: 4 }}>
                        <span className="stat-label">{day}</span>
                        <span className="small" style={{ color: "var(--foreground)" }}>
                          {list.length} idea{list.length === 1 ? "" : "s"} on {Array.from(new Set(list.map((d) => d.market))).join(", ")} ·{" "}
                          {took} taken{reduced ? ` · ${reduced} reduced` : ""}
                          {skipped ? ` · ${skipped} skipped` : ""}.
                        </span>
                        <span className="tiny">Latest: {list[0].proposed.toLowerCase()} — {list[0].inputs}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <span className="mono-note">Summarised from the decision log below. Nothing here is written by hand.</span>
            </section>

            <section className="rcard rcard-pad stack gap-12">
              <h2 className="rcard-title">Recent decisions</h2>
              <div className="stack">
                {agent.decisions.slice(0, 5).map((d) => {
                  const v = verdictOf(d);
                  return (
                    <div key={d.id} className="decision-row">
                      <span className={VERDICT_PILL[v]}>{v}</span>
                      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                        <span className="small strong truncate" style={{ color: "var(--ink)" }}>
                          {d.proposed}
                        </span>
                        <span className="tiny truncate">{d.riskReason ?? d.outcome ?? d.inputs}</span>
                      </div>
                      <span className="tiny mono" style={{ whiteSpace: "nowrap" }}>
                        {mounted ? timeAgo(d.ts) : "…"}
                      </span>
                    </div>
                  );
                })}
                {agent.decisions.length === 0 && <span className="small">Nothing yet.</span>}
              </div>
            </section>
          </div>

          {/* 3 · record panel: activity / published rules / versions */}
          <section className="rcard" id="record" data-testid="record-panel">
            <div className="rcard-head" style={{ paddingBottom: 0 }}>
              <h2 className="rcard-title">The full record</h2>
              {tab === "activity" && (
                <button
                  className="btn-out"
                  onClick={() => download(`${agent.id}-decisions.csv`, csvOf(agent))}
                  disabled={agent.decisions.length === 0}
                >
                  ↓ CSV
                </button>
              )}
            </div>
            <div className="utabs dtabs" role="tablist" style={{ padding: "0 14px", marginTop: 6 }}>
              {(
                [
                  ["activity", "Activity · Decision log", agent.decisions.length],
                  ["rules", "Published rules", rulesVisible ? "public" : "summary"],
                  ["versions", "Versions", versionsNow.length],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className="utab"
                  data-testid={`tab-${id}`}
                  data-active={tab === id}
                  onClick={() => pickTab(id)}
                >
                  {label}
                  <span className="utab-count">{count}</span>
                  {id === "versions" && pending && <span className="tab-dot" aria-label="pending change" />}
                </button>
              ))}
            </div>

            {tab === "activity" && (
              <div key="activity" className="fx-in" data-testid="panel-activity">
                <div className="row between wrap gap-10" style={{ padding: "12px 22px 0" }}>
                  <div className="seg" role="group" aria-label="Filter decisions">
                    {(["all", "took", "reduced", "skipped"] as const).map((f) => (
                      <button key={f} data-active={filter === f} onClick={() => setFilter(f)}>
                        {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)} · {f === "all" ? agent.decisions.length : verdictCounts[f]}
                      </button>
                    ))}
                  </div>
                  <span className="tiny">Each row is one decision: what the rules proposed, why Copilot agreed or not, and the risk check.</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="table decision-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Proposed · inputs</th>
                        <th>Copilot · why</th>
                        <th>Risk check</th>
                        <th>Order / outcome</th>
                        <th>Ver.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDecisions.map((d) => (
                        <tr key={d.id}>
                          <td className="tiny mono nowrap">
                            {mounted ? dateTime(d.ts) : "…"}
                            <div className="tiny">{d.market}</div>
                          </td>
                          <td className="small" style={{ minWidth: 170 }}>
                            <div className="row gap-6" style={{ flexWrap: "nowrap" }}>
                              <span className={VERDICT_PILL[verdictOf(d)]}>{verdictOf(d)}</span>
                              <span className="strong" style={{ color: "var(--ink)" }}>
                                {d.proposed}
                              </span>
                            </div>
                            <div className="tiny" style={{ marginTop: 4 }}>{d.inputs}</div>
                          </td>
                          <td style={{ minWidth: 220 }}>
                            <span className={d.aiDecision === "reject" ? "pill pill-red" : d.aiDecision === "reduce" ? "pill pill-amber" : d.aiDecision === "rules_only" ? "pill" : "pill pill-accent"}>
                              {d.aiDecision.replace("_", " ")}
                            </span>
                            <div className={cx("tiny", !d.aiReason && "muted-2")} style={{ maxWidth: 260, marginTop: 4 }}>
                              {copilotWhy(d)}
                            </div>
                          </td>
                          <td style={{ minWidth: 150 }}>
                            <span className={d.riskDecision === "approved" ? "pill pill-green" : "pill pill-red"}>{d.riskDecision}</span>
                            <div className="tiny" style={{ maxWidth: 220, marginTop: 4 }}>
                              {d.riskReason ?? (d.riskDecision === "approved" ? "Within every published limit." : "")}
                            </div>
                          </td>
                          <td className="small" style={{ minWidth: 140 }}>
                            {d.order ?? "—"}
                            {d.outcome && <div className="tiny">{d.outcome}</div>}
                          </td>
                          <td className="tiny mono">{d.strategyVersion ? `v${d.strategyVersion}` : "—"}</td>
                        </tr>
                      ))}
                      {shownDecisions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="small" style={{ textAlign: "center", padding: 24 }}>
                            No {filter === "all" ? "" : `${filter} `}decisions on record.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "rules" && rules && (
              <div key="rules" className="rcard-pad stack gap-16 fx-in" data-testid="panel-rules">
                <div className="row between wrap gap-10">
                  <div className="row gap-8 wrap">
                    <span className={visibility === "public" ? "pill pill-green" : "pill pill-amber"}>
                      {visibility === "public" ? "Public rules" : "Summary only"}
                    </span>
                    <span className="tagbox tagbox-accent">typed · validated</span>
                    <span className="tiny mono">published with v{currentV}</span>
                    <span className="tiny mono" title="Changes whenever any rule, limit or Copilot setting changes. A change check, not a cryptographic commitment.">
                      fingerprint {fingerprint}
                    </span>
                  </div>
                  {rulesVisible && (
                    <div className="seg" role="group" aria-label="Rules view">
                      <button data-active={rulesView === "rules"} onClick={() => setRulesView("rules")}>
                        Rules
                      </button>
                      <button data-active={rulesView === "code"} onClick={() => setRulesView("code")}>
                        Code
                      </button>
                    </div>
                  )}
                </div>

                {agent.isMine && (
                  <div className="notice notice-neutral" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <span>
                      <strong>You are the creator.</strong> You always see the full rules. Investors see{" "}
                      {visibility === "public" ? "everything below" : "limits, Copilot settings and the fingerprint — not the thresholds"}.
                    </span>
                    <div className="seg">
                      <button
                        data-active={visibility === "public"}
                        onClick={() => actions.updateAgent(agent.id, { rulesVisibility: "public" })}
                      >
                        Public
                      </button>
                      <button
                        data-active={visibility === "summary"}
                        onClick={() => actions.updateAgent(agent.id, { rulesVisibility: "summary" })}
                      >
                        Summary only
                      </button>
                    </div>
                  </div>
                )}

                {!rulesVisible && (
                  <div className="notice notice-warn">
                    <div>
                      <strong>The creator keeps exact entry and exit thresholds private.</strong> Published here: market, timeframe,
                      indicators used, Copilot configuration and every risk limit. The fingerprint changes whenever the private rules
                      change, and every change still goes through versions and the 48h investor notice.
                    </div>
                  </div>
                )}

                {rulesVisible && rulesView === "code" ? (
                  <pre className="code" data-testid="rules-code">{JSON.stringify(publicRules, null, 2)}</pre>
                ) : (
                  <>
                    {rulesVisible && (
                      <div className="grid-2" style={{ gap: 16 }}>
                        <div className="stack gap-6">
                          <span className="stat-label">Enter when · match {rules.entryLogic}</span>
                          {rules.entry.map((c) => (
                            <code key={c.id} className="rule-line">
                              {c.left} {opLabel[c.op]} {c.right}
                            </code>
                          ))}
                        </div>
                        <div className="stack gap-6">
                          <span className="stat-label">Exit when · match {rules.exitLogic}</span>
                          {rules.exit.map((c) => (
                            <code key={c.id} className="rule-line">
                              {c.left} {opLabel[c.op]} {c.right}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="stack gap-6">
                      <span className="stat-label">Indicators</span>
                      <div className="row gap-6 wrap">
                        {rules.indicators.length === 0 && <span className="tiny">None — price and funding inputs only.</span>}
                        {(rulesVisible
                          ? rules.indicators.map((i) => ({ key: i.id, label: `${i.kind.toUpperCase()}(${i.period})` }))
                          : Array.from(new Set(rules.indicators.map((i) => i.kind))).map((k) => ({ key: k, label: k.toUpperCase() }))
                        ).map((i) => (
                          <span key={i.key} className="tagbox">
                            {i.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="detail-two" style={{ gap: 16 }}>
                      <div>
                        <span className="stat-label">Market &amp; Copilot</span>
                        <KV k="Market" v={`${agent.market} · Lighter perps · Robinhood Chain`} />
                        <KV k="Timeframe" v={agent.timeframe} />
                        <KV k="Copilot" v={COPILOT_LABEL[rules.copilot.mode]} />
                        <KV k="Extra trades by Copilot" v={rules.copilot.allowExtraTrades ? "allowed" : "not allowed"} />
                        <KV k="If Copilot is unavailable" v={rules.copilot.fallbackToRules ? "fall back to rules" : "skip the trade"} />
                        <KV k="Rules-only twin" v={rules.copilot.rulesOnlyTwin ? "recorded" : "off"} />
                      </div>
                      <div>
                        <span className="stat-label">Risk limits</span>
                        <KV k="Leverage" v={`${rules.risk.leverage}x`} />
                        <KV k="Max position" v={`${rules.risk.maxPositionPct}%`} />
                        <KV k="Per-trade stop" v={`${rules.risk.stopLossPct}%`} />
                        <KV k="Take profit" v={`${rules.risk.takeProfitPct}%`} />
                        <KV k="Daily loss pause" v={`${rules.risk.dailyLossPausePct}%`} />
                        <KV k="Drawdown stop" v={`${rules.risk.maxDrawdownPct}%`} />
                      </div>
                    </div>
                  </>
                )}
                <span className="mono-note">
                  Position and leverage caps are enforced by the risk service and signer permissions; loss pauses are server-side
                  triggers, not on-chain guarantees. A trigger limits new risk — it cannot promise a maximum loss during gaps.
                </span>
                {issues.map((i, idx) => (
                  <span key={idx} className="tiny" style={{ color: i.level === "error" ? "var(--negative)" : "var(--warning)" }}>
                    {i.level === "error" ? "Error" : "Warning"} · {i.message}
                  </span>
                ))}
              </div>
            )}

            {tab === "versions" && (
              <div key="versions" className="rcard-pad stack gap-16 fx-in" data-testid="panel-versions">
                <div className="policy-strip">
                  {[
                    ["01", "Changes are versioned", "A rules change becomes a new version. Old results are kept, never recalculated."],
                    ["02", "Investors get 48h notice", "With investors in the vault, a new version waits 48h before it trades. Investors can withdraw meanwhile."],
                    ["03", "Open positions are stated", "Every change says what happens to positions opened under the previous version."],
                  ].map(([n, t, b]) => (
                    <div key={n} className="step-row">
                      <span className="mono-num" style={{ color: "var(--primary)", fontSize: 12 }}>
                        {n}
                      </span>
                      <div className="stack" style={{ gap: 3 }}>
                        <span className="small strong" style={{ color: "var(--ink)" }}>
                          {t}
                        </span>
                        <span className="tiny">{b}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {pending && pendingWin && (
                  <div className="version-pending" data-testid="pending-version">
                    <div className="row between wrap gap-8">
                      <div className="row gap-8 wrap">
                        <span className="small strong" style={{ color: "var(--ink)" }}>
                          v{pending.version}
                        </span>
                        <span className="pill pill-amber">pending investor notice</span>
                        <span className="small">{pending.summary}</span>
                      </div>
                      <span className="mono-num" style={{ fontSize: 13, color: "#8a5a00" }} data-testid="notice-countdown">
                        {mounted ? fmtRemaining(pendingWin.remainingMs) : "…"}
                      </span>
                    </div>
                    <div className="notice-bar" aria-label={`${Math.round(pendingWin.pct)}% of the 48h notice elapsed`}>
                      <span style={{ width: `${pendingWin.pct}%` }} />
                    </div>
                    <div className="row between wrap gap-8 tiny mono">
                      <span>Investors notified {mounted ? dateTime(new Date(pendingWin.start).toISOString()) : "…"}</span>
                      <span>Takes effect {mounted ? dateTime(new Date(pendingWin.end).toISOString()) : "…"}</span>
                    </div>
                    {pending.changes && pending.changes.length > 0 && (
                      <div className="stack gap-4">
                        <span className="stat-label">What changes vs v{currentV}</span>
                        {pending.changes.map((c) => (
                          <code key={c} className="rule-line">
                            {c}
                          </code>
                        ))}
                      </div>
                    )}
                    {pending.positionHandling && (
                      <div className="stack gap-4">
                        <span className="stat-label">Open positions</span>
                        <span className="small">{pending.positionHandling}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="timeline">
                  {[...versionsNow]
                    .filter((v) => v.status !== "pending_investor_notice")
                    .reverse()
                    .map((v) => (
                      <div key={v.version} className="timeline-item">
                        <span className="timeline-dot" />
                        <div className="stack" style={{ gap: 3 }}>
                          <div className="row gap-8 wrap">
                            <span className="small strong" style={{ color: "var(--ink)" }}>
                              v{v.version}
                            </span>
                            <span className={v.status === "active" ? "pill pill-green" : "pill"}>{v.status.replace(/_/g, " ")}</span>
                            <span className="tiny mono">
                              {mounted ? `active from ${dateOnly(v.effectiveAt ?? v.ts)}` : "…"}
                              {mounted && v.noticeAt ? ` · notified ${dateOnly(v.noticeAt)}` : ""}
                            </span>
                          </div>
                          <span className="small">{v.summary}</span>
                          <span className="tiny">{v.notice}</span>
                          {v.positionHandling && <span className="tiny">Open positions: {v.positionHandling}</span>}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {tab === "activity" && (
            <div className="record-foot">
              <span>
                Every decision row records market inputs, the proposed action, Copilot&apos;s verdict and reason, the independent risk
                decision, the order and its outcome. AI-credit exhaustion never disables stops, exits or the emergency close path.
              </span>
              <span>{onChain ? "Vault reads are live below." : "Check on-chain: no deployed vault for this record yet."}</span>
            </div>
            )}
          </section>

          </>
          )}

          {/* 4 · about */}
          <section className="rcard rcard-pad stack gap-10">
            <h2 className="rcard-title">About</h2>
            <p className="body" style={{ margin: 0 }}>
              {agent.tagline}
            </p>
            <p className="small" style={{ margin: 0 }}>
              {agent.strategySummary}
            </p>
          </section>

          {/* 7 · where your money goes */}
          <section className="rcard rcard-pad stack gap-16">
            <h2 className="rcard-title">Where your money goes</h2>
            <div className="money-flow" aria-label="Money flow diagram">
              <div className="mf-node">You</div>
              <div className="mf-arrow">
                <span>deposit →</span>
                <span>← withdraw</span>
              </div>
              <div className="mf-node mf-node-ink">Vault contract</div>
              <div className="mf-arrow">
                <span>margin →</span>
              </div>
              <div className="mf-node">Venue account</div>
            </div>
            <div className="row gap-8 wrap" style={{ justifyContent: "center" }}>
              <span className="mf-chip">Creator ✕ can&apos;t withdraw</span>
              <span className="mf-chip">Agent key · trade only</span>
              <span className="mf-chip">Withdrawals go to your wallet only</span>
            </div>
            <div>
              <KV k="Vault contract" v={vault ? (onChain ? vault.address : "example vault · not on-chain") : "no vault"} />
              <KV k="Network" v={isVaultAgent && vaultFeedState.summary ? `${chainLabel(vaultFeedState.summary.chainId)} · ${vaultFeedState.summary.chainId}` : NETWORK_LABEL} />
              <KV k="Deposit fee" v={`${vault?.depositFeePct ?? PLATFORM_LIMITS.depositFeePct}% + ${(vault?.depositFeeFlat ?? PLATFORM_LIMITS.depositFeeFlat).toFixed(2)} USDG`} />
              {isVaultAgent ? (
                <KV k="Withdrawal fee" v="1% + 0.10 USDG, taken at settlement · no performance fee" />
              ) : (
                <>
                  <KV k="Creator fee" v={`${rules?.feeChoicePct ?? 10}% of winning-trade profit · 80/20 creator/platform`} />
                  <KV k="Losing trades netted?" v="No" />
                </>
              )}
              <KV k="Withdrawal flow" v="request → close positions → settle → claim" />
              <KV k="Min deposit" v="10 USDG" />
            </div>
            <OnChainVaultCard />
          </section>

          {/* 8 · creator */}
          {creator && (
            <Link href={`/creators/${creator.id}`} className="rcard rcard-pad creator-link">
              <TokenStack markets={agents.filter((a) => a.creatorId === creator.id).map((a) => a.market)} size={34} />
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="small strong" style={{ color: "var(--ink)" }}>
                  See every agent @{creator.handle} has run
                </span>
                <span className="tiny truncate">{creator.bio}</span>
              </div>
              <span className="accent-link">→</span>
            </Link>
          )}
        </div>

        {sidebar}
      </div>

      {/* ---------------------------------- depositing ---------------------------------- */}
      <Modal
        open={depositOpen}
        onClose={() => {
          setDepositOpen(false);
          setError(null);
        }}
        title={`Deposit into ${agent.name}`}
        subtitle={`Practice deposit · ${NETWORK_LABEL}`}
        footer={
          <>
            <span className="tiny">
              Fee {usd(feePreview)} · {usd(Math.max(0, deposit - feePreview))} net
            </span>
            <button className="btn btn-primary btn-sm" onClick={doDeposit} disabled={deposit < 10 || deposit > portfolio.cashUsd}>
              Confirm deposit
            </button>
          </>
        }
      >
        <div className="stack gap-16">
          <Field label="Amount (USDG)" error={error ?? undefined} hint={`Available: ${usd(portfolio.cashUsd)}`}>
            <input
              className={cx("input", error && "input-error")}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              inputMode="decimal"
            />
          </Field>
          <div className="row gap-6 wrap">
            {[100, 250, 500].map((v) => (
              <button key={v} className="chip" onClick={() => setAmount(String(v))}>
                {usd(v, { max: 0 })}
              </button>
            ))}
            <button className="chip" onClick={() => setAmount(String(Math.floor(portfolio.cashUsd)))}>
              Max
            </button>
          </div>
          <div className="panel" style={{ padding: "4px 14px" }}>
            <KV k="Asset" v="USDG · 6 decimals" />
            <KV k="Network" v={NETWORK_LABEL} />
            <KV k="Deposit fee" v={`${PLATFORM_LIMITS.depositFeePct}% + ${PLATFORM_LIMITS.depositFeeFlat.toFixed(2)} USDG`} />
            <KV k="Net into vault" v={usd(Math.max(0, deposit - feePreview))} />
            <KV k="Shares at NAV" v={(Math.max(0, deposit - feePreview) / (vault?.navPerShare ?? 1)).toFixed(4)} />
            <KV k="NAV used" v={vault?.navPerShare.toFixed(4) ?? "—"} />
          </div>
          <div className="notice notice-warn">
            <div>
              Practice vault: no real funds move. Shares are minted against the NAV shown; if the NAV is stale beyond the allowed window the contract
              rejects the deposit rather than minting at a manipulable price.
            </div>
          </div>
        </div>
      </Modal>

      {/* --------------------------------- withdrawing --------------------------------- */}
      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Request withdrawal"
        subtitle="A request is not a completed withdrawal"
        footer={
          <>
            <span className="tiny">Positions are closed before settlement</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const res = actions.requestWithdrawal(agent.id, Number(sharesReq) || 0);
                if (!res.ok) {
                  toast(res.error ?? "Request failed");
                  return;
                }
                setWithdrawOpen(false);
                toast(`Withdrawal requested · estimated ${usd(res.est ?? 0)} · unwind up to ${vault?.unwindDays ?? 2} days`);
              }}
            >
              Submit request
            </button>
          </>
        }
      >
        <div className="stack gap-16">
          <Field label="Shares to redeem" hint={`You hold ${holding?.shares.toFixed(2)} shares`}>
            <input className="input" value={sharesReq} onChange={(e) => setSharesReq(e.target.value)} inputMode="decimal" />
          </Field>
          <div className="panel" style={{ padding: "4px 14px" }}>
            <KV k="Estimated value" v={usd((Number(sharesReq) || 0) * (vault?.navPerShare ?? 1))} />
            <KV k="Withdrawal fee" v="1% + 0.10 USDG" />
            <KV k="Estimated claim" v={usd(Math.max(0, (Number(sharesReq) || 0) * (vault?.navPerShare ?? 1) * 0.99 - 0.1))} />
          </div>
          <span className="tiny">
            The vault closes the corresponding trading position first. Settlement uses the NAV at closure, so the final claim can
            differ from this estimate. Funds can only go to your own wallet address.
          </span>
        </div>
      </Modal>
    </div>
  );
}
