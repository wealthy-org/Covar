"use client";

import Link from "next/link";
import { useState } from "react";
import { VAULT_ADDRESS, explorerAddress } from "@/lib/chain";
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
  // Creator payouts come out of the gross creator fee (leaving the 20% platform share),
  // not out of platform receipts — so they are netted against that line only.
  const distributable = grossReceipts - period.providerCost;

  const rows: [string, number, string][] = [
    ["Deposit / withdrawal fees", period.depositFees, "Capital-flow fee, charged on the transfer"],
    ["Creator fees (gross)", period.creatorFeesGross, "Fee on winning-trade profit, before the split"],
    ["Creator payouts (80%)", -period.creatorPayouts, "Paid to creators out of the gross creator fee"],
    ["AI application fee", period.aiAppFees, "Gross application fee on Copilot usage"],
    ["Provider / model cost", -period.providerCost, "Orbio & model invoices — a cost, not a distribution"],
  ];

  const split = [
    { label: "Deposit / withdrawal fees", v: period.depositFees, c: "#3B5BDB" },
    { label: "Platform share of creator fees", v: period.platformShare, c: "#8EA2EE" },
    { label: "AI application fee", v: period.aiAppFees, c: "#10141F" },
  ];

  return (
    <div className="wrap-sm page-pad stack gap-24">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="row gap-10">
          <span className="label-dot">Treasury</span>
          <span className="tagbox">illustrative</span>
        </div>
        <h1 className="page-title-xl">
          Every fee, <span style={{ color: "var(--primary)" }}>accounted.</span>
        </h1>
        <p className="page-sub">
          Gross receipts, provider costs, creator payouts, platform share and outstanding obligations are separated. Deposits,
          trading collateral, escrowed withdrawals and unused credits are liabilities — they never appear as revenue.
        </p>
      </div>

      <div className="seg" role="tablist" aria-label="Accounting period">
        {PERIODS.map((p) => (
          <button key={p.id} role="tab" aria-selected={period.id === p.id} data-active={period.id === p.id} onClick={() => setPeriod(p)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="joined-stats" style={{ ["--cols" as string]: 4 }}>
        <div>
          <span className="stat-label">Gross receipts</span>
          <span className="js-v">{usd(grossReceipts)}</span>
          <span className="tiny">fees only — excludes all capital flows</span>
        </div>
        <div>
          <span className="stat-label">Provider costs</span>
          <span className="js-v neg">{usd(period.providerCost)}</span>
          <span className="tiny">AI + data provider invoices</span>
        </div>
        <div>
          <span className="stat-label">Distributable</span>
          <span className="js-v">{usd(distributable)}</span>
          <span className="tiny">platform receipts after provider costs</span>
        </div>
        <div>
          <span className="stat-label">Outstanding obligations</span>
          <span className="js-v">{usd(period.obligations)}</span>
          <span className="tiny">escrowed withdrawals + unused credits</span>
        </div>
      </div>

      <div className="detail-two">
        <section className="rcard rcard-pad stack gap-14">
          <h2 className="rcard-title">How revenue splits</h2>
          <div className="split-bar" aria-label="Gross receipts by source">
            {split.map((x) => (
              <span key={x.label} style={{ width: `${(x.v / grossReceipts) * 100}%`, background: x.c }} title={`${x.label} ${usd(x.v)}`} />
            ))}
          </div>
          <div>
            {split.map((x) => (
              <div key={x.label} className="kv">
                <span className="kv-k row gap-8">
                  <i style={{ width: 8, height: 8, borderRadius: 2, background: x.c, display: "inline-block" }} />
                  {x.label}
                </span>
                <span className="kv-v">
                  {usd(x.v)} · {pct((x.v / grossReceipts) * 100, 0)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rcard rcard-pad stack gap-12">
          <div className="row between gap-8">
            <h2 className="rcard-title">Buyback &amp; burn</h2>
            <span className="pill pill-amber">not active</span>
          </div>
          <span className="mono-num" style={{ fontSize: 28, color: "var(--ink)" }}>
            {usd(period.burns, { max: 0 })}
          </span>
          <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
            <li className="small">No burn has been executed and no protocol token exists yet.</li>
            <li className="small">The line is displayed at zero rather than illustrated with a plausible number.</li>
            <li className="small">Any future burn will publish transaction hashes here.</li>
          </ul>
        </section>
      </div>

      <section className="rcard">
        <div className="rcard-head" style={{ paddingBottom: 14 }}>
          <h2 className="rcard-title">Revenue in · {period.label}</h2>
          <span className="tagbox">illustrative accounting model</span>
        </div>
        <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Line</th>
                <th className="hide-sm">Basis</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, amount, basis]) => (
                <tr key={label}>
                  <td className="strong" style={{ color: "var(--ink)" }}>
                    {label}
                  </td>
                  <td className="tiny hide-sm">{basis}</td>
                  <td className={cx("right", amount < 0 ? "neg" : "")}>
                    {amount < 0 ? "−" : ""}
                    {usd(Math.abs(amount))}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="strong" style={{ color: "var(--ink)" }}>
                  Distributable this period
                </td>
                <td className="tiny hide-sm">sum of the lines above</td>
                <td className="right primary-text">{usd(distributable)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="detail-two">
        <section className="rcard rcard-pad stack gap-10">
          <h2 className="rcard-title">Creator allocation</h2>
          <div>
            <div className="kv">
              <span className="kv-k">Gross creator fees</span>
              <span className="kv-v">{usd(period.creatorFeesGross)}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Paid to creators (80%)</span>
              <span className="kv-v">{usd(period.creatorPayouts)}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Platform share (20%)</span>
              <span className="kv-v">{usd(period.platformShare)}</span>
            </div>
          </div>
          <span className="mono-note">
            Split ratio: {pct(80, 0)} / {pct(20, 0)}. Charged on winning-trade profit only; losses are never netted against it.
          </span>
        </section>

        <section className="rcard rcard-pad stack gap-10">
          <h2 className="rcard-title">Check it yourself</h2>
          <div>
            <div className="kv">
              <span className="kv-k">Vault contract</span>
              <span className="kv-v">{VAULT_ADDRESS || "not deployed"}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Network</span>
              <span className="kv-v">Robinhood Chain testnet · 46630</span>
            </div>
            <div className="kv">
              <span className="kv-k">Admin</span>
              <span className="kv-v">single wallet · no multisig</span>
            </div>
          </div>
          <span className="tiny">
            Single wallet admin (no multisig) — an accepted, documented risk. Treasury and fee-recipient changes are executable
            by that one key; there is no threshold approval delay. Compromise of the key compromises every contract it controls.
          </span>
          <div className="row gap-12 wrap">
            {VAULT_ADDRESS && (
              <a className="accent-link" href={explorerAddress(VAULT_ADDRESS)} target="_blank" rel="noreferrer noopener">
                View on explorer ↗
              </a>
            )}
            <Link href="/chain" className="accent-link">
              Chain status →
            </Link>
            <Link href="/docs#custody" className="accent-link">
              Custody docs →
            </Link>
          </div>
        </section>
      </div>

      <p className="mono-note" style={{ maxWidth: 900 }}>
        Reconciliation status: figures shown are an illustrative accounting model, not recorded receipts. No vault is deployed
        on Robinhood Chain and no mainnet deployment exists; no buyback, burn or distribution has occurred. A decorative
        treasury page would be worse than an honest empty one.
      </p>
    </div>
  );
}
