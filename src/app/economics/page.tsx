"use client";

import Link from "next/link";
import { useState } from "react";
import { PLATFORM_LIMITS } from "@/lib/strategy";
import { usd } from "@/lib/format";
import { FeeSankey } from "@/components/FeeSankey";

const PENDING = [
  { name: "Protocol token", status: "Pending decision", detail: "Name, ticker and identifiers are not approved. Nothing is deployed or claimable." },
  { name: "Agent tokens", status: "Pending decision", detail: "Reference describes agent-token relationships; launch mechanics are not implemented in this parity release." },
  { name: "Buyback & burn", status: "Not active", detail: "Treasury page shows fee accounting only. No burn has been executed; no claim of a burn schedule is made here." },
  { name: "Staking", status: "Not active", detail: "No staking contract exists. The stake panel above is disabled and earns nothing." },
];

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

export default function EconomicsPage() {
  const [deposit, setDeposit] = useState(1000);
  const [winningProfit, setWinningProfit] = useState(250);
  const [feePct, setFeePct] = useState(10);

  const depositFee = deposit * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
  const creatorFee = winningProfit * (feePct / 100);
  const creatorShare = creatorFee * (PLATFORM_LIMITS.creatorSplitPct / 100);
  const platformShare = creatorFee * (PLATFORM_LIMITS.platformSplitPct / 100);

  return (
    <div className="wrap-sm page-pad stack gap-24">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <span className="label-dot">Economics</span>
        <h1 className="page-title-xl">
          Where every fee <span style={{ color: "var(--primary)" }}>goes.</span>
        </h1>
        <p className="page-sub">
          A deposit/withdrawal fee, a creator-selected fee on winning-trade profit, and an 80/20 creator/platform split —
          reference behaviour, preserved. A high-water-mark change is tracked in the backlog, not implemented silently.
        </p>
        <Link href="/treasury" className="accent-link" style={{ marginTop: 6 }}>
          See the accounting: Treasury →
        </Link>
      </div>

      <div className="econ-grid">
        <section className="rcard rcard-pad stack gap-16">
          <div className="row between gap-12 wrap">
            <h2 className="rcard-title">Fee flows</h2>
            <span className="tagbox">band width = rule share · no live volume</span>
          </div>
          <FeeSankey />
        </section>

        <section className="rcard rcard-pad stack gap-14">
          <div className="row between gap-8">
            <h2 className="rcard-title">Stake</h2>
            <span className="tagbox tagbox-accent">Coming soon</span>
          </div>
          <span className="small">
            No staking contract exists and no token is approved. This panel is a placeholder for the reference layout — it
            cannot take or earn anything.
          </span>
          <label className="field">
            <span className="stat-label">Amount</span>
            <input className="input" placeholder="0.00" disabled aria-label="Stake amount (disabled)" />
          </label>
          <div>
            <KV k="Your stake" v="—" />
            <KV k="Share of treasury" v="—" />
            <KV k="Rewards" v="none" />
          </div>
          <button className="btn-ink" disabled style={{ height: 40 }}>
            Stake — not available
          </button>
        </section>
      </div>

      <div className="joined-stats" data-cols="3">
        <div>
          <span className="stat-label">Deposit / withdrawal fee</span>
          <span className="js-v">1% + 0.10</span>
          <span className="tiny">USDG · on capital flows, not on profit. Creator&rsquo;s own funds are an open parameter.</span>
        </div>
        <div>
          <span className="stat-label">Creator fee ceiling</span>
          <span className="js-v">20%</span>
          <span className="tiny">of each winning trade, creator-selected per agent. Losing trades are not netted.</span>
        </div>
        <div>
          <span className="stat-label">Creator / platform split</span>
          <span className="js-v">80 / 20</span>
          <span className="tiny">of the realised creator fee, allocated at settlement and recorded per trade.</span>
        </div>
      </div>

      <div className="econ-grid">
        <section className="rcard rcard-pad stack gap-16">
          <div className="row between gap-8 wrap">
            <h2 className="rcard-title">Fee calculator</h2>
            <span className="tagbox">illustrative · no live billing</span>
          </div>

          <div className="grid-3" style={{ gap: 12 }}>
            <label className="field">
              <span className="label">Deposit (USDG)</span>
              <input className="input" type="number" value={deposit} min={0} onChange={(e) => setDeposit(Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="label">Winning-trade profit</span>
              <input className="input" type="number" value={winningProfit} min={0} onChange={(e) => setWinningProfit(Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="label">Creator fee</span>
              <select className="select" value={feePct} onChange={(e) => setFeePct(Number(e.target.value))}>
                {[0, 5, 10, 15, 20].map((f) => (
                  <option key={f} value={f}>
                    {f}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <KV k="Deposit fee charged" v={usd(depositFee)} />
            <KV k="Net capital into vault" v={usd(Math.max(0, deposit - depositFee))} />
            <KV k={`Fee on winning profit (${feePct}%)`} v={usd(creatorFee)} />
            <KV k={`→ creator (${PLATFORM_LIMITS.creatorSplitPct}%)`} v={usd(creatorShare)} />
            <KV k={`→ platform (${PLATFORM_LIMITS.platformSplitPct}%)`} v={usd(platformShare)} />
            <KV k="Trader keeps" v={usd(winningProfit - creatorFee)} tone="var(--positive)" />
          </div>

          <span className="mono-note">
            Rounding, charging time, exempt cases and recipient addresses must be fixed in an approved parameter table before
            production. These figures are reference observations, not proof of deployed accounting.
          </span>
        </section>

        <div className="stack gap-16">
          <section className="rcard rcard-pad stack gap-10">
            <h2 className="rcard-title">AI / Copilot costs</h2>
            <p className="small" style={{ margin: 0 }}>
              Copilot usage incurs provider/model cost plus an application fee. Credits are reserved before a call and
              reconciled to actual usage; unused credits stay a liability of the platform, not revenue.
            </p>
            <div className="row between gap-8">
              <span className="tiny">Credits are not a licence to skip risk checks</span>
              <span className="pill pill-green">enforced</span>
            </div>
          </section>

          <section className="rcard rcard-pad stack gap-10">
            <span className="label-dot">What is a liability</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {["Investor deposits and trading collateral", "Escrowed withdrawal amounts awaiting claim", "Unused Copilot credits"].map((t) => (
                <li key={t} className="small">
                  {t}
                </li>
              ))}
            </ul>
            <div className="rcard-sep" style={{ margin: "6px 0" }} />
            <span className="label-dot">What is revenue</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {["Deposit/withdrawal fees", "Platform share of creator fees", "Application fee on AI usage"].map((t) => (
                <li key={t} className="small">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="rcard">
        <div className="rcard-head" style={{ paddingBottom: 14 }}>
          <h2 className="rcard-title">Token &amp; staking features</h2>
          <span className="pill pill-amber">not implemented in this release</span>
        </div>
        <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Status</th>
                <th>What that means</th>
              </tr>
            </thead>
            <tbody>
              {PENDING.map((p) => (
                <tr key={p.name}>
                  <td className="strong nowrap" style={{ color: "var(--ink)" }}>
                    {p.name}
                  </td>
                  <td>
                    <span className="pill">{p.status}</span>
                  </td>
                  <td className="small" style={{ minWidth: 260 }}>
                    {p.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mono-note" style={{ maxWidth: 860 }}>
        A diagram is not a completed settlement system. Nothing on this page mints, burns, stakes or distributes value; the
        stake panel is disabled and says so, and the fee flows show rules, not volumes.
      </p>
    </div>
  );
}
