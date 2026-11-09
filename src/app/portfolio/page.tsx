"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { actions, useCovar } from "@/lib/store";
import { cx, dateTime, shortAddr, usd } from "@/lib/format";
import { Empty, ProvenanceBadge, TokenLogo, useToast } from "@/components/ui";
import { OnChainVaultCard } from "@/components/ChainPanel";
import { InvestPanel } from "@/components/InvestPanel";
import { WalletGate } from "@/components/WalletGate";
import CreditsPanel from "@/components/CreditsPanel";
import { useCredits } from "@/lib/creditsClient";
import { EXPECTED_CHAIN_ID, VAULT_ADDRESS, readVault } from "@/lib/chain";
import { formatUnits, readAccount, type RequestState } from "@/lib/vaultTx";
import { VAULT_AGENT_ID } from "@/lib/vaultAgent";
import { getWalletProvider } from "@/lib/wallet";

interface ChainPosition {
  usdg: number;
  vault: number;
  shares: number;
  nav: number;
  request: { state: RequestState; shares: number; settledUsd: number };
}

/** Real wallet + Covar vault position from the chain (browser-wallet mode only). */
function useOnChainBalances(wallet: string, enabled: boolean) {
  const [v, setV] = useState<ChainPosition | null>(null);
  useEffect(() => {
    if (!enabled || !VAULT_ADDRESS || !wallet?.startsWith("0x")) return;
    let cancelled = false;
    (async () => {
      try {
        const vault = await readVault(VAULT_ADDRESS);
        const a = await readAccount(VAULT_ADDRESS, vault.asset, wallet, EXPECTED_CHAIN_ID);
        const toNum = (x: bigint, d = 6) => Number(formatUnits(x, d, d).replace(/,/g, ""));
        if (!cancelled)
          setV({
            usdg: toNum(a.usdgBalance),
            vault: toNum((a.shares * a.navWad) / 10n ** 18n),
            shares: toNum(a.shares),
            nav: toNum(a.navWad, 18),
            request: { state: a.request.state, shares: toNum(a.request.shares), settledUsd: toNum(a.request.settledAssets) },
          });
      } catch {
        if (!cancelled) setV(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, enabled]);
  return v;
}

const REQUEST_TEXT: Partial<Record<RequestState, string>> = {
  ClosingPositions: "the operator is closing your share of open positions",
  Settling: "positions are closed; the operator is settling it at a fresh price",
  Claimable: "it is ready — claim it in the Invest card",
};

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
  const { agents, portfolio, walletProviderId } = useCovar();
  const { toast, node } = useToast();
  const credits = useCredits();
  const [tab, setTab] = useState<"all" | "flows" | "fees" | "pending">("all");

  const rows = portfolio.holdings.map((h) => {
    const agent = agents.find((a) => a.id === h.agentId);
    const nav = agent?.vault?.navPerShare ?? 1;
    const value = h.shares * nav;
    return { ...h, agent, nav, value, pnl: value - h.costBasisUsd };
  });

  const isEvm = (walletProviderId ?? getWalletProvider().id) === "evm" && !!VAULT_ADDRESS;
  const chainBal = useOnChainBalances(portfolio.wallet, isEvm);
  const practiceVault = rows.reduce((a, b) => a + b.value, 0);
  // Browser-wallet mode: the headline numbers are the real on-chain ones; practice holdings stay in their labelled rows.
  const vaultValue = isEvm ? (chainBal?.vault ?? 0) : practiceVault;
  const walletUsdg = isEvm ? (chainBal?.usdg ?? 0) : portfolio.cashUsd;
  const totalValue = vaultValue + walletUsdg;
  const loadingChain = isEvm && chainBal === null;
  // Real-wallet mode: practice (simulated) holdings and ledger rows are hidden unless asked for, and then labelled "Practice".
  const [includePractice, setIncludePractice] = useState(false);
  const showPractice = !isEvm || includePractice;
  const practiceCount = rows.length + portfolio.ledger.filter((l) => !l.txHash).length;
  const pending = rows.filter((r) => r.requestedWithdrawal);
  const costBasis = rows.reduce((a, b) => a + b.costBasisUsd, 0);

  const ledger = portfolio.ledger.filter((l) => {
    if (!showPractice && !l.txHash) return false;
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
          <div className="stat-value">{loadingChain ? "…" : usd(totalValue)}</div>
          <span className="tiny">{isEvm ? "wallet + vault, on-chain" : "wallet + vault shares (practice)"}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Wallet USDG</span>
          <div className="stat-value">{loadingChain ? "…" : usd(walletUsdg)}</div>
          <span className="tiny">{isEvm ? "in your wallet, ready to deposit" : "practice balance"}</span>
        </div>
        <div className="card card-pad">
          <span className="tiny">In the vault</span>
          <div className="stat-value">{loadingChain ? "…" : usd(vaultValue)}</div>
          <span className="tiny">
            {isEvm ? (vaultValue > 0 ? "your Covar vault shares" : "no deposit yet") : costBasis ? `${((practiceVault / costBasis - 1) * 100).toFixed(2)}% vs cost` : "no positions"}
          </span>
        </div>
        <div className="card card-pad">
          <span className="tiny">Copilot credits</span>
          <div className="stat-value">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          <span className="tiny">{credits.signedIn ? "prepaid AI usage" : "sign in to use"}</span>
        </div>
      </div>

      {isEvm && chainBal && REQUEST_TEXT[chainBal.request.state] && (
        <div className="notice notice-warn" data-testid="chain-pending">
          <div>
            <strong>Withdrawal in progress.</strong> {chainBal.request.shares.toFixed(4)} shares — {REQUEST_TEXT[chainBal.request.state]}.
            {chainBal.request.state === "Claimable" ? ` You will receive ${usd(chainBal.request.settledUsd)} USDG.` : " A request is not a completed withdrawal until you claim it."}
          </div>
        </div>
      )}
      {showPractice && pending.length > 0 && (
        <div className="notice notice-warn">
          <div>
            <strong>{pending.length} pending practice withdrawal{pending.length > 1 ? "s" : ""}{isEvm ? " (simulated)" : ""}.</strong>{" "}
            {pending.map((p) => `${p.agent?.name}: ${p.requestedWithdrawal?.shares.toFixed(2)} shares (${p.requestedWithdrawal?.state.replace(/_/g, " ")})`).join(" · ")}.
            A request is not a completed withdrawal — positions must be closed before settlement.
          </div>
        </div>
      )}

      {/* ------------------------------- actions ------------------------------- */}
      <div className="grid-2 portfolio-actions" style={{ alignItems: "stretch" }}>
        <InvestPanel />
        <div id="credits" className="portfolio-actions-cell">
          <CreditsPanel />
        </div>
      </div>

      {/* ------------------------------- holdings ------------------------------- */}
      <div className="card stack">
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="small strong">Vault holdings</span>
          <div className="row gap-12 wrap" style={{ justifyContent: "flex-end" }}>
            {isEvm && practiceCount > 0 && (
              <label className="row gap-6 tiny" style={{ cursor: "pointer" }} data-testid="toggle-practice">
                <input type="checkbox" checked={includePractice} onChange={(e) => setIncludePractice(e.target.checked)} />
                Show practice entries (simulated)
              </label>
            )}
            <Link href="/explore" className="btn btn-secondary btn-sm">Browse agents</Link>
          </div>
        </div>

        {(() => {
          const chainRow = isEvm && chainBal && chainBal.shares > 0 ? chainBal : null;
          const shownPractice = showPractice ? rows : [];
          return !chainRow && shownPractice.length === 0;
        })() ? (
          <Empty
            title="No vault positions yet"
            body={
              isEvm
                ? "You don't hold any vault shares. Deposit USDG in the Invest card above — shares are minted at the vault price after the 1% + 0.10 USDG fee."
                : "You hold no shares yet. Deposits mint shares at the vault NAV after the 1% + 0.10 USDG fee."
            }
            action={isEvm ? undefined : <Link href="/explore" className="btn btn-primary">Browse agents</Link>}
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
                {isEvm && chainBal && chainBal.shares > 0 && (
                  <tr data-testid="chain-holding">
                    <td>
                      <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                        <Link href={`/agents/${VAULT_AGENT_ID}`} className="strong">Covar vault</Link>
                        <div className="tiny">Robinhood Chain · USDG</div>
                      </div>
                    </td>
                    <td><span className="badge badge-green">On-chain</span></td>
                    <td className="right num">{chainBal.shares.toFixed(2)}</td>
                    <td className="right num tiny">{chainBal.nav.toFixed(4)}</td>
                    <td className="right num strong">{usd(chainBal.vault)}</td>
                    <td className="right num faint">—</td>
                    <td className="right num faint">—</td>
                    <td>
                      <span className="small">{REQUEST_TEXT[chainBal.request.state] ? "In progress" : "Use the Invest card"}</span>
                    </td>
                  </tr>
                )}
                {(showPractice ? rows : []).map((r) => (
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
                    <td>{isEvm ? <span className="badge badge-outline">Practice</span> : r.agent && <ProvenanceBadge kind={r.agent.provenance} />}</td>
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
          <span className="tiny">newest first · entries are never edited</span>
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
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={6} className="small muted" style={{ padding: "18px 14px", textAlign: "center" }}>
                    {isEvm ? "No on-chain activity yet. Your deposits, withdrawals and claims will appear here with their transaction links." : "Nothing here yet."}
                  </td>
                </tr>
              )}
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
                  <td className="mono tiny">{l.txHash ?? <span className="faint">{isEvm ? "practice · simulated" : "simulated"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------- vault facts & how to read this ------------------------- */}
      <div className="grid-3 portfolio-info" style={{ alignItems: "stretch" }}>
        <OnChainVaultCard />
        <div className="card card-pad stack gap-8">
          <span className="small strong">What counts as what</span>
          <div className="stack gap-8">
            {[
              ["Deposits / withdrawals", "Moving your own money — never shown as profit or loss."],
              ["Vault NAV growth", "The change in your share value, from the on-chain price record."],
              ["Creator fees", "Charged on winning trades only; never netted against losses."],
              ["Copilot credits", "Prepaid AI usage — held for you, not platform revenue."],
            ].map(([k, v]) => (
              <div key={k} className="stack" style={{ gap: 1 }}>
                <span className="tiny strong">{k}</span>
                <span className="tiny">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad stack gap-8">
          <span className="small strong">Custody &amp; authority</span>
          <p className="small" style={{ margin: 0 }}>
            Deposits, pending withdrawals and unused credits belong to you, never to the platform. One owner wallet holds admin
            rights, with no multisig or time delay yet — a known, documented risk.
          </p>
          <div className="row gap-12" style={{ marginTop: "auto" }}>
            <Link href="/docs#custody" className="link-primary small">Custody docs →</Link>
            <Link href="/chain" className="link-primary small">Chain status →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
