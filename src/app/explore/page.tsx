"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCovar } from "@/lib/store";
import { TokenLogo } from "@/components/ui";
import { Sparkline } from "@/components/Chart";
import { PROVENANCE_LABEL } from "@/lib/types";
import { cx, pct, pctSigned, usd } from "@/lib/format";
import type { Agent } from "@/lib/types";
import { VAULT_AGENT_ID } from "@/lib/vaultAgent";

/**
 * Reference layout (sharpe.ac /discover): title + mono subtitle, underline tabs
 * LIVE VAULTS / AGENT ARENA with SORT BY on the right, then one white table card
 * (vaults) or a grid of practice cards (arena). Backtests are shown in the arena
 * under their own heading and are never ranked against real records.
 */
type Tab = "vaults" | "arena";

const SORTS = [
  { id: "tvl", label: "TVL" },
  { id: "score", label: "Covar score" },
  { id: "return", label: "Return" },
  { id: "drawdown", label: "Smallest drop" },
  { id: "age", label: "Longest record" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const sorter = (sort: SortId) => (a: Agent, b: Agent) => {
  switch (sort) {
    case "return":
      return b.returnPct - a.returnPct;
    case "tvl":
      return b.tvlUsd - a.tvlUsd;
    case "drawdown":
      return b.drawdownPct - a.drawdownPct;
    case "age":
      return b.liveAgeDays - a.liveAgeDays;
    default:
      return b.score - a.score;
  }
};

const RECORD_LABEL: Record<Agent["provenance"], string> = {
  practice: "Practice return · pretend money",
  testnet: "Test-exchange return · test funds",
  backtest: "Backtest return · history replay",
  live: "Live return",
  vault: "Vault share price",
};

const PILL: Record<Agent["provenance"], string> = {
  practice: "pill pill-accent",
  testnet: "pill pill-amber",
  backtest: "pill",
  live: "pill pill-ink",
  vault: "pill pill-ink",
};

function ArenaCard({ agent }: { agent: Agent }) {
  const up = agent.returnPct >= 0;
  const days = Math.max(1, agent.liveAgeDays || agent.curve.length);
  return (
    <Link href={`/agents/${agent.id}`} className="rcard arena-card">
      <div className="row gap-10" style={{ minWidth: 0 }}>
        <TokenLogo market={agent.market} size={30} />
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong truncate" style={{ fontSize: 14.5, color: "var(--ink)" }}>
            {agent.name}
          </span>
          <span className="tiny mono">
            {agent.market} · {agent.timeframe}
          </span>
        </div>
        <span className="spacer" />
        <span className={PILL[agent.provenance]}>{agent.provenance}</span>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <span className="stat-label">{RECORD_LABEL[agent.provenance]}</span>
        <span className="mono-num" style={{ fontSize: 30, lineHeight: 1.1, color: up ? "var(--positive)" : "var(--negative)" }}>
          {pctSigned(agent.returnPct)}
        </span>
      </div>

      <Sparkline data={agent.curve} width={300} height={56} fluid color={up ? "#137A4B" : "#B42318"} />

      <div className="arena-stats">
        <div className="stack" style={{ gap: 2 }}>
          <span className="stat-label">Trades</span>
          <span className="mono-num">{agent.tradeCount}</span>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="stat-label">Worst drop</span>
          <span className="mono-num neg">{pct(agent.drawdownPct)}</span>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="stat-label">{agent.provenance === "backtest" ? "Replayed" : "Running for"}</span>
          <span className="mono-num">{days}d</span>
        </div>
      </div>

      <span className="accent-link" style={{ fontSize: 11 }}>
        See its trades and history →
      </span>
    </Link>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const { agents, creators } = useCovar();
  const [tab, setTab] = useState<Tab>("vaults");
  const [sort, setSort] = useState<SortId>("tvl");

  // the deployed vault (chain data, 3.6) is pinned first; demo records follow in the chosen order
  const vaults = useMemo(
    () => [
      ...agents.filter((a) => a.id === VAULT_AGENT_ID),
      ...agents.filter((a) => a.id !== VAULT_AGENT_ID && a.provenance === "live" && !!a.vault).sort(sorter(sort)),
    ],
    [agents, sort]
  );
  const arena = useMemo(
    () => agents.filter((a) => a.provenance === "practice" || a.provenance === "testnet").sort(sorter(sort === "tvl" ? "return" : sort)),
    [agents, sort]
  );
  const backtests = useMemo(() => agents.filter((a) => a.provenance === "backtest"), [agents]);
  const creatorOf = (id: string) => creators.find((c) => c.id === id);
  const running = arena.filter((a) => a.status === "practice" || a.status === "live").length;

  return (
    <div className="wrap-md page-pad">
      <div className="page-head">
        <h1 className="page-title">Discover</h1>
        <p className="page-sub">
          {tab === "vaults"
            ? "Agents with a real-money record and an open vault. Index rows in this build are seeded demo data."
            : "Agents still proving themselves with pretend money or test funds. Nothing here takes deposits."}
        </p>
      </div>

      <div className="row between gap-12 wrap" style={{ borderBottom: "1px solid var(--border)", marginBottom: 22 }}>
        <div className="utabs" role="tablist" style={{ borderBottom: 0 }}>
          {(
            [
              ["vaults", "Live vaults"],
              ["arena", "Agent arena"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className="utab" data-active={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="row gap-8" style={{ paddingBottom: 8 }}>
          <span className="stat-label">Sort by</span>
          <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Sort agents">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div key={tab} className="fx-in">
      {tab === "vaults" ? (
        <>
          <div className="table-wrap">
            <table className="table table-rows">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="hide-sm">Creator</th>
                  <th className="right hide-sm">Fee</th>
                  <th className="right">Return</th>
                  <th className="right hide-md">Covar score</th>
                  <th className="right">TVL</th>
                  <th className="right hide-sm">Age</th>
                </tr>
              </thead>
              <tbody>
                {vaults.map((a) => (
                  <tr key={a.id} className="row-click" onClick={() => router.push(`/agents/${a.id}`)}>
                    <td>
                      <div className="row gap-10" style={{ flexWrap: "nowrap" }}>
                        <TokenLogo market={a.market} />
                        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                          <span className="row gap-8" style={{ flexWrap: "nowrap" }}>
                            <Link href={`/agents/${a.id}`} className="table-strong" style={{ color: "var(--ink)", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                              {a.name}
                            </Link>
                            <span className="tagbox hide-xs">{a.market}</span>
                            {a.id === VAULT_AGENT_ID && (
                              <span className="pill pill-green" data-testid="onchain-vault-tag" title="Every figure in this row is read from the deployed vault's chain logs">
                                on-chain
                              </span>
                            )}
                          </span>
                          <span className="tiny mono">
                            {PROVENANCE_LABEL[a.provenance].toLowerCase()} · {a.status === "live" ? "operating" : a.status.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="mono tiny hide-sm">@{creatorOf(a.creatorId)?.handle ?? "you"}</td>
                    <td className="right hide-sm">{a.id === VAULT_AGENT_ID ? "—" : "≤20%"}</td>
                    <td className={cx("right", a.returnPct >= 0 ? "pos" : "neg")}>{pctSigned(a.returnPct)}</td>
                    <td className="right hide-md">{a.score ? a.score.toFixed(2) : "—"}</td>
                    <td className="right">{usd(a.tvlUsd || 0, { compact: true })}</td>
                    <td className="right hide-sm">{a.liveAgeDays ? `${a.liveAgeDays}d` : "—"}</td>
                  </tr>
                ))}
                {vaults.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 32 }}>
                      <span className="small">No live vaults yet.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mono-note" style={{ marginTop: 18, maxWidth: 980 }}>
            Return is net of fees and costs over the agent&apos;s own record. An agent under 7 days live shows its practice figures
            (marked practice), then its own live run, then its vault&apos;s record once that has 7 days of share price. Backtests
            never enter the ranking. Past results don&apos;t promise future ones.
          </p>
        </>
      ) : (
        <div className="stack gap-24">
          <span className="stat-label">
            {arena.length} agent{arena.length === 1 ? "" : "s"} · {running} running
          </span>
          {arena.length > 0 ? (
            <div className="arena-grid">
              {arena.map((a) => (
                <ArenaCard key={a.id} agent={a} />
              ))}
            </div>
          ) : (
            <div className="rcard rcard-pad small">No agents are practising right now.</div>
          )}

          <div className="rcard arena-banner">
            <div className="stack" style={{ gap: 4 }}>
              <span className="strong" style={{ color: "var(--ink)", fontSize: 15 }}>
                Have a strategy idea?
              </span>
              <span className="small">Describe it in plain words. Covar builds the agent, backtests it, then lets it practise here.</span>
            </div>
            <Link href="/studio?new=1" className="btn-ink">
              Open studio →
            </Link>
          </div>

          {backtests.length > 0 && (
            <section className="stack gap-14">
              <div className="stack" style={{ gap: 4 }}>
                <span className="label-dot">Backtests · not ranked</span>
                <span className="mono-note">Reproducible history replays. Not investable and never compared with real records.</span>
              </div>
              <div className="arena-grid">
                {backtests.map((a) => (
                  <ArenaCard key={a.id} agent={a} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
