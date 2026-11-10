"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CHAINS, EXPECTED_CHAIN_ID, IS_MAINNET, explorerAddress } from "@/lib/chain";
import { SEL, ethCall, readV2, type VaultV2 } from "@/lib/vaultTx";
import { ChainStatusRow, OnChainVaultCard, useChain } from "@/components/ChainPanel";
import { cx, shortAddr, timeAgo } from "@/lib/format";

export default function ChainPage() {
  const { status, vault, vaultError, address, chain } = useChain();

  return (
    <div className="wrap-md page-pad stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 660 }}>
          <span className="label-dot">Chain</span>
          <h1 className="page-title">Contract &amp; network</h1>
          <p className="page-sub">
            Everything on this page is read live from {chain.name}: the vault contract, its settings and its latest
            transactions. Nothing here is typed in by hand — check any value yourself on the explorer.
          </p>
        </div>
        <div className="row gap-8">
          <Link href="/chain/console" className="btn btn-secondary" data-testid="open-console">
            Contract console
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
            <span className="small strong">Covar vault</span>
            <span className={cx("badge", address ? "badge-green" : "badge-amber")}>
              {address ? "Live" : "Coming soon"}
            </span>
          </div>
          <div className="row between">
            <span className="tiny">Chain ID</span>
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
              ? "Every vault figure on Covar is read from this contract."
              : "The vault opens soon. Nothing can be deposited until it is live."}
          </span>
        </div>
        <NetworkFacts vaultAsset={vault?.asset ?? null} assetSymbol={vault?.assetSymbol ?? "USDG"} assetDecimals={vault?.assetDecimals ?? 6} chainOk={!!status?.ok && status.chainId === EXPECTED_CHAIN_ID} />
      </div>

      <div className="two-col">
        <div className="card card-pad stack gap-12">
          <div className="row between">
            <span className="small strong">Live vault read</span>
            <span className="tiny">refreshed every 20 s · read live</span>
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
          <ContractSafety address={address} navMaxMin={vault ? Math.round(vault.maxNavAgeSeconds / 60) : null} sym={vault?.assetSymbol ?? "USDG"} />
          {status?.checkedAt && <span className="tiny">Network checked {timeAgo(status.checkedAt)}</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ network facts */

function NetworkFacts({ vaultAsset, assetSymbol, assetDecimals, chainOk }: { vaultAsset: string | null; assetSymbol: string; assetDecimals: number; chainOk: boolean }) {
  const chain = CHAINS[EXPECTED_CHAIN_ID];
  const rows: [string, React.ReactNode][] = [
    ["Network", chain.name],
    ["Chain ID", `${EXPECTED_CHAIN_ID} · ${chainOk ? "confirmed by the node" : "checking…"}`],
    ["Gas token", chain.gasToken],
    [
      "Collateral",
      vaultAsset ? (
        EXPECTED_CHAIN_ID === 31337 ? (
          `${assetSymbol} · ${shortAddr(vaultAsset, 4)}`
        ) : (
          <a className="link-primary" href={explorerAddress(vaultAsset)} target="_blank" rel="noreferrer noopener">
            {assetSymbol} · {shortAddr(vaultAsset, 4)} ↗
          </a>
        )
      ) : (
        "USDG"
      ),
    ],
    ["Decimals", String(assetDecimals)],
  ];
  return (
    <div className="panel stack gap-8" style={{ padding: 14 }} data-testid="network-facts">
      <span className="small strong">Network</span>
      {rows.map(([k, v]) => (
        <div key={k} className="row between">
          <span className="tiny">{k}</span>
          <span className="tiny strong">{v}</span>
        </div>
      ))}
      <span className="tiny">
        {IS_MAINNET
          ? "USDG is the Paxos-issued dollar stablecoin. Only this contract address is the real token — a matching name at another address is not."
          : "Test network: tokens have no value."}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ safety rules */

function ContractSafety({ address, navMaxMin, sym }: { address: string | null; navMaxMin: number | null; sym: string }) {
  const [v2, setV2] = useState<VaultV2 | null>(null);
  const [minDep, setMinDep] = useState<bigint | null>(null);
  useEffect(() => {
    if (!address) return;
    readV2(address, EXPECTED_CHAIN_ID).then(setV2).catch(() => setV2(null));
    ethCall(address, SEL.minDeposit, EXPECTED_CHAIN_ID)
      .then((h) => setMinDep(BigInt(h)))
      .catch(() => setMinDep(null));
  }, [address]);
  const u = (x: bigint) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const rules: [string, string][] = [
    [
      "Deposit limits",
      v2 ? `At most ${u(v2.maxDepositPerTx)} ${sym} per deposit and ${u(v2.maxTotalAssets)} ${sym} in total.${minDep !== null ? ` Minimum ${u(minDep)} ${sym}.` : ""}` : "Per-deposit and total caps, plus a minimum deposit.",
    ],
    ["Fresh price only", `Deposits are refused if the vault price is older than ${navMaxMin ?? "the allowed"} minutes, so shares can't be minted at a stale price.`],
    ["Price jumps are capped", "The operator can't move the vault value by more than the contract's maximum change in one report."],
    ["Withdrawals pay only you", "A claim always sends USDG to the wallet that requested it — no one can redirect it."],
    ["Trading money has one destination", "Funds can only go to the trading account set by the owner, and money reserved for claims can never be moved."],
    ["Claims never pause", "Even if deposits are paused or the vault is close-only, settled withdrawals can always be claimed."],
  ];
  return (
    <div className="card card-pad stack gap-10" data-testid="contract-safety">
      <span className="small strong">Built into the contract</span>
      {rules.map(([t, d]) => (
        <div key={t} className="stack" style={{ gap: 1 }}>
          <span className="tiny strong" style={{ color: "var(--ink)" }}>
            ✓ {t}
          </span>
          <span className="tiny">{d}</span>
        </div>
      ))}
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
