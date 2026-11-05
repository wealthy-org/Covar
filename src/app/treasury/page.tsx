"use client";

import Link from "next/link";
import { useState } from "react";
import { usd, pct } from "@/lib/format";
import { cx } from "@/lib/format";

const PERIODS = [
  {
    id: "oct-w4",
    label: "26 Oct – 1 Nov 2026",
    depositFees: 412.8,
    creatorFeesGross: 1_284.5,
    platformShare: 256.9,
    aiAppFees: 88.4,
    providerCost: 51.2,
    creatorPayouts: 1_027.6,
    obligations: 731.4,
    burns: 0,
  },
  {
    id: "oct-w3",
    label: "19 – 25 Oct 2026",
    depositFees: 388.1,
    creatorFeesGross: 1_142.0,
    platformShare: 228.4,
    aiAppFees: 79.6,
    providerCost: 46.8,
    creatorPayouts: 913.6,
    obligations: 690.2,
    burns: 0,
  },
  {
    id: "oct-w2",
    label: "12 – 18 Oct 2026",
    depositFees: 301.5,
    creatorFeesGross: 964.2,
    platformShare: 192.8,
    aiAppFees: 61.1,
    providerCost: 37.4,
    creatorPayouts: 771.4,
    obligations: 584.7,
    burns: 0,
  },
];

export default function TreasuryPage() {
  const [period, setPeriod] = useState(PERIODS[0]);
  const grossReceipts = period.depositFees + period.platformShare + period.aiAppFees;
  const distributable = grossReceipts - period.providerCost - period.creatorPayouts;

  const rows: [string, number, string][] = [
    ["Deposit / withdrawal fees", period.depositFees, "Capital-flow fee, charged on the transfer"],
    ["Platform share of creator fees (20%)", period.platformShare, "Allocated per winning trade"],
    ["AI application fee", period.aiAppFees, "Gross application fee on Copilot usage"],
    ["Provider / model cost", -period.providerCost, "Orbio & model invoices — a cost, not a distribution"],
    ["Creator payouts", -period.creatorPayouts, "80% share paid to creators"],
  ];

  return (
    <div className="container section-tight stack gap-24">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 640 }}>
          <span className="eyebrow">Treasury</span>
          <h1 className="h2">Fee accounting, not a promise of yield</h1>
          <p className="body">
            Gross receipts, provider costs, creator payouts, platform share and outstanding obligations are separated.
            Deposits, trading collateral, escrowed withdrawals and unused credits are liabilities — they never appear as
            revenue.
          </p>
        </div>
        <div className="row gap-6 wrap">
          {PERIODS.map((p) => (
            <button key={p.id} className="chip" data-active={period.id === p.id} onClick={() => setPeriod(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-4">
        <div className="card card-pad">
          <span className="tiny">Gross receipts</span>
          <div className="stat-value">{usd(grossReceipts)}</div>
          <span className="tiny">fees only — excludes all capital flows</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Provider costs</span>
          <div className="stat-value neg">{usd(period.providerCost)}</div>
          <span className="tiny">AI + data provider invoices</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Distributable</span>
          <div className="stat-value">{usd(distributable)}</div>
          <span className="tiny">after creator payouts and provider costs</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Outstanding obligations</span>
          <div className="stat-value">{usd(period.obligations)}</div>
          <span className="tiny">escrowed withdrawals + unused credits</span>
        </div>
      </div>

      <div className="two-col">
        <div className="card stack">
          <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <span className="small strong">Accounting split · {period.label}</span>
            <span className="badge badge-outline">testnet data</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Basis</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, amount, basis]) => (
                  <tr key={label}>
                    <td className="strong">{label}</td>
                    <td className="tiny">{basis}</td>
                    <td className={cx("right num strong", amount < 0 ? "neg" : "")}>
                      {amount < 0 ? "−" : ""}{usd(Math.abs(amount))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="strong">Distributable this period</td>
                  <td className="tiny">gross − provider costs − creator payouts</td>
                  <td className="right num strong primary-text">{usd(distributable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack gap-16 sticky-side">
          <div className="card card-pad stack gap-10">
            <div className="row between">
              <span className="small strong">Buyback / burn</span>
              <span className="badge badge-amber">not active</span>
            </div>
            <div className="stat-value">{usd(period.burns, { max: 0 })}</div>
            <span className="tiny">
              No burn has been executed and no protocol token exists yet. The line is displayed at zero rather than
              illustrated with a plausible number. Any future burn will publish transaction hashes here.
            </span>
          </div>

          <div className="card card-pad stack gap-10">
            <span className="small strong">Creator allocation</span>
            <div className="row between">
              <span className="tiny">Gross creator fees</span>
              <span className="small strong num">{usd(period.creatorFeesGross)}</span>
            </div>
            <div className="row between">
              <span className="tiny">Paid to creators (80%)</span>
              <span className="small strong num">{usd(period.creatorPayouts)}</span>
            </div>
            <div className="row between">
              <span className="tiny">Platform share (20%)</span>
              <span className="small strong num">{usd(period.platformShare)}</span>
            </div>
            <hr className="divider" />
            <span className="tiny">
              Split ratio: {pct(80, 0)} / {pct(20, 0)}. Charged on winning-trade profit only; losses are never netted
              against it.
            </span>
          </div>

          <div className="card card-pad stack gap-8">
            <span className="small strong">Authority</span>
            <span className="tiny">
              Single wallet admin (no multisig) — an accepted, documented risk. Treasury and fee-recipient changes are
              executable by that one key; there is no threshold approval delay. Compromise of the key compromises every
              contract it controls.
            </span>
            <Link href="/docs#custody" className="link-primary small">Read the custody documentation →</Link>
          </div>
        </div>
      </div>

      <div className="notice notice-warn">
        <div>
          <strong>Reconciliation status.</strong> Figures shown are the session&rsquo;s accounting model on testnet data. No
          mainnet deployment exists; no buyback, burn or distribution has occurred. A decorative treasury page would be
          worse than an honest empty one.
        </div>
      </div>
    </div>
  );
}
