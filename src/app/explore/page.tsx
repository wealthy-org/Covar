"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCovar } from "@/lib/store";
import { TokenLogo } from "@/components/ui";
import { Sparkline } from "@/components/Chart";
import { cx, pctSigned, usd } from "@/lib/format";
import type { Agent } from "@/lib/types";
import { VAULT_AGENT_ID } from "@/lib/vaultAgent";
import { SHOW_EXAMPLES } from "@/lib/chain";

/**
 * Discover — one institutional-terminal table for every agent, four views:
 *   ALL · LIVE VAULTS · AGENT ARENA · BACKTESTS, plus a Market filter and Sort by.
 *
 * Ranking rule: records of different provenance are never ranked
 * against each other. The All view therefore keeps three groups in a fixed order
 * (live vaults → agent arena → backtests); Sort by only reorders rows inside a
 * group. The deployed vault (chain data, package 3.6) is always pinned first and
 * carries the bright-green on-chain badge in the Provenance column.
 */
type Tab = "all" | "vaults" | "arena" | "backtests";
type GroupId = Exclude<Tab, "all">;

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "vaults", label: "Live vaults" },
  { id: "arena", label: "Agent arena" },
  { id: "backtests", label: "Backtests" },
];

const SORTS = [
  { id: "score", label: "Score" },
  { id: "return", label: "Return" },
  { id: "tvl", label: "TVL" },
  { id: "age", label: "Age" },
  { id: "drawdown", label: "Smallest drop" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const sorter = (sort: SortId) => (a: Agent, b: Agent) => {
  switch (sort) {
    case "return":
      return b.returnPct - a.returnPct;
    case "tvl":
      return (b.tvlUsd || 0) - (a.tvlUsd || 0) || b.score - a.score;
    case "drawdown":
      return b.drawdownPct - a.drawdownPct;
    case "age":
      return ageOf(b) - ageOf(a);
    default:
      return b.score - a.score;
  }
};

// backtests have no live age; their replayed span (one curve point per day) stands in
const ageOf = (a: Agent) => a.liveAgeDays || (a.provenance === "backtest" ? a.curve.length : 0);

const GROUPS: Record<GroupId, { title: string; note: string }> = {
  vaults: {
    title: "Live vaults · real money",
    note: SHOW_EXAMPLES
      ? "Open vaults with a real-money record. The deployed vault is pinned first; other rows are examples."
      : "Open vaults on Robinhood Chain. Every figure is read from the vault contract.",
  },
  arena: {
    title: "Agent arena · practice money",
    note: "Still proving themselves. Ranked only against each other. Nothing here takes deposits.",
  },
  backtests: {
    title: "Backtests · not ranked against real records",
    note: "Reproducible history replays. Not investable and never compared with live results.",
  },
};

const SUBTITLE: Record<Tab, string> = {
  all: "Every agent on Covar in one table, grouped by where its record comes from. Groups are never ranked against each other.",
  vaults: "Agents with a real-money record and an open vault.",
  arena: "Agents still proving themselves with practice money. Nothing here takes deposits.",
  backtests: "History replays of strategies. Useful to judge an idea, never a substitute for a live record.",
};

type Prov = { key: string; label: string; cls: string; tip: string };
function provenanceOf(a: Agent): Prov {
  if (a.id === VAULT_AGENT_ID)
    return { key: "onchain", label: "on-chain", cls: "pill pill-onchain", tip: "Every figure in this row is read from the deployed vault's chain logs" };
  switch (a.provenance) {
    case "live":
    case "vault":
      return { key: "live", label: "live", cls: "pill pill-ink", tip: SHOW_EXAMPLES ? "Real-money record (example row)" : "Real-money record from the agent's own trading" };
    case "testnet":
      return { key: "testnet", label: "testnet", cls: "pill pill-amber", tip: "Traded on a test exchange with test funds — no real value" };
    case "practice":
      return { key: "practice", label: "practice", cls: "pill pill-accent", tip: "Live prices, pretend money. Not a real-money record" };
    default:
      return { key: "backtest", label: "backtest", cls: "pill pill-backtest", tip: "History replay. Not investable, never ranked against real records" };
  }
}

const groupOf = (a: Agent): GroupId | null => {
  if (a.id === VAULT_AGENT_ID) return "vaults";
  if (a.provenance === "live" && !!a.vault) return "vaults";
  if (a.provenance === "practice" || a.provenance === "testnet") return "arena";
  if (a.provenance === "backtest") return "backtests";
  return null;
};

const COLS = 9;

export default function ExplorePage() {
  const router = useRouter();
  const { agents, creators } = useCovar();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<SortId>("score");
  const [market, setMarket] = useState<string>("all");

  const markets = useMemo(() => {
    const order = ["BTC-PERP", "ETH-PERP"];
    const all = Array.from(new Set(agents.filter((a) => groupOf(a)).map((a) => a.market)));
    return all.sort((x, y) => {
      const ix = order.indexOf(x), iy = order.indexOf(y);
      if (ix !== -1 || iy !== -1) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
      return x.localeCompare(y);
    });
  }, [agents]);

  // rows per group: market filter first, then the sort inside the group; the deployed vault stays pinned
  const groups = useMemo(() => {
    const inMarket = agents.filter((a) => market === "all" || a.market === market);
    const pick = (g: GroupId) => inMarket.filter((a) => groupOf(a) === g);
    const vaults = pick("vaults");
    return {
      vaults: [...vaults.filter((a) => a.id === VAULT_AGENT_ID), ...vaults.filter((a) => a.id !== VAULT_AGENT_ID).sort(sorter(sort))],
      // pretend-money rows have no TVL; TVL falls back to return so the order still means something
      arena: pick("arena").sort(sorter(sort === "tvl" ? "return" : sort)),
      backtests: pick("backtests").sort(sorter(sort === "tvl" ? "return" : sort)),
    } satisfies Record<GroupId, Agent[]>;
  }, [agents, market, sort]);

  const counts: Record<Tab, number> = {
    all: groups.vaults.length + groups.arena.length + groups.backtests.length,
    vaults: groups.vaults.length,
    arena: groups.arena.length,
    backtests: groups.backtests.length,
  };
  const shown: GroupId[] = tab === "all" ? ["vaults", "arena", "backtests"] : [tab];
  const creatorOf = (id: string) => creators.find((c) => c.id === id);

  const renderRow = (a: Agent) => {
    const prov = provenanceOf(a);
    const up = a.returnPct >= 0;
    const isVault = a.id === VAULT_AGENT_ID;
    const days = ageOf(a);
    return (
      <tr key={a.id} className="row-click" data-testid="discover-row" data-provenance={prov.key} onClick={() => router.push(`/agents/${a.id}`)}>
        <td>
          <div className="row gap-10" style={{ flexWrap: "nowrap" }}>
            <TokenLogo market={a.market} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="row gap-8" style={{ flexWrap: "nowrap" }}>
                <Link href={`/agents/${a.id}`} className="table-strong" style={{ color: "var(--ink)", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {a.name}
                </Link>
                <span className="tagbox hide-xs">{a.market}</span>
              </span>
              <span className="tiny mono">
                {a.timeframe && a.timeframe !== "—" ? `${a.timeframe} · ` : ""}
                {a.status === "live" ? "operating" : a.status.replace("_", " ")}
              </span>
            </div>
          </div>
        </td>
        <td>
          <span className={cx(prov.cls, "prov-tip")} data-tip={prov.tip} aria-label={`${prov.label}: ${prov.tip}`} data-testid={isVault ? "onchain-vault-tag" : "provenance-badge"}>
            {prov.key === "onchain" && <span className="pill-dot" aria-hidden />}
            {prov.label}
          </span>
        </td>
        <td className="mono tiny hide-sm">@{creatorOf(a.creatorId)?.handle ?? "you"}</td>
        <td className="hide-md" style={{ width: 96 }}>
          {a.curve.length > 1 ? <Sparkline data={a.curve} width={88} height={26} color={up ? "#137A4B" : "#B42318"} /> : <span className="tiny">—</span>}
        </td>
        <td className={cx("right", up ? "pos" : "neg")}>{pctSigned(a.returnPct)}</td>
        <td className="right hide-md">{a.score ? a.score.toFixed(2) : "—"}</td>
        <td className="right">{a.tvlUsd ? usd(a.tvlUsd, { compact: true }) : "—"}</td>
        <td className="right hide-sm">{days ? `${days}d` : "—"}</td>
        <td className="right hide-sm">{isVault || groupOf(a) !== "vaults" ? "—" : "≤20%"}</td>
      </tr>
    );
  };

  return (
    <div className="wrap-md page-pad">
      <div className="page-head">
        <h1 className="page-title">Discover</h1>
        <p className="page-sub">{SUBTITLE[tab]}</p>
      </div>

      <div className="row between gap-12 wrap" style={{ borderBottom: "1px solid var(--border)", marginBottom: 22 }}>
        <div className="utabs" role="tablist" style={{ borderBottom: 0 }}>
          {TABS.map(({ id, label }) => (
            <button key={id} role="tab" aria-selected={tab === id} className="utab" data-active={tab === id} data-testid={`tab-${id}`} onClick={() => setTab(id)}>
              {label}
              <span className="utab-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="row gap-16 wrap" style={{ paddingBottom: 8 }}>
          <label className="row gap-8">
            <span className="stat-label">Market</span>
            <select className="select select-sm" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Filter by market" data-testid="filter-market">
              <option value="all">All markets</option>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="row gap-8">
            <span className="stat-label">Sort by</span>
            <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="Sort agents" data-testid="filter-sort">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div key={tab} className="fx-in stack gap-24">
        <div className="table-wrap">
          <table className="table table-rows discover-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Provenance</th>
                <th className="hide-sm">Creator</th>
                <th className="hide-md">Record</th>
                <th className="right">Return</th>
                <th className="right hide-md">Score</th>
                <th className="right">TVL</th>
                <th className="right hide-sm">Age</th>
                <th className="right hide-sm">Fee</th>
              </tr>
            </thead>
            {shown.map((g) => (
              <tbody key={g} data-testid={`group-${g}`}>
                {tab === "all" && (
                  <tr className="group-row">
                    <td colSpan={COLS}>
                      <span className="label-dot">{GROUPS[g].title}</span>
                      <span className="mono-note group-note">{GROUPS[g].note}</span>
                    </td>
                  </tr>
                )}
                {groups[g].map(renderRow)}
                {groups[g].length === 0 && (
                  <tr>
                    <td colSpan={COLS} style={{ textAlign: "center", padding: 28 }}>
                      <span className="small">
                        {market === "all" ? (
                          g === "vaults" ? (
                            "No open vaults yet."
                          ) : (
                            <>
                              Nothing here yet.{" "}
                              <Link href="/studio?new=1" className="link-primary">
                                Build an agent →
                              </Link>
                            </>
                          )
                        ) : `No ${g === "vaults" ? "live vaults" : g === "arena" ? "arena agents" : "backtests"} on ${market}.`}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>

        {tab !== "all" && <p className="mono-note" style={{ margin: 0, maxWidth: 980 }}>{GROUPS[tab].note}</p>}
        <p className="mono-note" style={{ margin: 0, maxWidth: 980 }}>
          Return is net of fees and costs over the agent&apos;s own record. An agent under 7 days live shows its practice figures
          (marked practice), then its own live run, then its vault&apos;s record once that has 7 days of share price. Backtests
          never enter the ranking. Past results don&apos;t promise future ones.
        </p>

        {(tab === "arena" || tab === "backtests") && (
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
        )}
      </div>
    </div>
  );
}
