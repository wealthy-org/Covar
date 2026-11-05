"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCovar } from "@/lib/store";
import { ProvenanceBadge } from "@/components/ui";
import { PROVENANCE_LABEL } from "@/lib/types";
import { cx, pct, pctSigned, usd } from "@/lib/format";
import type { Agent, Provenance } from "@/lib/types";

/**
 * Reference layout: page title + one-line subtitle, a tab row with the sort
 * control on the right, then a single table. Provenance is not a filter chip
 * bolted on afterwards — it is a column, and a tab boundary.
 */
const TABS: { id: string; label: string; blurb: string }[] = [
  { id: "vaults", label: "Live vaults", blurb: "Agents with real-money records and an open vault." },
  { id: "all", label: "Agent arena", blurb: "Every agent, whatever its record." },
  { id: "research", label: "Backtests", blurb: "Reproducible research runs. Not investable, never ranked." },
];

const SORTS = [
  { id: "tvl", label: "TVL" },
  { id: "score", label: "Covar score" },
  { id: "return", label: "Return" },
  { id: "drawdown", label: "Smallest drawdown" },
  { id: "age", label: "Longest record" },
] as const;

const TONES = ["#3B5BDB", "#2F49B5", "#3D6FA8", "#5B5BD6", "#4A5FBF", "#385B8C"];

function Avatar({ agent, index }: { agent: Agent; index: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: TONES[index % TONES.length],
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        flex: "0 0 auto",
      }}
    >
      {agent.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function ExplorePage() {
  const { agents, creators } = useCovar();
  const [tab, setTab] = useState("vaults");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("tvl");
  const [market, setMarket] = useState("all");
  const [q, setQ] = useState("");

  const markets = useMemo(() => Array.from(new Set(agents.map((a) => a.market))).sort(), [agents]);

  const list = useMemo(() => {
    let out = agents.filter((a) => {
      if (tab === "vaults") return a.provenance === "live" && !!a.vault;
      if (tab === "research") return a.provenance === "backtest";
      return true;
    });
    if (market !== "all") out = out.filter((a) => a.market === market);
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter((a) => (a.name + a.tagline + a.market).toLowerCase().includes(needle));
    }
    return [...out].sort((a, b) => {
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
    });
  }, [agents, tab, market, q, sort]);

  const creatorOf = (id: string) => creators.find((c) => c.id === id);
  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="container section-tight stack gap-20">
      {/* header */}
      <div className="stack gap-6" style={{ paddingTop: 8 }}>
        <h1 className="h2">Discover</h1>
        <p className="small">{activeTab.blurb}</p>
      </div>

      {/* tabs + sort */}
      <div className="row between wrap gap-12">
        <div className="tabs" style={{ border: 0 }}>
          {TABS.map((t) => (
            <button key={t.id} className="tab" data-active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="row gap-8 wrap">
          <span className="upper" style={{ color: "var(--muted-2)" }}>
            Sort by
          </span>
          <select
            className="select"
            style={{ width: 168, minHeight: 32, height: 32, fontSize: 12.5, padding: "0 8px" }}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort agents"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* search + market, second row */}
      <div className="row wrap gap-8">
        <input
          className="input"
          style={{ width: 240, minHeight: 32, height: 32, fontSize: 13 }}
          placeholder="Search agents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search agents"
        />
        <select
          className="select"
          style={{ width: 150, minHeight: 32, height: 32, fontSize: 12.5, padding: "0 8px" }}
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          aria-label="Filter by market"
        >
          <option value="all">All markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="tiny mono">
          {list.length} agent{list.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* table */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Creator</th>
              <th className="right">Fee</th>
              <th className="right">Return</th>
              <th className="right">Max DD</th>
              <th className="right">Covar score</th>
              <th className="right">TVL</th>
              <th className="right">Age (days)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={a.id} onClick={() => (window.location.href = `/agents/${a.id}`)} style={{ cursor: "pointer" }}>
                <td>
                  <div className="row gap-10">
                    <Avatar agent={a} index={i} />
                    <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                      <Link href={`/agents/${a.id}`} className="row gap-6" style={{ color: "var(--foreground)" }}>
                        <span className="table-strong">{a.name}</span>
                        <span className="market-chip">{a.market}</span>
                      </Link>
                      <span className="tiny">
                        {PROVENANCE_LABEL[a.provenance]} · {a.status === "live" ? "operating" : a.status}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="mono tiny">@{creatorOf(a.creatorId)?.handle ?? "you"}</td>
                <td className="right mono tiny">≤20%</td>
                <td className={cx("right num", a.returnPct >= 0 ? "pos" : "neg")}>{pctSigned(a.returnPct)}</td>
                <td className="right num neg">{pct(a.drawdownPct)}</td>
                <td className="right num">{a.score ? a.score.toFixed(2) : "—"}</td>
                <td className="right num">{a.tvlUsd ? usd(a.tvlUsd) : "$0.00"}</td>
                <td className="right num">{a.liveAgeDays || "—"}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 28 }}>
                  <span className="small">No agents in this tab yet.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row gap-8 wrap">
        {(["live", "practice", "testnet", "backtest"] as Provenance[]).map((p) => (
          <ProvenanceBadge key={p} kind={p} />
        ))}
      </div>

      <p className="tiny mono" style={{ maxWidth: 980, lineHeight: 1.8 }}>
        Return is net of fees and costs over the agent&apos;s own record. An agent under 7 days live shows its practice
        figures (marked <em>practice</em>), then its own live run, then its vault&apos;s record once that has 7 days of
        share price. Backtests live in their own tab and never enter the ranking. Past results don&apos;t promise future
        ones.
      </p>
    </div>
  );
}
