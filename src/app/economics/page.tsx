"use client";

import Link from "next/link";
import { useState } from "react";
import { PLATFORM_LIMITS } from "@/lib/strategy";
import { usd } from "@/lib/format";

const PENDING = [
  { name: "Protocol token", status: "Pending decision", detail: "Name, ticker and identifiers are not approved. Nothing is deployed or claimable." },
  { name: "Agent tokens", status: "Pending decision", detail: "Reference describes agent-token relationships; launch mechanics are not implemented in this parity release." },
  { name: "Buyback & burn", status: "Not active", detail: "Treasury page shows fee accounting only. No burn has been executed; no claim of a burn schedule is made here." },
  { name: "Staking", status: "Not active", detail: "No staking contract exists. Any page suggesting staking rewards would be decorative and is deliberately absent." },
];

export default function EconomicsPage() {
  const [deposit, setDeposit] = useState(1000);
  const [winningProfit, setWinningProfit] = useState(250);
  const [feePct, setFeePct] = useState(10);

  const depositFee = deposit * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
  const creatorFee = winningProfit * (feePct / 100);
  const creatorShare = creatorFee * (PLATFORM_LIMITS.creatorSplitPct / 100);
  const platformShare = creatorFee * (PLATFORM_LIMITS.platformSplitPct / 100);

  return (
    <div className="container section-tight stack gap-24">
      <div className="stack gap-8" style={{ maxWidth: 680 }}>
        <span className="eyebrow">Economics</span>
        <h1 className="h2">Fees, splits and what is not live yet</h1>
        <p className="body">
          Reference behaviour is preserved for this parity release: a deposit/withdrawal fee, a creator-selected
          fee on winning-trade profit, and an 80/20 creator/platform split. A high-water-mark change is not approved for
          this release and is tracked in the backlog, not implemented silently.
        </p>
      </div>

      <div className="grid-3">
        <div className="card card-pad stack gap-8">
          <span className="tiny">Deposit / withdrawal fee</span>
          <div className="stat-value">1% + 0.10</div>
          <span className="small">USDG · charged on capital flows, not on profit. Creator&rsquo;s own funds are treated separately in the reference and are flagged as an open parameter.</span>
        </div>
        <div className="card card-pad stack gap-8">
          <span className="tiny">Creator fee ceiling</span>
          <div className="stat-value">20%</div>
          <span className="small">of the profit of each winning trade, creator-selected per agent. Losing trades are not netted against winning-trade fees.</span>
        </div>
        <div className="card card-pad stack gap-8">
          <span className="tiny">Creator / platform split</span>
          <div className="stat-value">80 / 20</div>
          <span className="small">of the realised creator fee, allocated at settlement and recorded per trade.</span>
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad stack gap-16">
          <div className="row between">
            <span className="small strong">Fee calculator</span>
            <span className="badge badge-outline">illustrative · no live billing</span>
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
                  <option key={f} value={f}>{f}%</option>
                ))}
              </select>
            </label>
          </div>

          <div className="panel stack gap-8" style={{ padding: 14 }}>
            <div className="row between">
              <span className="small">Deposit fee charged</span>
              <span className="small strong num">{usd(depositFee)}</span>
            </div>
            <div className="row between">
              <span className="small">Net capital into vault</span>
              <span className="small strong num">{usd(Math.max(0, deposit - depositFee))}</span>
            </div>
            <hr className="divider" />
            <div className="row between">
              <span className="small">Fee on winning profit ({feePct}%)</span>
              <span className="small strong num">{usd(creatorFee)}</span>
            </div>
            <div className="row between">
              <span className="tiny">→ creator ({PLATFORM_LIMITS.creatorSplitPct}%)</span>
              <span className="small num">{usd(creatorShare)}</span>
            </div>
            <div className="row between">
              <span className="tiny">→ platform ({PLATFORM_LIMITS.platformSplitPct}%)</span>
              <span className="small num">{usd(platformShare)}</span>
            </div>
            <div className="row between">
              <span className="small">Trader keeps</span>
              <span className="small strong num pos">{usd(winningProfit - creatorFee)}</span>
            </div>
          </div>

          <span className="tiny">
            Rounding, charging time, exempt cases and recipient addresses must be fixed in an approved parameter table
            before production. These figures are reference observations, not proof of deployed accounting.
          </span>
        </div>

        <div className="stack gap-16 sticky-side">
          <div className="card card-pad stack gap-10">
            <span className="small strong">AI / Copilot costs</span>
            <p className="small">
              Copilot usage incurs provider/model cost plus an application fee. Credits are reserved before a call and
              reconciled to actual usage; unused credits stay a liability of the platform, not revenue.
            </p>
            <div className="row between">
              <span className="tiny">Credits are not a licence to skip risk checks</span>
              <span className="badge badge-outline">enforced</span>
            </div>
          </div>

          <div className="card card-pad stack gap-10">
            <span className="small strong">What is a liability</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {[
                "Investor deposits and trading collateral",
                "Escrowed withdrawal amounts awaiting claim",
                "Unused Copilot credits",
              ].map((t) => (
                <li key={t} className="tiny">{t}</li>
              ))}
            </ul>
            <hr className="divider" />
            <span className="small strong">What is revenue</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {["Deposit/withdrawal fees", "Platform share of creator fees", "Application fee on AI usage"].map((t) => (
                <li key={t} className="tiny">{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="small strong">Token &amp; staking features</span>
          <span className="badge badge-amber">not implemented in this release</span>
        </div>
        <div className="table-wrap">
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
                  <td className="strong">{p.name}</td>
                  <td><span className="badge badge-outline">{p.status}</span></td>
                  <td className="small">{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="notice notice-neutral" style={{ margin: 16 }}>
          <div>
            A decorative page is not a completed settlement system. Nothing on this page mints, burns, stakes or
            distributes value, and the absence of those mechanics is stated rather than illustrated.
          </div>
        </div>
      </div>

      <div className="card card-pad row between wrap gap-16">
        <div className="stack gap-4">
          <span className="small strong">Where the fees go</span>
          <span className="tiny">Treasury shows the accounting split and the pending obligations per period.</span>
        </div>
        <Link href="/treasury" className="btn btn-secondary">Open treasury</Link>
      </div>
    </div>
  );
}
