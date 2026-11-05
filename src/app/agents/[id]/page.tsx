"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { actions, useCovar } from "@/lib/store";
import { PLATFORM_LIMITS, buildStrategy, opLabel, validateStrategy } from "@/lib/strategy";
import { PROVENANCE_LABEL } from "@/lib/types";
import { cx, dateOnly, dateTime, pct, pctSigned, timeAgo, usd } from "@/lib/format";
import { LineChart } from "@/components/Chart";
import { Empty, Field, Modal, ProvenanceBadge, useToast } from "@/components/ui";
import { OnChainVaultCard } from "@/components/ChainPanel";

const TABS = ["Overview", "Activity", "Rules", "Versions", "Vault"] as const;
type Tab = (typeof TABS)[number];

export default function AgentPage() {
  const params = useParams<{ id: string }>();
  const { agents, creators, portfolio, practice, liveStrategy } = useCovar();
  const { toast, node } = useToast();
  const agent = agents.find((a) => a.id === params.id);
  const [tab, setTab] = useState<Tab>("Overview");
  const [depositOpen, setDepositOpen] = useState(false);
  const [amount, setAmount] = useState("250");
  const [error, setError] = useState<string | null>(null);
  const [sharesReq, setSharesReq] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const rules = useMemo(() => {
    if (!agent) return null;
    const stored = liveStrategy[agent.id];
    if (stored) return stored;
    const built = buildStrategy(agent.strategySummary || agent.tagline, agent.id).strategy;
    return { ...built, market: agent.market, timeframe: agent.timeframe as typeof built.timeframe };
  }, [agent, liveStrategy]);

  if (!agent) {
    return (
      <div className="container section">
        <Empty title="Agent not found" body="This agent id does not exist in the current session. Discovery lists every available agent." action={<Link className="btn btn-primary" href="/explore">Back to Discover</Link>} />
      </div>
    );
  }

  const creator = creators.find((c) => c.id === agent.creatorId);
  const holding = portfolio.holdings.find((h) => h.agentId === agent.id);
  const run = practice[agent.id];
  const vault = agent.vault;
  const isInvestable = agent.provenance === "live" && !!vault && agent.status !== "paused";
  const navValue = vault && holding ? holding.shares * vault.navPerShare : 0;
  const pnlOnHolding = holding ? navValue - holding.costBasisUsd : 0;
  const deposit = Number(amount) || 0;
  const feePreview = deposit * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
  const issues = rules ? validateStrategy(rules) : [];

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

  const requested = holding?.requestedWithdrawal;

  return (
    <div className="container section-tight stack gap-20">
      {node}

      {/* --------------------------------- header --------------------------------- */}
      <div className="stack gap-12">
        <div className="row gap-8 tiny">
          <Link href="/explore" className="link-primary">Discover</Link>
          <span>/</span>
          {creator ? (
            <Link href={`/creators/${creator.id}`} className="link-primary">@{creator.handle}</Link>
          ) : (
            <span>you</span>
          )}
          <span>/</span>
          <span>{agent.name}</span>
        </div>

        <div className="row between wrap gap-16">
          <div className="stack gap-10">
            <div className="row gap-10 wrap">
              <h1 className="h2" style={{ fontSize: 32 }}>{agent.name}</h1>
              <span className={cx("badge", agent.status === "live" ? "badge-green" : agent.status === "paused" ? "badge-amber" : "badge-blue")}>
                <span className={cx("dot", agent.status === "live" && "dot-live", agent.status === "paused" && "dot-warn")} />
                {agent.status === "live" ? "Live" : agent.status === "paused" ? "Paused · close-only" : agent.status}
              </span>
              <ProvenanceBadge kind={agent.provenance} />
            </div>
            <p className="lead" style={{ maxWidth: 680, fontSize: 15 }}>{agent.tagline}</p>
            <div className="row gap-12 wrap tiny">
              <span className="badge badge-outline">{agent.market}</span>
              <span className="badge badge-outline">{agent.timeframe}</span>
              <span className="badge badge-outline">v{agent.version}</span>
              <span>by {creator ? <Link className="link-primary" href={`/creators/${creator.id}`}>{creator.name}</Link> : "you"}</span>
              <span>· {agent.liveAgeDays ? `${agent.liveAgeDays} days live` : "not live"}</span>
            </div>
          </div>

          <div className="row gap-8 wrap">
            {agent.isMine && (
              <Link href="/studio" className="btn btn-secondary">
                Operate in Studio
              </Link>
            )}
            <button className="btn btn-secondary" onClick={() => setTab("Rules")}>
              Read the rules
            </button>
            {isInvestable ? (
              <button className="btn btn-primary" onClick={() => setDepositOpen(true)}>
                Deposit USDG
              </button>
            ) : (
              <button className="btn btn-secondary" disabled title="Only agents with a real-money record and an open vault accept deposits">
                Vault closed
              </button>
            )}
          </div>
        </div>
      </div>

      {agent.disclosure && <div className="notice notice-warn">{agent.disclosure}</div>}

      {/* ---------------------------------- stats --------------------------------- */}
      <div className="grid-4">
        <div className="card card-pad">
          <span className="tiny">{agent.provenance === "backtest" ? "Backtest return" : "Return since launch"}</span>
          <div className={cx("stat-value", agent.returnPct >= 0 ? "pos" : "neg")}>{pctSigned(agent.returnPct)}</div>
          <span className="tiny">{PROVENANCE_LABEL[agent.provenance]}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Max drawdown</span>
          <div className="stat-value neg">{pct(agent.drawdownPct)}</div>
          <span className="tiny">peak-to-trough, this record</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Vault TVL</span>
          <div className="stat-value">{vault ? usd(vault.tvlUsd, { compact: true }) : "—"}</div>
          <span className="tiny">{vault ? `NAV ${vault.navPerShare.toFixed(4)} / share` : "no vault"}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Covar score</span>
          <div className="stat-value">{agent.score || "—"}</div>
          <span className="tiny">{agent.score ? "live record only" : "not ranked"}</span>
        </div>
      </div>

      {/* ---------------------------------- chart --------------------------------- */}
      <div className="card card-pad stack gap-14">
        <div className="row between wrap gap-12">
          <div className="stack" style={{ gap: 2 }}>
            <span className="small strong">Equity vs benchmark vs rules-only twin</span>
            <span className="tiny">Indexed to 100 at the start of the record · {agent.tradeCount} trades · {agent.liveAgeDays} days</span>
          </div>
          <div className="row gap-8">
            <span className="badge badge-blue">Covar agent</span>
            <span className="badge badge-outline">Benchmark</span>
            <span className="badge badge-outline">Rules-only twin</span>
          </div>
        </div>
        {(agent.curve?.length ?? 0) < 3 ? (
          <div className="stack center gap-8" style={{ padding: "56px 16px", textAlign: "center" }}>
            <span className="badge badge-outline">No record yet</span>
            <span className="small">This agent has no performance record yet.</span>
            <span className="tiny" style={{ maxWidth: 420 }}>
              Start a practice session in Studio to begin recording. The chart stays empty until there
              is data — no placeholder curve is drawn.
            </span>
          </div>
        ) : (
        <LineChart
          height={280}
          baseline={100}
          series={[
            { key: "eq", label: "Agent equity", color: "#3B5BDB", data: agent.curve, area: true, width: 2 },
            { key: "bm", label: "Buy & hold benchmark", color: "#9AA3B5", data: agent.benchmark, dash: "4 4", width: 1.4 },
            { key: "tw", label: "Rules-only twin", color: "#6B7280", data: agent.twin ?? [], dash: "2 3", width: 1.4 },
          ]}
          yFormat={(n) => n.toFixed(1)}
        />
        )}
      </div>

      {/* ---------------------------------- tabs ---------------------------------- */}
      <div className="two-col">
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="tabs" style={{ padding: "0 8px" }}>
            {TABS.map((t) => (
              <button key={t} className="tab" data-active={tab === t} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          <div style={{ padding: 18 }}>
            {tab === "Overview" && (
              <div className="stack gap-18" style={{ gap: 18 }}>
                <div className="stack gap-8">
                  <span className="small strong">Strategy</span>
                  <p className="body">{agent.strategySummary}</p>
                </div>
                <div className="stack gap-8">
                  <span className="small strong">Risk configuration</span>
                  <p className="body">{agent.riskSummary}</p>
                </div>
                <hr className="divider" />
                <div className="stack gap-8">
                  <span className="small strong">Recent decisions</span>
                  <div className="timeline">
                    {agent.decisions.slice(0, 4).map((d) => (
                      <div key={d.id} className="timeline-item">
                        <span className="timeline-dot" />
                        <div className="stack grow" style={{ gap: 2 }}>
                          <div className="row between gap-8">
                            <span className="small strong">{d.proposed}</span>
                            <span className="tiny">{timeAgo(d.ts)}</span>
                          </div>
                          <span className="tiny">{d.inputs}</span>
                          <div className="row gap-6 wrap" style={{ marginTop: 2 }}>
                            <span className={cx("badge", d.aiDecision === "reject" ? "badge-red" : d.aiDecision === "reduce" ? "badge-amber" : "badge-blue")}>
                              Copilot: {d.aiDecision}
                            </span>
                            <span className={cx("badge", d.riskDecision === "approved" ? "badge-green" : "badge-red")}>
                              Risk: {d.riskDecision}
                            </span>
                            {d.outcome && <span className="badge badge-outline">{d.outcome}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setTab("Activity")}>
                    All decisions →
                  </button>
                </div>
              </div>
            )}

            {tab === "Activity" && (
              <div className="stack gap-12">
                <span className="small">
                  Each row is one operation: strategy version, market inputs, proposed action, Copilot decision, independent
                  risk decision, order and outcome.
                </span>
                <div className="table-wrap panel">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Inputs</th>
                        <th>Proposed</th>
                        <th>Copilot</th>
                        <th>Risk</th>
                        <th>Order / outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agent.decisions.map((d) => (
                        <tr key={d.id}>
                          <td className="tiny nowrap">{dateTime(d.ts)}</td>
                          <td className="small" style={{ maxWidth: 200 }}>{d.inputs}</td>
                          <td className="small strong">{d.proposed}</td>
                          <td>
                            <span className={cx("badge", d.aiDecision === "reject" ? "badge-red" : d.aiDecision === "reduce" ? "badge-amber" : "badge-blue")}>
                              {d.aiDecision}
                            </span>
                          </td>
                          <td>
                            <span className={cx("badge", d.riskDecision === "approved" ? "badge-green" : "badge-red")}>{d.riskDecision}</span>
                            {d.riskReason && <div className="tiny" style={{ maxWidth: 180 }}>{d.riskReason}</div>}
                          </td>
                          <td className="small">
                            {d.order ?? "—"}
                            {d.outcome && <div className="tiny">{d.outcome}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="notice notice-neutral">
                  <div>
                    AI-credit exhaustion does not disable stops, exits or the emergency close path. When the provider is
                    unavailable, the configured fallback (rules-only) applies and the decision is labelled accordingly.
                  </div>
                </div>
              </div>
            )}

            {tab === "Rules" && rules && (
              <div className="stack gap-16">
                <div className="row between wrap gap-8">
                  <span className="small strong">Published rules · v{agent.version}</span>
                  <span className="badge badge-blue">Typed &amp; validated</span>
                </div>
                <div className="grid-2" style={{ gap: 14 }}>
                  <div className="panel stack gap-8" style={{ padding: 14 }}>
                    <span className="tiny strong">ENTRY · match {rules.entryLogic.toUpperCase()}</span>
                    {rules.entry.map((c) => (
                      <span key={c.id} className="mono" style={{ fontSize: 12 }}>{c.left} {opLabel[c.op]} {c.right}</span>
                    ))}
                  </div>
                  <div className="panel stack gap-8" style={{ padding: 14 }}>
                    <span className="tiny strong">EXIT · match {rules.exitLogic.toUpperCase()}</span>
                    {rules.exit.map((c) => (
                      <span key={c.id} className="mono" style={{ fontSize: 12 }}>{c.left} {opLabel[c.op]} {c.right}</span>
                    ))}
                  </div>
                </div>
                <div className="grid-4">
                  {[
                    ["Leverage", `${rules.risk.leverage}x`],
                    ["Max position", `${rules.risk.maxPositionPct}%`],
                    ["Per-trade stop", `${rules.risk.stopLossPct}%`],
                    ["Take profit", `${rules.risk.takeProfitPct}%`],
                    ["Daily pause", `${rules.risk.dailyLossPausePct}%`],
                    ["Drawdown stop", `${rules.risk.maxDrawdownPct}%`],
                    ["Copilot", rules.copilot.mode],
                    ["Rules-only twin", rules.copilot.rulesOnlyTwin ? "recorded" : "off"],
                  ].map(([k, v]) => (
                    <div key={k} className="panel" style={{ padding: 12 }}>
                      <span className="tiny">{k}</span>
                      <div className="small strong num">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="notice">
                  <div>
                    <strong>What is enforceable where.</strong> Position and leverage caps are enforced by the risk service
                    and signer permissions; loss pauses are server-side triggers, not on-chain guarantees; deposit and
                    withdrawal rules live in the vault contract. A trigger limits new risk — it cannot promise a maximum
                    realised loss during gaps or execution failure.
                  </div>
                </div>
                {issues.length > 0 && (
                  <div className="stack gap-6">
                    {issues.map((i, idx) => (
                      <span key={idx} className="tiny" style={{ color: i.level === "error" ? "var(--negative)" : "var(--warning)" }}>
                        {i.level === "error" ? "Error" : "Warning"} · {i.message}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "Versions" && (
              <div className="stack gap-12">
                <div className="row between">
                  <span className="small strong">Version history</span>
                  <span className="tiny">changes are traceable; old results are kept, not recalculated</span>
                </div>
                {[...agent.versions].reverse().map((v) => (
                  <div key={v.version} className="panel" style={{ padding: 14 }}>
                    <div className="row between wrap gap-8">
                      <div className="row gap-8">
                        <span className="badge badge-outline">v{v.version}</span>
                        <span className={cx("badge", v.status === "active" ? "badge-green" : v.status === "pending_investor_notice" ? "badge-amber" : "badge")}>
                          {v.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <span className="tiny">{dateOnly(v.ts)}</span>
                    </div>
                    <p className="small" style={{ marginTop: 8 }}>{v.summary}</p>
                    <p className="tiny" style={{ marginTop: 4 }}>{v.notice}</p>
                  </div>
                ))}
                <div className="notice notice-warn">
                  <div>
                    Changing a version while investors hold shares requires the investor notice period (48h) and an explicit
                    statement of what happens to open positions. A draft edit never becomes a published version silently.
                  </div>
                </div>
              </div>
            )}

            {tab === "Vault" && (
              <div className="stack gap-16">
                {!vault ? (
                  <Empty
                    title="No vault for this agent"
                    body="This agent has no vault. Only agents with a real-money record can open one; practice and backtest records are never investable."
                    action={<Link href="/explore" className="btn btn-secondary">Browse investable agents</Link>}
                  />
                ) : (
                  <>
                    <div className="grid-4">
                      <div className="panel" style={{ padding: 12 }}>
                        <span className="tiny">NAV / share</span>
                        <div className="small strong num">{vault.navPerShare.toFixed(4)} USDG</div>
                      </div>
                      <div className="panel" style={{ padding: 12 }}>
                        <span className="tiny">Shares outstanding</span>
                        <div className="small strong num">{vault.sharesOutstanding.toLocaleString("en-US")}</div>
                      </div>
                      <div className="panel" style={{ padding: 12 }}>
                        <span className="tiny">Pending deposits</span>
                        <div className="small strong num">{usd(vault.pendingDeposits, { compact: true })}</div>
                      </div>
                      <div className="panel" style={{ padding: 12 }}>
                        <span className="tiny">Pending withdrawals</span>
                        <div className="small strong num">{usd(vault.pendingWithdrawals, { compact: true })}</div>
                      </div>
                    </div>

                    <div className="panel stack gap-8" style={{ padding: 14 }}>
                      <div className="row between">
                        <span className="tiny">Vault contract</span>
                        <span className="badge badge-amber">{vault.chain === "robinhood-testnet" ? "Robinhood testnet 46630" : "mainnet"}</span>
                      </div>
                      <span className="mono">{vault.address}</span>
                      <div className="row between">
                        <span className="tiny">Deposit fee</span>
                        <span className="small strong">{vault.depositFeePct}% + {vault.depositFeeFlat.toFixed(2)} USDG</span>
                      </div>
                      <div className="row between">
                        <span className="tiny">Creator fee on winning trades</span>
                        <span className="small strong">{rules?.feeChoicePct ?? 10}% (80/20 creator/platform)</span>
                      </div>
                      <div className="row between">
                        <span className="tiny">Withdrawal flow</span>
                        <span className="small strong">request → close positions → settle → claim</span>
                      </div>
                    </div>

                    {holding ? (
                      <div className="panel stack gap-10" style={{ padding: 14 }}>
                        <div className="row between">
                          <span className="small strong">Your position</span>
                          <span className="tiny">entry NAV {holding.entryNav.toFixed(4)}</span>
                        </div>
                        <div className="grid-4">
                          <div>
                            <span className="tiny">Shares</span>
                            <div className="small strong num">{holding.shares.toFixed(2)}</div>
                          </div>
                          <div>
                            <span className="tiny">Value</span>
                            <div className="small strong num">{usd(navValue)}</div>
                          </div>
                          <div>
                            <span className="tiny">Cost basis</span>
                            <div className="small strong num">{usd(holding.costBasisUsd)}</div>
                          </div>
                          <div>
                            <span className="tiny">P&amp;L</span>
                            <div className={cx("small strong num", pnlOnHolding >= 0 ? "pos" : "neg")}>
                              {pnlOnHolding >= 0 ? "+" : "−"}{usd(Math.abs(pnlOnHolding))}
                            </div>
                          </div>
                        </div>

                        {requested ? (
                          <div className="soft stack gap-8" style={{ padding: 12 }}>
                            <div className="row between">
                              <span className="small strong">Withdrawal request · {requested.shares.toFixed(2)} shares</span>
                              <span className="badge badge-blue">{requested.state.replace(/_/g, " ")}</span>
                            </div>
                            <span className="tiny">
                              Requested {timeAgo(requested.requestedAt)} · estimated {usd(requested.estUsd)} after fee ·
                              settlement requires closing the vault position first.
                            </span>
                            <div className="row gap-8 wrap">
                              {requested.state !== "claimable" && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    actions.advanceWithdrawal(agent.id);
                                    toast("Operator step applied: positions closed, settlement pending");
                                  }}
                                >
                                  Simulate operator step
                                </button>
                              )}
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={requested.state !== "claimable"}
                                onClick={() => {
                                  actions.claimWithdrawal(agent.id);
                                  toast("Claimed to wallet · recorded in the ledger");
                                }}
                              >
                                {requested.state === "claimable" ? `Claim ${usd(requested.estUsd)}` : "Claim locked until settled"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="row gap-8 wrap">
                            <button className="btn btn-secondary btn-sm" onClick={() => { setSharesReq(String(holding.shares.toFixed(2))); setWithdrawOpen(true); }}>
                              Request withdrawal
                            </button>
                            <button className="btn btn-soft btn-sm" onClick={() => setDepositOpen(true)}>
                              Add funds
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="panel stack gap-10" style={{ padding: 14 }}>
                        <span className="small strong">You have no position in this vault</span>
                        <span className="tiny">
                          Deposits mint shares at the current NAV after the 1% + 0.10 USDG fee. Trading authority cannot
                          redirect your withdrawal to an operator address.
                        </span>
                        <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setDepositOpen(true)}>
                          Deposit USDG
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------- right rail ------------------------------- */}
        <div className="stack gap-16 sticky-side">
          <div className="card card-pad stack gap-12">
            <span className="small strong">Creator</span>
            <div className="row gap-10">
              <span className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
                {(creator?.handle ?? "you").slice(0, 2).toUpperCase()}
              </span>
              <div className="stack" style={{ gap: 1 }}>
                <span className="small strong">{creator?.name ?? "Your workspace"}</span>
                <span className="tiny">
                  @{creator?.handle ?? "you"} · {creator?.followers ?? 0} followers
                </span>
              </div>
            </div>
            <p className="tiny">{creator?.bio ?? "Local workspace creator profile."}</p>
            {creator && (
              <Link href={`/creators/${creator.id}`} className="btn btn-secondary btn-sm">
                Creator record
              </Link>
            )}
          </div>

          <div className="card card-pad stack gap-10">
            <span className="small strong">Terms</span>
            {[
              ["Deposit fee", `${vault?.depositFeePct ?? 1}% + ${(vault?.depositFeeFlat ?? 0.1).toFixed(2)} USDG`],
              ["Creator fee", `${rules?.feeChoicePct ?? 10}% of winning profit`],
              ["Creator/platform split", "80 / 20"],
              ["Losing trades netted?", "No"],
              ["Withdrawal unwind", `${vault?.unwindDays ?? 2} days`],
              ["Min deposit", "10 USDG"],
            ].map(([k, v]) => (
              <div key={k} className="row between gap-8">
                <span className="tiny">{k}</span>
                <span className="small strong" style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
            <hr className="divider" />
            <span className="tiny">
              Investor capital is a capital flow, not platform revenue. Fees are charged on the base stated above and
              recorded separately from P&amp;L.
            </span>
          </div>

          {run && (
            <div className="card card-pad stack gap-8">
              <div className="row between">
                <span className="small strong">Practice session</span>
                <span className={cx("badge", run.status === "running" ? "badge-green" : "badge")}>{run.status}</span>
              </div>
              <div className={cx("num strong", run.pnlUsd >= 0 ? "pos" : "neg")}>{usd(run.pnlUsd)}</div>
              <span className="tiny">
                {usd(run.capitalUsd)} simulated capital · {run.ticks} ticks · marks:{" "}
                {run.priceMode === "live" ? `live (${run.priceSource ?? "market feed"})${run.lastPrice ? ` · ${usd(run.lastPrice)}` : ""}` : "simulated"} ·
                started {timeAgo(run.startedAt)}
              </span>
              <Link href="/studio" className="btn btn-secondary btn-sm">Manage in Studio</Link>
            </div>
          )}

          <OnChainVaultCard />

          <div className="card card-pad stack gap-8">
            <span className="small strong">Provenance</span>
            <ProvenanceBadge kind={agent.provenance} />
            <span className="tiny">
              {agent.provenance === "live"
                ? "Real-money record with reconciled fills. Vault NAV is a separate on-chain share price record."
                : agent.provenance === "backtest"
                  ? "Historical simulation on a pinned dataset. Never presented as live performance."
                  : agent.provenance === "practice"
                    ? "Practice ledger in isolation: marks come from the live market feed (Hyperliquid perp mids) when reachable, else simulated ticks — the run says which. Fills are always simulated; no investor capital."
                    : "Test-exchange orders with faucet funds. Not comparable to real-money results."}
            </span>
          </div>
        </div>
      </div>

      {/* -------------------------------- depositing ------------------------------- */}
      <Modal
        open={depositOpen}
        onClose={() => { setDepositOpen(false); setError(null); }}
        title={`Deposit into ${agent.name}`}
        subtitle="USDG on Robinhood Chain testnet"
        footer={
          <>
            <span className="tiny">Fee {usd(feePreview)} · {usd(Math.max(0, deposit - feePreview))} net</span>
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
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              inputMode="decimal"
            />
          </Field>
          <div className="row gap-6 wrap">
            {[100, 250, 500].map((v) => (
              <button key={v} className="chip" onClick={() => setAmount(String(v))}>{usd(v, { max: 0 })}</button>
            ))}
            <button className="chip" onClick={() => setAmount(String(Math.floor(portfolio.cashUsd)))}>Max</button>
          </div>
          <div className="panel stack gap-8" style={{ padding: 14 }}>
            {[
              ["Asset", "USDG · 6 decimals"],
              ["Network", "Robinhood Chain testnet (46630)"],
              ["Deposit fee", `${PLATFORM_LIMITS.depositFeePct}% + ${PLATFORM_LIMITS.depositFeeFlat.toFixed(2)} USDG`],
              ["Net into vault", usd(Math.max(0, deposit - feePreview))],
              ["Shares at NAV", `${(Math.max(0, deposit - feePreview) / (vault?.navPerShare ?? 1)).toFixed(4)}`],
              ["Nav used", vault?.navPerShare.toFixed(4) ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="row between">
                <span className="tiny">{k}</span>
                <span className="small strong num">{v}</span>
              </div>
            ))}
          </div>
          <div className="notice notice-warn">
            <div>
              Testnet only. Shares are minted against the NAV shown; if the NAV is stale beyond the allowed window the
              contract rejects the deposit rather than minting at a manipulable price.
            </div>
          </div>
        </div>
      </Modal>

      {/* ------------------------------- withdrawing ------------------------------- */}
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
          <div className="panel stack gap-8" style={{ padding: 14 }}>
            <div className="row between">
              <span className="tiny">Estimated value</span>
              <span className="small strong num">
                {usd((Number(sharesReq) || 0) * (vault?.navPerShare ?? 1))}
              </span>
            </div>
            <div className="row between">
              <span className="tiny">Withdrawal fee</span>
              <span className="small strong num">
                1% + 0.10 USDG
              </span>
            </div>
            <div className="row between">
              <span className="tiny">Estimated claim</span>
              <span className="small strong num">
                {usd(Math.max(0, (Number(sharesReq) || 0) * (vault?.navPerShare ?? 1) * 0.99 - 0.1))}
              </span>
            </div>
          </div>
          <span className="tiny">
            The vault closes the corresponding trading position first. Settlement uses the NAV at closure, so the final
            claim can differ from this estimate. Funds can only go to your own wallet address.
          </span>
        </div>
      </Modal>
    </div>
  );
}
