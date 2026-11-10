"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CHAINS, EXPECTED_CHAIN_ID, explorerAddress } from "@/lib/chain";
import { SEL } from "@/lib/vaultTx";
import { ChainStatusRow, OnChainVaultCard, useChain } from "@/components/ChainPanel";
import { cx, shortAddr, timeAgo } from "@/lib/format";

const GATES = [
  ["Contracts compile", "pass", "solidity 0.8.24 · CovarVault v2"],
  ["Contract suite", "pass", "25 contract tests · operator, indexer, reconciliation and e2e suites in CI"],
  ["Order execution & risk gate", "partial", "risk gate and Lighter client in place; the operator runs with venue \"none\" until a funded venue account is approved"],
  ["Testnet deployment", "pass", "CovarVault v2 on 46630 · source verified on Sourcify (exact match)"],
  ["End-to-end deposit → withdraw → claim", "pass", "run on testnet 46630 with the live operator — see the transactions below"],
  ["Testnet soak (7 days)", "pending", "operator posting NAV every few hours; monitor alerts to Telegram"],
  ["Mainnet deployment", "blocked", "small controlled run only after the soak and a security review"],
];

export default function ChainPage() {
  const { status, vault, vaultError, address, chain } = useChain();

  return (
    <div className="wrap-md page-pad stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 660 }}>
          <span className="label-dot">Chain</span>
          <h1 className="page-title">Deployment &amp; on-chain state</h1>
          <p className="page-sub">
            Covar deploys testnet first (46630), runs the full suite, proves the complete deposit → trade → withdraw
            path, and only then moves to mainnet (4663) with a small controlled value. This page reports what is actually
            deployed — not what is planned.
          </p>
        </div>
        <div className="row gap-8">
          <Link href="/docs#network" className="btn btn-secondary">
            Deployment runbook
          </Link>
          <Link href="/chain/console" className="btn btn-secondary" data-testid="open-console">
            Vault console
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
            <span className="small mono" title={address ?? ""} data-testid="vault-address">{address ? shortAddr(address, 6) : "—"}</span>
          </div>
          {address && (
            <div className="row between">
              <span className="tiny">Source code</span>
              <VerifiedBadge address={address} />
            </div>
          )}
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
            ["USDG on testnet 46630", "0x7E95…802F · Paxos-published · 6 decimals"],
          ].map(([k, v]) => (
            <div key={k} className="row between">
              <span className="tiny">{k}</span>
              <span className={cx("tiny strong", String(v).startsWith("no code") ? "neg" : "")}>{v}</span>
            </div>
          ))}
          <span className="tiny">
            Token addresses in the brief resolve on mainnet only. On testnet the vault uses the USDG address Paxos (the
            issuer) publishes for Robinhood Testnet — a matching ticker at another address is not the same token.
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
              <table className="table table-min">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th className="right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Vault contract", address ?? ""],
                    [
                      "NAV confirmed on-chain",
                      vault.lastNavUpdate === 0
                        ? "never reported"
                        : `${new Date(vault.lastNavUpdate * 1000).toLocaleString("en-GB")} · ${Math.max(1, Math.round(vault.navAgeSeconds / 60))} min ago`,
                    ],
                    ["Asset", `${vault.assetSymbol} · ${vault.assetDecimals} decimals`],
                    ["Asset contract", shortAddr(vault.asset, 6)],
                    ["NAV per share", `${vault.navPerShare.toFixed(6)} ${vault.assetSymbol}`],
                    ["Reported assets", `${vault.reportedAssets.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${vault.assetSymbol}`],
                    ["Total shares", vault.totalShares.toLocaleString("en-US", { maximumFractionDigits: 4 })],
                    ["Deposit fee", `${vault.depositFeeBps / 100}% + ${vault.depositFeeFlat.toFixed(2)}`],
                    ["Withdrawal fee", `${vault.withdrawalFeeBps / 100}% + ${vault.withdrawalFeeFlat.toFixed(2)}`],
                    ["Max NAV age", `${Math.round(vault.maxNavAgeSeconds / 60)} min`],
                    ["NAV freshness", vault.navIsStale ? "STALE — deposits rejected" : `fresh (${vault.navAgeSeconds}s old)`],
                    ["Owner (single wallet)", vault.owner],
                    ["Operator (isolated signer)", vault.operator],
                    ["Fee recipient", vault.feeRecipient],
                  ].map(([k, v]) => (
                    <tr key={k} data-testid="vault-param">
                      <td className="small">{k}</td>
                      <td className={cx("right mono tiny", v === "STALE — deposits rejected" ? "neg" : "")}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {vaultError && !vault && <span className="tiny neg">{vaultError}</span>}
          {address && <RecentTxs address={address} roles={vault ? { [vault.owner.toLowerCase()]: "Owner", [vault.operator.toLowerCase()]: "Operator", [vault.feeRecipient.toLowerCase()]: "Fee recipient" } : {}} />}
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

/* ------------------------------------------------------------------ verification */

const SOURCIFY = "https://sourcify.dev/server";

/** Live check against Sourcify — the badge is never hard-coded. */
function VerifiedBadge({ address }: { address: string }) {
  const [state, setState] = useState<{ match: string | null; at?: string } | "loading" | "error">("loading");
  useEffect(() => {
    if (EXPECTED_CHAIN_ID === 31337) {
      setState({ match: null });
      return;
    }
    let off = false;
    fetch(`${SOURCIFY}/v2/contract/${EXPECTED_CHAIN_ID}/${address}`)
      .then((r) => (r.status === 404 ? { match: null } : r.json()))
      .then((d) => !off && setState({ match: d?.match ?? null, at: d?.verifiedAt }))
      .catch(() => !off && setState("error"));
    return () => {
      off = true;
    };
  }, [address]);
  if (state === "loading") return <span className="tiny">checking…</span>;
  if (state === "error") return <span className="tiny">Sourcify unreachable</span>;
  if (!state.match) return <span className="badge badge-amber">Not verified</span>;
  return (
    <a
      className="badge badge-green"
      href={`https://repo.sourcify.dev/${EXPECTED_CHAIN_ID}/${address}`}
      target="_blank"
      rel="noreferrer noopener"
      title={state.at ? `verified ${new Date(state.at).toLocaleString("en-GB")}` : undefined}
      data-testid="sourcify-badge"
    >
      ✓ Sourcify · {state.match === "exact_match" ? "Exact match" : "Match"} ↗
    </a>
  );
}

/* ------------------------------------------------------------------ explorer history */

const METHOD_BY_SELECTOR: Record<string, string> = Object.fromEntries(Object.entries(SEL).map(([k, v]) => [v, k]));

interface ExplorerTx {
  hash: string;
  method: string;
  from: string;
  ts: string;
  ok: boolean;
}

/** Latest transactions to the vault, read from the chain's Blockscout explorer API. */
function RecentTxs({ address, roles }: { address: string; roles: Record<string, string> }) {
  const explorer = CHAINS[EXPECTED_CHAIN_ID].explorer;
  const [txs, setTxs] = useState<ExplorerTx[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (EXPECTED_CHAIN_ID === 31337) return;
    let off = false;
    const load = () =>
      fetch(`${explorer}/api/v2/addresses/${address}/transactions`)
        .then((r) => r.json())
        .then((d) => {
          if (off) return;
          const items = (d?.items ?? []) as {
            hash: string;
            method?: string;
            raw_input?: string;
            from?: { hash: string };
            timestamp: string;
            result?: string;
          }[];
          setTxs(
            items.slice(0, 8).map((t) => ({
              hash: t.hash,
              method: t.method || METHOD_BY_SELECTOR[(t.raw_input ?? "").slice(0, 10)] || (t.raw_input ?? "").slice(0, 10) || "transfer",
              from: t.from?.hash ?? "",
              ts: t.timestamp,
              ok: t.result === "success",
            }))
          );
          setErr(null);
        })
        .catch(() => !off && setErr("Explorer unreachable right now."));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [address, explorer]);

  if (EXPECTED_CHAIN_ID === 31337) return null;
  return (
    <div className="stack gap-8" data-testid="recent-txs">
      <div className="row between">
        <span className="small strong">Recent vault transactions</span>
        <a className="tiny link-primary" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer noopener">
          All on Blockscout ↗
        </a>
      </div>
      {err && <span className="tiny neg">{err}</span>}
      {!txs && !err && <span className="tiny">Loading from the explorer…</span>}
      {txs && txs.length === 0 && <span className="tiny">No transactions to the vault yet.</span>}
      {txs && txs.length > 0 && (
        <div className="table-wrap panel">
          <table className="table table-min">
            <thead>
              <tr>
                <th>Method</th>
                <th>From</th>
                <th>When</th>
                <th className="right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.hash}>
                  <td className="mono tiny">
                    <span className={cx("badge", t.ok ? "badge-outline" : "badge-red")}>{t.method}</span>
                  </td>
                  <td className="tiny">
                    {roles[t.from.toLowerCase()] ? <strong>{roles[t.from.toLowerCase()]}</strong> : "Investor"}{" "}
                    <span className="mono">{shortAddr(t.from, 4)}</span>
                  </td>
                  <td className="tiny nowrap">{timeAgo(t.ts)}</td>
                  <td className="right">
                    <a className="mono tiny link-primary" href={`${explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer noopener">
                      {t.hash.slice(0, 8)}…{t.hash.slice(-4)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
