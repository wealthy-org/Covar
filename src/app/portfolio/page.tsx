"use client";

import Link from "next/link";
import { useState } from "react";
import { actions, useCovar } from "@/lib/store";
import { cx, dateTime, shortAddr, usd } from "@/lib/format";
import { Empty, ProvenanceBadge, TokenLogo, useToast } from "@/components/ui";
import { OnChainVaultCard } from "@/components/ChainPanel";
import { InvestPanel } from "@/components/InvestPanel";
import { WalletGate } from "@/components/WalletGate";
import CreditsPanel from "@/components/CreditsPanel";
import { useCredits } from "@/lib/creditsClient";

export default function PortfolioPage() {
  return (
    <WalletGate
      title="Your money"
      blurb="Vault shares, deposits, withdrawal requests and fees — each row labelled with where it came from."
      bullets={[
        "Deposits and withdrawals stay in your wallet",
        "A withdrawal request is not a completed withdrawal",
        "Capital flows are never shown as profit",
      ]}
    >
      <PortfolioInner />
    </WalletGate>
  );
}

function PortfolioInner() {
  const { agents, portfolio } = useCovar();
  const { toast, node } = useToast();
  const credits = useCredits();
  const [tab, setTab] = useState<"all" | "flows" | "fees" | "pending">("all");

  const rows = portfolio.holdings.map((h) => {
    const agent = agents.find((a) => a.id === h.agentId);
    const nav = agent?.vault?.navPerShare ?? 1;
    const value = h.shares * nav;
    return { ...h, agent, nav, value, pnl: value - h.costBasisUsd };
  });

  const vaultValue = rows.reduce((a, b) => a + b.value, 0);
  const totalValue = vaultValue + portfolio.cashUsd;
  const pending = rows.filter((r) => r.requestedWithdrawal);
  const costBasis = rows.reduce((a, b) => a + b.costBasisUsd, 0);

  const ledger = portfolio.ledger.filter((l) => {
    if (tab === "flows") return ["deposit", "withdrawal_request", "withdrawal_claim"].includes(l.kind);
    if (tab === "fees") return ["fee_deposit", "trade_fee", "creator_share", "platform_share", "ai_credit"].includes(l.kind);
    if (tab === "pending") return l.state !== "settled";
    return true;
  });

  return (
    <div className="wrap-md page-pad stack gap-24">
      {node}
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 620 }}>
          <span className="label-dot">My money</span>
          <h1 className="page-title">Accounts &amp; vault holdings</h1>
          <p className="page-sub">
            Capital flows, trading P&amp;L and platform fees are kept in separate lines. A withdrawal request is tracked
            as pending until positions are closed and the claim settles.
          </p>
        </div>
        <div className="panel row gap-12" style={{ padding: "10px 14px" }}>
          <div className="stack" style={{ gap: 1 }}>
            <span className="tiny">Wallet</span>
            <span className="mono">{shortAddr(portfolio.wallet, 5)}</span>
          </div>
          <span className="badge badge-amber">Testnet 46630</span>
        </div>
      </div>

      <div className="grid-4">
        <div className="card card-pad">
          <span className="tiny">Total value</span>
          <div className="stat-value">{usd(totalValue)}</div>
          <span className="tiny">wallet + vault shares</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Wallet USDG</span>
          <div className="stat-value">{usd(portfolio.cashUsd)}</div>
          <span className="tiny">available to deposit</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Vault positions</span>
          <div className="stat-value">{usd(vaultValue)}</div>
          <span className="tiny">{costBasis ? `${((vaultValue / costBasis - 1) * 100).toFixed(2)}% vs cost` : "no positions"}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Copilot credits</span>
          <div className="stat-value">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          <a className="btn btn-soft btn-sm" style={{ marginTop: 6 }} href="#credits">
            {credits.signedIn ? "Top up" : "Sign in to use"}
          </a>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="notice notice-warn">
          <div>
            <strong>{pending.length} pending withdrawal{pending.length > 1 ? "s" : ""}.</strong>{" "}
            {pending.map((p) => `${p.agent?.name}: ${p.requestedWithdrawal?.shares.toFixed(2)} shares (${p.requestedWithdrawal?.state.replace(/_/g, " ")})`).join(" · ")}.
            A request is not a completed withdrawal — positions must be closed before settlement.
          </div>
        </div>
      )}

      {/* ------------------------------- holdings ------------------------------- */}
      <div className="card stack">
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="small strong">Vault holdings</span>
          <Link href="/explore" className="btn btn-secondary btn-sm">Deposit into another agent</Link>
        </div>

        {rows.length === 0 ? (
          <Empty
            title="No vault positions"
            body="You hold no shares yet. Deposits mint shares at the vault NAV after the 1% + 0.10 USDG fee."
            action={<Link href="/explore" className="btn btn-primary">Browse agents</Link>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-min">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Record</th>
                  <th className="right">Shares</th>
                  <th className="right">NAV</th>
                  <th className="right">Value</th>
                  <th className="right">Cost basis</th>
                  <th className="right">P&amp;L</th>
                  <th>Withdrawal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.agentId}>
                    <td>
<div className="row gap-10" style={{ flexWrap: "nowrap" }}>
                      <TokenLogo market={r.agent?.market ?? ""} size={26} />
                      <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                      <Link href={`/agents/${r.agentId}`} className="strong">{r.agent?.name ?? r.agentId}</Link>
                      <div className="tiny">{r.agent?.market}</div>
                      </div>
                    </div>
                    </td>
                    <td>{r.agent && <ProvenanceBadge kind={r.agent.provenance} />}</td>
                    <td className="right num">{r.shares.toFixed(2)}</td>
                    <td className="right num tiny">{r.nav.toFixed(4)}</td>
                    <td className="right num strong">{usd(r.value)}</td>
                    <td className="right num">{usd(r.costBasisUsd)}</td>
                    <td className={cx("right num strong", r.pnl >= 0 ? "pos" : "neg")}>
                      {r.pnl >= 0 ? "+" : "−"}{usd(Math.abs(r.pnl))}
                    </td>
                    <td>
                      {r.requestedWithdrawal ? (
                        <div className="stack gap-4">
                          <span className="badge badge-blue">{r.requestedWithdrawal.state.replace(/_/g, " ")}</span>
                          {r.requestedWithdrawal.state !== "claimable" ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                actions.advanceWithdrawal(r.agentId);
                                toast("Operator step applied");
                              }}
                            >
                              Advance
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                actions.claimWithdrawal(r.agentId);
                                toast("Settled to wallet");
                              }}
                            >
                              Claim {usd(r.requestedWithdrawal.estUsd)}
                            </button>
                          )}
                        </div>
                      ) : (
                        <Link href={`/agents/${r.agentId}`} className="link-primary small">
                          Manage
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------------------------------- ledger -------------------------------- */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row between wrap gap-8" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            {[
              ["all", "All activity"],
              ["flows", "Capital flows"],
              ["fees", "Fees & credits"],
              ["pending", "Pending"],
            ].map(([id, label]) => (
              <button key={id} className="tab" data-active={tab === id} onClick={() => setTab(id as typeof tab)}>
                {label}
              </button>
            ))}
          </div>
          <span className="tiny">ledger is append-only within a session</span>
        </div>
        <div className="table-wrap">
          <table className="table table-min">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Description</th>
                <th className="right">Amount</th>
                <th>State</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td className="tiny nowrap">{dateTime(l.ts)}</td>
                  <td>
                    <span
                      className={cx(
                        "badge",
                        l.kind === "deposit" ? "badge-blue"
                          : l.kind === "withdrawal_claim" ? "badge-green"
                          : l.kind === "withdrawal_request" ? "badge-amber"
                          : l.kind === "pnl" ? "badge-green"
                          : "badge-outline"
                      )}
                    >
                      {l.kind.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="small">
                    {l.label}
                    {l.note && <div className="tiny">{l.note}</div>}
                  </td>
                  <td className={cx("right num strong", l.kind === "withdrawal_request" ? "muted" : "")}>
                    {l.note?.startsWith("A request is not") || l.kind === "withdrawal_request"
                      ? usd(Math.abs(l.amountUsd))
                      : `${l.amountUsd >= 0 ? "+" : "−"}${usd(Math.abs(l.amountUsd))}`}
                  </td>
                  <td>
                    <span className={cx("badge", l.state === "settled" ? "badge-green" : l.state === "pending" ? "badge-amber" : "badge-outline")}>
                      {l.state}
                    </span>
                  </td>
                  <td className="mono tiny">{l.txHash ?? <span className="faint">simulated</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card card-pad stack gap-8">
          <span className="small strong">What counts as what</span>
          <div className="stack gap-6">
            {[
              ["Deposits / withdrawals", "Capital flows — never shown as profit or loss."],
              ["Vault NAV growth", "Your share value change, from the on-chain NAV record."],
              ["Creator fees", "Charged on winning-trade profit only; not netted against losses."],
              ["Copilot credits", "Service credits — a liability, not platform revenue."],
            ].map(([k, v]) => (
              <div key={k} className="row between gap-12">
                <span className="tiny strong">{k}</span>
                <span className="tiny" style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="stack gap-12">
          <InvestPanel />
          <div id="credits">
            <CreditsPanel />
          </div>
          <OnChainVaultCard />
          <div className="card card-pad stack gap-8">
            <span className="small strong">Custody &amp; authority</span>
            <p className="small">
              Deposits, escrowed withdrawals and unused credits are liabilities, never revenue. The single owner wallet
              holds admin authority with no multisig and no threshold delay — an accepted, documented risk.
            </p>
            <div className="row gap-12">
              <Link href="/docs#custody" className="link-primary small">Custody docs →</Link>
              <Link href="/chain" className="link-primary small">Chain status →</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
