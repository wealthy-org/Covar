"use client";

import Link from "next/link";
import { EXPECTED_CHAIN_ID, explorerAddress } from "@/lib/chain";
import { ChainStatusRow, OnChainVaultCard, useChain } from "@/components/ChainPanel";
import { cx, shortAddr, timeAgo, usd } from "@/lib/format";

const GATES = [
  ["Contracts compile", "pass", "solidity 0.8.24 · 2 contracts"],
  ["Unit + integration suite", "pass", "18 vault assertions + 39 execution-plane assertions"],
  ["Order execution & risk gate", "partial", "paper venue behind the real service boundary; no live adapter"],
  ["Acceptance criteria (brief §15)", "partial", "UI paths covered; live venue adapter missing"],
  ["Testnet deployment", "blocked", "needs a funded deployer key + confirmed testnet USDG"],
  ["End-to-end deposit → trade → withdraw", "pending", "requires a deployed vault"],
  ["Mainnet deployment", "blocked", "refused until the four gates above pass"],
];

export default function ChainPage() {
  const { status, vault, vaultError, address, chain } = useChain();

  return (
    <div className="container section-tight stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 660 }}>
          <span className="eyebrow">Chain</span>
          <h1 className="h2">Deployment &amp; on-chain state</h1>
          <p className="body">
            Covar deploys testnet first (46630), runs the full suite, proves the complete deposit → trade → withdraw
            path, and only then moves to mainnet (4663) with a small controlled value. This page reports what is actually
            deployed — not what is planned.
          </p>
        </div>
        <div className="row gap-8">
          <Link href="/docs#network" className="btn btn-secondary">
            Deployment runbook
          </Link>
          <Link href="/portfolio" className="btn btn-primary">
            My money
          </Link>
        </div>
      </div>

      <div className="grid-3">
        <ChainStatusRow />
        <div className="panel stack gap-8" style={{ padding: 14 }}>
          <div className="row between">
            <span className="small strong">Configured vault</span>
            <span className={cx("badge", address ? "badge-green" : "badge-amber")}>
              {address ? "On-chain" : "Not deployed"}
            </span>
          </div>
          <div className="row between">
            <span className="tiny">Expected chain</span>
            <span className="small strong num">{EXPECTED_CHAIN_ID}</span>
          </div>
          <div className="row between">
            <span className="tiny">Vault address</span>
            <span className="small mono">{address ? shortAddr(address, 6) : "—"}</span>
          </div>
          <div className="row between">
            <span className="tiny">Explorer</span>
            <span className="small">
              {address ? (
                <a className="link-primary" href={explorerAddress(address)} target="_blank" rel="noreferrer noopener">
                  Open ↗
                </a>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="row between">
            <span className="tiny">Gas token</span>
            <span className="small">{chain.gasToken}</span>
          </div>
          <span className="tiny">
            {address
              ? "The vault UI reads live contract state instead of the simulated ledger."
              : "Vault flows are simulated against the contract spec. Nothing is deployed, so nothing can be lost."}
          </span>
        </div>
        <div className="panel stack gap-8" style={{ padding: 14 }}>
          <span className="small strong">Network facts verified on-chain</span>
          {[
            ["46630 chain id", status?.ok && status.chainId === 46630 ? "confirmed" : "unverified"],
            ["4663 chain id", "confirmed (0x1237)"],
            ["USDG decimals (mainnet)", "6 · symbol USDG"],
            ["WETH decimals (mainnet)", "18 · symbol WETH"],
            ["USDG on testnet 46630", "no code at the brief's address"],
          ].map(([k, v]) => (
            <div key={k} className="row between">
              <span className="tiny">{k}</span>
              <span className={cx("tiny strong", String(v).startsWith("no code") ? "neg" : "")}>{v}</span>
            </div>
          ))}
          <span className="tiny">
            Token addresses in the brief resolve on mainnet only. Testnet collateral must be confirmed by the owner
            before any deployment — a matching ticker at another address is not the same token.
          </span>
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad stack gap-12">
          <div className="row between">
            <span className="small strong">Live vault read</span>
            <span className="tiny">refreshed every 20s · read-only RPC</span>
          </div>
          <OnChainVaultCard showLinks={false} />
          {vault && (
            <div className="table-wrap panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th className="right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Asset", `${vault.assetSymbol} · ${vault.assetDecimals} decimals`],
                    ["Asset contract", shortAddr(vault.asset, 6)],
                    ["NAV per share", `${vault.navPerShare.toFixed(6)} ${vault.assetSymbol}`],
                    ["Reported assets", `${usd(vault.reportedAssets)} ${vault.assetSymbol}`],
                    ["Shares outstanding", vault.totalShares.toLocaleString("en-US", { maximumFractionDigits: 2 })],
                    ["Deposit fee", `${vault.depositFeeBps / 100}% + ${vault.depositFeeFlat.toFixed(2)}`],
                    ["Withdrawal fee", `${vault.withdrawalFeeBps / 100}% + ${vault.withdrawalFeeFlat.toFixed(2)}`],
                    ["Max NAV age", `${Math.round(vault.maxNavAgeSeconds / 60)} min`],
                    ["NAV freshness", vault.navIsStale ? "STALE — deposits rejected" : `fresh (${vault.navAgeSeconds}s old)`],
                    ["Owner (single wallet)", vault.owner],
                    ["Operator (isolated signer)", vault.operator],
                    ["Fee recipient", vault.feeRecipient],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="small">{k}</td>
                      <td className={cx("right mono tiny", v === "STALE — deposits rejected" ? "neg" : "")}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {vaultError && !vault && <span className="tiny neg">{vaultError}</span>}
        </div>

        <div className="stack gap-16 sticky-side">
          <div className="card card-pad stack gap-10">
            <span className="small strong">Deployment gates</span>
            {GATES.map(([label, state, detail]) => (
              <div key={label} className="stack" style={{ gap: 1 }}>
                <div className="row between gap-8">
                  <span className="tiny strong">{label}</span>
                  <span
                    className={cx(
                      "badge",
                      state === "pass" ? "badge-green" : state === "partial" ? "badge-blue" : state === "blocked" ? "badge-red" : "badge-amber"
                    )}
                  >
                    {state}
                  </span>
                </div>
                <span className="tiny">{detail}</span>
              </div>
            ))}
            <hr className="divider" />
            <span className="tiny">
              The deploy script refuses mainnet without <span className="mono">CONFIRM_MAINNET=yes</span>, and refuses any
              chain where the collateral token has no bytecode or wrong decimals.
            </span>
          </div>

          <div className="card card-pad stack gap-8">
            <span className="small strong">Commands</span>
            <div className="code" style={{ fontSize: 11 }}>
              {`# read-only checks
npm run preflight:testnet

# deploy (needs a funded key)
npm run deploy:testnet

# contract suite
npm run test:contracts`}
            </div>
            <span className="tiny">
              Keys stay in the shell or a secret manager. Never in this repository, never in a chat message.
            </span>
          </div>

          <div className="card card-pad stack gap-8">
            <span className="small strong">RPC access</span>
            <span className="tiny">
              Mainnet and testnet are both Arbitrum Orbit chains with public endpoints; the local rehearsal node is only
              for exercising the read path. Indonesian ISPs frequently block these hosts — if a read fails, enable a VPN
              and retry before filing it as an outage.
            </span>
            {status?.checkedAt && <span className="tiny">Last check {timeAgo(status.checkedAt)}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
