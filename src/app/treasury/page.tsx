"use client";

import Link from "next/link";
import { NETWORK_LABEL, VAULT_ADDRESS, explorerAddress } from "@/lib/chain";
import { cx } from "@/lib/format";
import { useVaultFeed, VaultTotals } from "@/components/VaultActivity";
import { chainLabel, usdg } from "@/lib/vaultAgent";
import { BalanceSheet, CreditsHowItWorks, FeeReceipts, useCreditStats } from "@/components/TreasuryLive";
import { useCredits } from "@/lib/creditsClient";


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
              : "The vault's history couldn't be loaded right now. Figures appear as soon as it's back; nothing is estimated in the meantime."}
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

  return (
    <div className="wrap-sm page-pad stack gap-24">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="row gap-10">
          <span className="label-dot">Treasury</span>
          <span className="tagbox">recorded data only</span>
        </div>
        <h1 className="page-title-xl">
          Every fee, <span style={{ color: "var(--primary)" }}>accounted.</span>
        </h1>
        <p className="page-sub">
          Fees received, money owed to investors and credit holders, and the vault&apos;s reserves — read from the chain and
          the credits ledger. Investor deposits, withdrawals waiting to be claimed and unused credits are liabilities; they
          never appear as revenue.
        </p>
      </div>

      <OnChainTreasury />
      <BalanceSheet s={feed.summary} credits={credits} />
      <CreditsTreasury s={credits} />

      <section className="rcard rcard-pad stack gap-10">
        <h2 className="rcard-title">Check it yourself</h2>
        <div>
          <div className="kv">
            <span className="kv-k">Vault contract</span>
            <span className="kv-v mono" style={{ wordBreak: "break-all" }}>{VAULT_ADDRESS || "opening soon"}</span>
          </div>
          <div className="kv">
            <span className="kv-k">Network</span>
            <span className="kv-v">{feed.summary ? `${chainLabel(feed.summary.chainId)} · ${feed.summary.chainId}` : NETWORK_LABEL}</span>
          </div>
          <div className="kv">
            <span className="kv-k">Admin</span>
            <span className="kv-v">single owner wallet · no multisig</span>
          </div>
        </div>
        <span className="tiny">
          The vault has one owner wallet (no multisig). Fee-recipient and setting changes are made by that key and are
          visible on-chain. Losing control of it would affect the vault — a risk we state openly.
        </span>
        <div className="row gap-12 wrap">
          {VAULT_ADDRESS && (
            <a className="accent-link" href={explorerAddress(VAULT_ADDRESS)} target="_blank" rel="noreferrer noopener">
              View on explorer ↗
            </a>
          )}
          <Link href="/chain" className="accent-link">
            Contract &amp; network →
          </Link>
          <Link href="/docs#custody" className="accent-link">
            Custody docs →
          </Link>
        </div>
      </section>

      <p className="mono-note" style={{ maxWidth: 900 }}>
        Everything on this page is recorded data: vault figures come from the vault&apos;s on-chain transfers, credit figures
        from the credits ledger. No buyback, burn or token distribution exists.
      </p>
    </div>
  );
}
