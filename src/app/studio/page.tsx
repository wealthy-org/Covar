"use client";

import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Builder } from "@/components/Builder";
import { actions, useCovar } from "@/lib/store";
import { pct, pctSigned, usd } from "@/lib/format";
import { Empty, ProvenanceBadge, TokenLogo, useToast } from "@/components/ui";
import { WalletGate } from "@/components/WalletGate";
import { useCredits } from "@/lib/creditsClient";
import { priceFor, sourceLabel, usePrices } from "@/lib/usePrices";

function StudioInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { agents, drafts, practice } = useCovar();
  const { toast, node } = useToast();
  const credits = useCredits();
  const isNew = params.get("new") === "1";

  const mine = agents.filter((a) => a.isMine);
  const running = Object.values(practice).filter((p) => p.status === "running");
  const prices = usePrices();
  const liveMarkets = new Set(Object.keys(prices?.prices ?? {}));

  // Tick running practice sessions on the same clock as the mark. Sessions started
  // with a live mark follow the real price; the rest keep the simulated wave and say so.
  useEffect(() => {
    const t = setInterval(() => {
      Object.values(practice)
        .filter((p) => p.status === "running")
        .forEach((p) => {
          const agent = agents.find((a) => a.id === p.agentId);
          actions.tickPractice(p.agentId, agent ? priceFor(prices, agent.market) : undefined);
        });
    }, 2500);
    return () => clearInterval(t);
  }, [practice, prices, agents]);

  if (isNew) return <Builder />;

  return (
    <div className="wrap-md page-pad stack gap-24">
      {node}
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
          <div className="stat-value">{running.length}</div>
          <span className="tiny">
            marks: {prices?.ok ? `live · ${sourceLabel(prices)}` : "simulated ticks"}
          </span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Copilot credits</span>
          <div className="stat-value">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          <Link className="btn btn-soft btn-sm" style={{ marginTop: 6 }} href="/portfolio#credits">
            {credits.signedIn ? "Top up" : "Sign in to use"}
          </Link>
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="card stack">
          <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <span className="small strong">Drafts</span>
            <span className="tiny">not investable</span>
          </div>
          <table className="table table-min">
            <thead>
              <tr>
                <th>Name</th>
                <th>Market</th>
                <th className="right">Leverage</th>
                <th className="right">Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td className="strong">
                    <div className="row gap-10" style={{ flexWrap: "nowrap" }}>
                      <TokenLogo market={d.market} size={24} />
                      <span>{d.name}</span>
                    </div>
                  </td>
                  <td className="small">{d.market} · {d.timeframe}</td>
                  <td className="right num">{d.risk.leverage}x</td>
                  <td className="right small">{new Date(d.createdAt).toLocaleDateString("en-GB")}</td>
                  <td className="right">
                    <Link href="/studio?new=1" className="btn btn-secondary btn-sm">
                      Open
                    </Link>
                    <button className="btn btn-ghost btn-sm" onClick={() => actions.removeDraft(d.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card stack">
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="small strong">Operated agents</span>
          <span className="tiny">start/stop practice · pause live execution</span>
        </div>

        {mine.length === 0 ? (
          <Empty
            title="No agents yet"
            body="Describe a strategy in the builder and publish version 1 to create your first agent. It starts in practice — no capital, no vault."
            action={
              <Link href="/studio?new=1" className="btn btn-primary">
                Create your first agent
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-min">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Record</th>
                  <th className="right">Return</th>
                  <th className="right">Practice P&amp;L</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((a) => {
                  const run = practice[a.id];
                  return (
                    <tr key={a.id}>
                      <td>
<div className="row gap-10" style={{ flexWrap: "nowrap" }}>
                      <TokenLogo market={a.market} size={26} />
                      <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                        <Link href={`/agents/${a.id}`} className="strong">
                          {a.name}
                        </Link>
                        <div className="tiny">{a.market} · v{a.version}</div>
                      </div>
                    </div>
                      </td>
                      <td>
                        <span className="badge badge-outline">{a.status}</span>
                      </td>
                      <td>
                        <ProvenanceBadge kind={a.provenance} />
                      </td>
                      <td className={`right num ${a.returnPct >= 0 ? "pos" : "neg"}`}>{pctSigned(a.returnPct)}</td>
                      <td className="right num">
                        {run ? (
                          <span className={run.pnlUsd >= 0 ? "pos" : "neg"}>
                            {usd(run.pnlUsd)}{" "}
                            <span className="tiny">
                              ({run.ticks} ticks ·{" "}
                              {run.priceMode === "live" && liveMarkets.size > 0
                                ? `live ${run.lastPrice ? usd(run.lastPrice) : ""}`
                                : "simulated"})
                            </span>
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row gap-6 wrap">
                          {run?.status === "running" ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                actions.stopPractice(a.id);
                                toast(`Practice stopped — ${pct(run.pnlUsd / 100)} result kept with the practice label`);
                              }}
                            >
                              Stop practice
                            </button>
                          ) : (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                const mark = priceFor(prices, a.market);
                                actions.startPractice(a.id, 10_000, {
                                  price: mark,
                                  source: mark ? sourceLabel(prices) : undefined,
                                });
                                toast(
                                  mark
                                    ? `Practice started at the live ${a.market} mark (${usd(mark)}) with $10,000 simulated capital`
                                    : "Practice started with $10,000 simulated capital — simulated ticks (price feed unavailable)"
                                );
                              }}
                            >
                              Start practice
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              actions.setAgentStatus(a.id, a.status === "live" ? "paused" : "live");
                              toast(a.status === "live" ? "Agent paused — close-only, exits still enabled" : "Agent resumed");
                            }}
                          >
                            {a.status === "live" ? "Pause" : "Resume live"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="notice notice-neutral">
        <div>
          <strong>Practice, test exchange and real money are separate ledgers.</strong> Starting practice never mixes
          simulated balances with vault capital. A live agent paused here keeps its exit and claim path open — pausing
          stops new risk, it does not trap investor funds.
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
