"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCovar } from "@/lib/store";
import { cx, dateOnly, pct, pctSigned, usd } from "@/lib/format";
import { Empty, ProvenanceBadge } from "@/components/ui";
import { Sparkline } from "@/components/Chart";

export default function CreatorPage() {
  const params = useParams<{ id: string }>();
  const { creators, agents } = useCovar();
  const creator = creators.find((c) => c.id === params.id);

  if (!creator) {
    return (
      <div className="container section">
        <Empty
          title="Creator not found"
          body="No creator with this id in the current session."
          action={<Link href="/explore" className="btn btn-primary">Back to Discover</Link>}
        />
      </div>
    );
  }

  const own = agents.filter((a) => a.creatorId === creator.id);
  const live = own.filter((a) => a.provenance === "live");
  const totalTvl = own.reduce((a, b) => a + (b.vault?.tvlUsd ?? 0), 0);
  const failed = own.filter((a) => a.returnPct < 0 || a.status === "paused");

  return (
    <div className="container section-tight stack gap-24">
      <div className="row gap-8 tiny">
        <Link href="/explore" className="link-primary">Discover</Link>
        <span>/</span>
        <span>@{creator.handle}</span>
      </div>

      <div className="card card-pad row between wrap gap-20">
        <div className="row gap-16">
          <span className="avatar" style={{ width: 54, height: 54, fontSize: 18, borderRadius: 14 }}>
            {creator.handle.slice(0, 2).toUpperCase()}
          </span>
          <div className="stack gap-4">
            <div className="row gap-8">
              <h1 className="h2" style={{ fontSize: 28 }}>{creator.name}</h1>
              {creator.verified && <span className="badge badge-blue">Verified identity</span>}
            </div>
            <span className="small muted">@{creator.handle} · joined {dateOnly(creator.joined)} · {creator.followers} followers</span>
            <p className="body" style={{ maxWidth: 560 }}>{creator.bio}</p>
          </div>
        </div>
        <div className="row gap-24 wrap">
          <div className="stack">
            <span className="tiny">Agents</span>
            <span className="stat-value stat-value-sm">{own.length}</span>
          </div>
          <div className="stack">
            <span className="tiny">Vault TVL</span>
            <span className="stat-value stat-value-sm">{totalTvl ? usd(totalTvl, { compact: true }) : "—"}</span>
          </div>
          <div className="stack">
            <span className="tiny">Unsuccessful records kept public</span>
            <span className="stat-value stat-value-sm">{failed.length}</span>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="small strong">Agent history</span>
          <span className="tiny">includes paused and negative agents — history is never filtered to winners</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Record</th>
                <th className="right">Return</th>
                <th className="right">Max DD</th>
                <th className="right">TVL</th>
                <th className="right">Age</th>
                <th>Curve</th>
              </tr>
            </thead>
            <tbody>
              {own.map((a) => (
                <tr key={a.id} className="row-click">
                  <td>
                    <Link href={`/agents/${a.id}`} className="strong">{a.name}</Link>
                    <div className="tiny">v{a.version} · {a.market}</div>
                  </td>
                  <td>
                    <span className={cx("badge", a.status === "live" ? "badge-green" : a.status === "paused" ? "badge-amber" : "badge-outline")}>
                      {a.status}
                    </span>
                  </td>
                  <td><ProvenanceBadge kind={a.provenance} /></td>
                  <td className={cx("right num strong", a.returnPct >= 0 ? "pos" : "neg")}>{pctSigned(a.returnPct)}</td>
                  <td className="right num neg">{pct(a.drawdownPct)}</td>
                  <td className="right num">{a.tvlUsd ? usd(a.tvlUsd, { compact: true }) : "—"}</td>
                  <td className="right num">{a.liveAgeDays ? `${a.liveAgeDays}d` : "—"}</td>
                  <td>
                    <Sparkline data={a.curve} color={a.returnPct >= 0 ? "#137A4B" : "#B42318"} width={80} height={24} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad stack gap-12">
          <span className="small strong">Version changes across this creator&rsquo;s agents</span>
          <div className="timeline">
            {own.flatMap((a) =>
              a.versions.map((v) => (
                <div key={`${a.id}-${v.version}`} className="timeline-item">
                  <span className="timeline-dot" />
                  <div className="stack grow" style={{ gap: 2 }}>
                    <div className="row between gap-8">
                      <span className="small strong">
                        {a.name} · v{v.version}
                      </span>
                      <span className="tiny">{dateOnly(v.ts)}</span>
                    </div>
                    <span className="tiny">{v.summary}</span>
                  </div>
                </div>
              ))
            ).slice(0, 8)}
          </div>
        </div>

        <div className="card card-pad stack gap-12">
          <span className="small strong">Provenance discipline</span>
          <p className="small">
            A creator page mixes record types only if each row is labelled. Live results here come from reconciled fills;
            backtest figures belong to agents that were never live and are excluded from ranking and investment.
          </p>
          <hr className="divider" />
          <div className="stack gap-6">
            {[
              ["Live agents", `${live.length}`],
              ["Paused / close-only", `${own.filter((a) => a.status === "paused").length}`],
              ["Negative since launch", `${own.filter((a) => a.returnPct < 0).length}`],
            ].map(([k, v]) => (
              <div key={k} className="row between">
                <span className="tiny">{k}</span>
                <span className="small strong num">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
