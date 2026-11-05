"use client";

import Link from "next/link";
import type { Agent } from "@/lib/types";
import { pct, pctSigned, usd } from "@/lib/format";
import { Sparkline } from "./Chart";
import { ProvenanceBadge } from "./ui";

const statusLabel: Record<Agent["status"], string> = {
  draft: "Draft",
  backtesting: "Backtesting",
  practice: "Practice",
  live: "Live",
  paused: "Paused",
  winding_down: "Winding down",
};

export function AgentCard({ agent }: { agent: Agent }) {
  const investable = agent.provenance === "live" && agent.vault && agent.status !== "draft";
  return (
    <Link href={`/agents/${agent.id}`} className="card card-hover card-pad stack gap-16" style={{ display: "flex" }}>
      <div className="row between gap-12">
        <div className="row gap-8">
          <span className="badge badge-outline">{agent.market}</span>
          <span className="badge badge-outline">{agent.timeframe}</span>
          {agent.status === "live" ? (
            <span className="badge badge-green">
              <span className="dot dot-live" /> Live
            </span>
          ) : agent.status === "paused" ? (
            <span className="badge badge-amber">
              <span className="dot dot-warn" /> Paused
            </span>
          ) : (
            <span className="badge">{statusLabel[agent.status]}</span>
          )}
        </div>
        <span className="tiny">{agent.liveAgeDays > 0 ? `${agent.liveAgeDays}d live` : "not live"}</span>
      </div>

      <div className="stack gap-4">
        <h3 className="h4">{agent.name}</h3>
        <p className="small" style={{ minHeight: 38 }}>
          {agent.tagline}
        </p>
      </div>

      <div className="row between gap-12" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="tiny">{agent.provenance === "backtest" ? "Backtest return" : "Return (net of fees)"}</span>
          <span className={`num strong`} style={{ fontSize: 21, color: agent.returnPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
            {pctSigned(agent.returnPct)}
          </span>
        </div>
        <Sparkline data={agent.curve} color={agent.returnPct >= 0 ? "#137A4B" : "#B42318"} />
      </div>

      <div className="row between">
        <div className="stack" style={{ gap: 0 }}>
          <span className="tiny">Max drawdown</span>
          <span className="num small strong neg">{pct(agent.drawdownPct)}</span>
        </div>
        <div className="stack" style={{ gap: 0 }}>
          <span className="tiny">TVL</span>
          <span className="num small strong">{agent.tvlUsd ? usd(agent.tvlUsd, { compact: true }) : "—"}</span>
        </div>
        <div className="stack" style={{ gap: 0 }}>
          <span className="tiny">Score</span>
          <span className="num small strong">{agent.score || "—"}</span>
        </div>
      </div>

      <hr className="divider" />
      <div className="row between gap-8">
        <ProvenanceBadge kind={agent.provenance} />
        <span className="tiny">{investable ? "Vault open" : agent.provenance === "practice" ? "Practice only" : "Not investable"}</span>
      </div>
    </Link>
  );
}
