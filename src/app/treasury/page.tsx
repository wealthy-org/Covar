"use client";

import Link from "next/link";
import { useState } from "react";
import { VAULT_ADDRESS, explorerAddress } from "@/lib/chain";
import { usd, pct } from "@/lib/format";
import { cx } from "@/lib/format";
import { useVaultFeed, VaultTotals } from "@/components/VaultActivity";
import { chainLabel, usdg } from "@/lib/vaultAgent";
import { BalanceSheet, CreditsHowItWorks, FeeReceipts, useCreditStats } from "@/components/TreasuryLive";
import { useCredits } from "@/lib/creditsClient";

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

/** Fees actually recorded on-chain: USDG the deployed vault sent to its fee recipient (3.6). */
function OnChainTreasury() {
  const feed = useVaultFeed();
  const s = feed.summary;
  return (
    <section className="rcard rcard-pad stack gap-14" data-testid="treasury-onchain">
      <div className="row between wrap gap-8">
        <h2 className="rcard-title">Recorded on-chain</h2>
        <span className={cx("pill", feed.status === "ready" ? "pill-green" : "pill-amber")}>
          {feed.status === "ready" ? "chain data" : feed.status === "off" ? "no vault configured" : feed.status === "loading" ? "reading…" : "unavailable"}
        </span>
      </div>
      {feed.status === "ready" && s ? (
        <>
          <div className="joined-stats" style={{ ["--cols" as string]: 3 }}>
            <div>
              <span className="stat-label">Fees received</span>
              <span className="js-v">{usdg(s.totals.feesToTreasury).toFixed(4)} USDG</span>
              <span className="tiny">vault → fee recipient transfers</span>
            </div>
            <div>
              <span className="stat-label">Vault assets</span>
              <span className="js-v">{usdg(s.live.reportedAssets ?? s.reportedAssets).toFixed(2)} USDG</span>
              <span className="tiny">investor money: a liability, not revenue</span>
            </div>
            <div>
              <span className="stat-label">Withdrawals in progress</span>
              <span className="js-v">{s.pendingWithdrawals.length}</span>
              <span className="tiny">owed to investors once settled</span>
            </div>
          </div>
          <VaultTotals s={s} compact />
          <FeeReceipts s={s} />
          <span className="tiny mono" style={{ wordBreak: "break-all" }}>
            {chainLabel(s.chainId)} · fee recipient {s.live.feeRecipient ?? "unknown"} · indexed to block {s.lastBlock.toLocaleString("en-US")}
          </span>
        </>
      ) : (
        <span className="small">
          {feed.status === "off"
            ? "No vault address is configured for this site, so there are no recorded receipts to show."
            : feed.status === "loading"
              ? "Reading the vault's transfers…"
              : `The indexer did not answer (${feed.error ?? "unknown"}). Recorded figures appear only when it does; nothing is estimated in the meantime.`}
        </span>
      )}
    </section>
  );
}

/** Copilot credits as recorded in the ledger (3.7): sold, consumed, provider pass-through, app fee, liability. */
function CreditsTreasury({ s }: { s: ReturnType<typeof useCreditStats> }) {
  const cfg = useCredits().config;
  const f = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return (
    <section className="rcard rcard-pad stack gap-12" data-testid="treasury-credits">
      <div className="row between wrap gap-8">
        <h2 className="rcard-title">Copilot credits · recorded</h2>
        <span className={cx("pill", s?.ok ? "pill-green" : "pill-amber")}>{s ? (s.ok ? "ledger data" : "unavailable") : "reading…"}</span>
      </div>
      {s?.ok ? (
        <div>
          {(
            [
              ["Credits sold (USDG top-ups)", f(s.soldUsd), `${s.topups} top-up${s.topups === 1 ? "" : "s"} · ${s.buyers} wallet${s.buyers === 1 ? "" : "s"}`],
              ["Credits consumed", f(s.consumedUsd), `${s.calls} model call${s.calls === 1 ? "" : "s"}`],
              ["· provider cost (pass-through)", f(s.providerCostUsd), "owed to the AI provider: a cost, not revenue"],
              ["· application fee (revenue)", f(s.appFeeUsd), "the only revenue part of credits"],
              ["Unused credits (liability)", f(s.outstandingUsd), "prepaid by users, never counted as revenue"],
            ] as const
          ).map(([k, v, note]) => (
            <div key={k} className="kv">
              <span className="kv-k">
                {k}
                <span className="tiny" style={{ display: "block" }}>{note}</span>
              </span>
              <span className="kv-v mono-num">{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="small">{s ? `The credits ledger is unavailable (${s.error ?? "error"}).` : "Reading the credits ledger…"}</span>
      )}
      <CreditsHowItWorks reserveUsd={cfg?.mode === "enforce" ? cfg.reserveUsd : null} appFeePct={cfg?.pricing.appFeePct ?? null} />
    </section>
  );
}

export default function TreasuryPage() {
  const feed = useVaultFeed();
  const credits = useCreditStats();
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
          <span className="tagbox">{feed.status === "ready" ? "on-chain + model" : "illustrative"}</span>
        </div>
        <h1 className="page-title-xl">
          Every fee, <span style={{ color: "var(--primary)" }}>accounted.</span>
        </h1>
        <p className="page-sub">
          Gross receipts, provider costs, creator payouts, platform share and outstanding obligations are separated. Deposits,
          trading collateral, escrowed withdrawals and unused credits are liabilities — they never appear as revenue.
        </p>
      </div>

      <OnChainTreasury />
      <BalanceSheet s={feed.summary} credits={credits} />
      <CreditsTreasury s={credits} />

      <div className="row gap-10 wrap" style={{ alignItems: "baseline" }}>
        <h2 className="rcard-title">Accounting model</h2>
        <span className="tagbox">illustrative figures · not recorded receipts</span>
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
              <span className="kv-v">{feed.summary ? `${chainLabel(feed.summary.chainId)} · ${feed.summary.chainId}` : "Robinhood Chain testnet · 46630"}</span>
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
        Reconciliation status: only the &ldquo;Recorded on-chain&rdquo; card is recorded data, read from the vault&apos;s USDG
        transfers. The weekly periods below it are an illustrative accounting model (creator fees and AI credits are not yet
        settled on-chain). No buyback, burn or distribution has occurred. A decorative treasury page would be worse than an
        honest empty one.
      </p>
    </div>
  );
}
