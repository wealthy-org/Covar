"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { actions, useCovar } from "@/lib/store";
import { PLATFORM_LIMITS, buildStrategy, opLabel, validateStrategy } from "@/lib/strategy";
import { PROVENANCE_LABEL } from "@/lib/types";
import type { Agent, Decision } from "@/lib/types";
import { cx, dateOnly, dateTime, pct, pctSigned, timeAgo, usd } from "@/lib/format";
import { VAULT_ADDRESS } from "@/lib/chain";
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

const RETURN_LABEL: Record<Agent["provenance"], string> = {
  live: "Live return",
  vault: "Vault share price",
  practice: "Practice return · pretend money",
  testnet: "Test-exchange return · test funds",
  backtest: "Backtest return · history replay",
};

function csvOf(agent: Agent) {
  const esc = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const head = ["time", "market", "inputs", "proposed", "copilot", "risk", "risk_reason", "order", "outcome"].join(",");
  const rows = agent.decisions.map((d) =>
    [d.ts, d.market, d.inputs, d.proposed, d.aiDecision, d.riskDecision, d.riskReason, d.order, d.outcome].map(esc).join(",")
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
  const [recordTab, setRecordTab] = useState<"decisions" | "changes">("decisions");
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
                ? "This record is built from the deployed vault's chain logs."
                : `The indexer did not answer (${vaultFeedState.error ?? "unknown"}). No figures are shown until it does.`
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
              · {agent.liveAgeDays ? `${agent.liveAgeDays} day${agent.liveAgeDays === 1 ? "" : "s"} live` : "not live"} · v{agent.version}
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
                <div className="row gap-12 wrap tiny">
                  <span className="row gap-6">
                    <i className="legend-swatch" style={{ background: "#3B5BDB" }} /> Agent
                  </span>
                  {(agent.benchmark?.length ?? 0) > 0 && (
                    <span className="row gap-6">
                      <i className="legend-swatch legend-dash" style={{ borderColor: "#9AA3B5" }} /> Buy &amp; hold
                    </span>
                  )}
                  {(agent.twin?.length ?? 0) > 0 && (
                    <span className="row gap-6">
                      <i className="legend-swatch legend-dash" style={{ borderColor: "#6B7280" }} /> Rules-only twin
                    </span>
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
                    { key: "eq", label: "Agent equity", color: "#3B5BDB", data: agent.curve, area: true, width: 2 },
                    { key: "bm", label: "Buy & hold benchmark", color: "#9AA3B5", data: agent.benchmark, dash: "4 4", width: 1.4 },
                    { key: "tw", label: "Rules-only twin", color: "#6B7280", data: agent.twin ?? [], dash: "2 3", width: 1.4 },
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

          {/* 3 · full record */}
          <section className="rcard">
            <div className="rcard-head" style={{ paddingBottom: 0 }}>
              <h2 className="rcard-title">The full record</h2>
              <button
                className="btn-out"
                onClick={() => download(`${agent.id}-decisions.csv`, csvOf(agent))}
                disabled={agent.decisions.length === 0}
              >
                ↓ CSV
              </button>
            </div>
            <div className="utabs" style={{ padding: "0 14px", marginTop: 6 }}>
              <button className="utab" data-active={recordTab === "decisions"} onClick={() => setRecordTab("decisions")}>
                Decisions · {agent.decisions.length}
              </button>
              <button className="utab" data-active={recordTab === "changes"} onClick={() => setRecordTab("changes")}>
                Changes · {agent.versions.length}
              </button>
            </div>
            {recordTab === "decisions" ? (
              <div key="decisions" className="fx-in" style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Market</th>
                      <th>Proposed</th>
                      <th>Copilot</th>
                      <th>Risk</th>
                      <th>Order / outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.decisions.map((d) => (
                      <tr key={d.id}>
                        <td className="tiny mono nowrap">{mounted ? dateTime(d.ts) : "…"}</td>
                        <td className="tiny mono nowrap">{d.market}</td>
                        <td className="small" style={{ minWidth: 160 }}>
                          <span className="strong" style={{ color: "var(--ink)" }}>
                            {d.proposed}
                          </span>
                          <div className="tiny">{d.inputs}</div>
                        </td>
                        <td>
                          <span className={d.aiDecision === "reject" ? "pill pill-red" : d.aiDecision === "reduce" ? "pill pill-amber" : "pill pill-accent"}>
                            {d.aiDecision.replace("_", " ")}
                          </span>
                        </td>
                        <td style={{ minWidth: 120 }}>
                          <span className={d.riskDecision === "approved" ? "pill pill-green" : "pill pill-red"}>{d.riskDecision}</span>
                          {d.riskReason && <div className="tiny" style={{ maxWidth: 200, marginTop: 4 }}>{d.riskReason}</div>}
                        </td>
                        <td className="small" style={{ minWidth: 140 }}>
                          {d.order ?? "—"}
                          {d.outcome && <div className="tiny">{d.outcome}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div key="changes" className="rcard-pad stack gap-10 fx-in">
                {[...agent.versions].reverse().map((v) => (
                  <div key={v.version} className="kv" style={{ alignItems: "flex-start" }}>
                    <div className="stack" style={{ gap: 3 }}>
                      <span className="small strong" style={{ color: "var(--ink)" }}>
                        v{v.version} · {v.summary}
                      </span>
                      <span className="tiny">{v.notice}</span>
                    </div>
                    <span className="kv-v" style={{ whiteSpace: "nowrap" }}>
                      {mounted ? dateOnly(v.ts) : "…"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="record-foot">
              <span>
                Every row: market inputs, proposed action, Copilot decision, independent risk decision, order and outcome. AI-credit
                exhaustion never disables stops, exits or the emergency close path.
              </span>
              <span>{onChain ? "Vault reads are live below." : "Check on-chain: no deployed vault for this record yet."}</span>
            </div>
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

          {!isVaultAgent && (
          <>
          {/* 5 · how it trades | risk limits */}
          {rules && (
            <div className="detail-two">
              <section className="rcard rcard-pad stack gap-12">
                <div className="row between gap-8">
                  <h2 className="rcard-title">How it trades</h2>
                  <span className="tagbox tagbox-accent">typed · validated</span>
                </div>
                <div className="stack gap-6">
                  <span className="stat-label">Entry · match {rules.entryLogic}</span>
                  {rules.entry.map((c) => (
                    <code key={c.id} className="rule-line">
                      {c.left} {opLabel[c.op]} {c.right}
                    </code>
                  ))}
                </div>
                <div className="stack gap-6">
                  <span className="stat-label">Exit · match {rules.exitLogic}</span>
                  {rules.exit.map((c) => (
                    <code key={c.id} className="rule-line">
                      {c.left} {opLabel[c.op]} {c.right}
                    </code>
                  ))}
                </div>
                <div>
                  <KV k="Market" v={agent.market} />
                  <KV k="Timeframe" v={agent.timeframe} />
                  <KV k="Copilot" v={rules.copilot.mode} />
                  <KV k="Rules-only twin" v={rules.copilot.rulesOnlyTwin ? "recorded" : "off"} />
                </div>
              </section>
              <section className="rcard rcard-pad stack gap-12">
                <h2 className="rcard-title">Risk limits</h2>
                <div>
                  <KV k="Leverage" v={`${rules.risk.leverage}x`} />
                  <KV k="Max position" v={`${rules.risk.maxPositionPct}%`} />
                  <KV k="Per-trade stop" v={`${rules.risk.stopLossPct}%`} />
                  <KV k="Take profit" v={`${rules.risk.takeProfitPct}%`} />
                  <KV k="Daily loss pause" v={`${rules.risk.dailyLossPausePct}%`} />
                  <KV k="Drawdown stop" v={`${rules.risk.maxDrawdownPct}%`} />
                </div>
                <span className="mono-note">
                  Position and leverage caps are enforced by the risk service and signer permissions; loss pauses are server-side
                  triggers, not on-chain guarantees. A trigger limits new risk — it cannot promise a maximum loss during gaps.
                </span>
                {issues.map((i, idx) => (
                  <span key={idx} className="tiny" style={{ color: i.level === "error" ? "var(--negative)" : "var(--warning)" }}>
                    {i.level === "error" ? "Error" : "Warning"} · {i.message}
                  </span>
                ))}
              </section>
            </div>
          )}

          {/* 6 · how it stays up to date | versions */}
          <div className="detail-two">
            <section className="rcard rcard-pad stack gap-12">
              <h2 className="rcard-title">How it stays up to date</h2>
              {[
                ["01", "Every idea is checked twice", "The Copilot reviews each proposal; the risk service then approves or refuses it on its own authority."],
                ["02", "Changes are versioned", "A rules change becomes a new version. Old results are kept, never recalculated."],
                ["03", "Investors get notice", "With investors in the vault, a change waits out a 48h notice and states what happens to open positions."],
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
            </section>
            <section className="rcard rcard-pad stack gap-12">
              <h2 className="rcard-title">Versions</h2>
              <div className="timeline">
                {[...agent.versions].reverse().map((v) => (
                  <div key={v.version} className="timeline-item">
                    <span className="timeline-dot" />
                    <div className="stack" style={{ gap: 2 }}>
                      <div className="row gap-8 wrap">
                        <span className="small strong" style={{ color: "var(--ink)" }}>
                          v{v.version}
                        </span>
                        <span className={v.status === "active" ? "pill pill-green" : v.status === "pending_investor_notice" ? "pill pill-amber" : "pill"}>
                          {v.status.replace(/_/g, " ")}
                        </span>
                        <span className="tiny mono">{mounted ? dateOnly(v.ts) : "…"}</span>
                      </div>
                      <span className="tiny">{v.summary}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          </>
          )}

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
              <KV k="Vault contract" v={vault ? (onChain ? vault.address : "demo record · not deployed") : "no vault"} />
              <KV k="Network" v={isVaultAgent && vaultFeedState.summary ? `${chainLabel(vaultFeedState.summary.chainId)} · ${vaultFeedState.summary.chainId}` : "Robinhood Chain testnet · 46630"} />
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
        subtitle="USDG on Robinhood Chain testnet"
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
            <KV k="Network" v="Robinhood Chain testnet (46630)" />
            <KV k="Deposit fee" v={`${PLATFORM_LIMITS.depositFeePct}% + ${PLATFORM_LIMITS.depositFeeFlat.toFixed(2)} USDG`} />
            <KV k="Net into vault" v={usd(Math.max(0, deposit - feePreview))} />
            <KV k="Shares at NAV" v={(Math.max(0, deposit - feePreview) / (vault?.navPerShare ?? 1)).toFixed(4)} />
            <KV k="NAV used" v={vault?.navPerShare.toFixed(4) ?? "—"} />
          </div>
          <div className="notice notice-warn">
            <div>
              Testnet only. Shares are minted against the NAV shown; if the NAV is stale beyond the allowed window the contract
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
