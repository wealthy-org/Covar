"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CHAINS,
  EXPECTED_CHAIN_ID,
  VAULT_ADDRESS,
  explorerAddress,
  getChainStatus,
  readVault,
  type ChainStatus,
  type VaultState,
} from "@/lib/chain";
import { cx, shortAddr, timeAgo, usd } from "@/lib/format";
import { explainError } from "@/lib/vaultTx";

export function useChain() {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await getChainStatus();
    setStatus(s);
    if (VAULT_ADDRESS) {
      try {
        setVault(await readVault(VAULT_ADDRESS));
        setVaultError(null);
      } catch (e) {
        setVault(null);
        setVaultError(explainError(e));
      }
    } else {
      setVault(null);
      setVaultError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { status, vault, vaultError, loading, refresh, address: VAULT_ADDRESS, chain: CHAINS[EXPECTED_CHAIN_ID] };
}

export function ChainStatusRow({ compact = false }: { compact?: boolean }) {
  const { status, loading, refresh, chain } = useChain();

  return (
    <div className="panel stack gap-8" style={{ padding: 14 }}>
      <div className="row between gap-8">
        <span className="small strong">RPC node · Robinhood Chain</span>
        {status?.ok ? (
          <span className={cx("badge", status.chainIdMatches ? "badge-green" : "badge-red")} data-testid="rpc-status">
            <span className="dot dot-live" />
            {status.chainIdMatches ? "Connected" : `Wrong chain ${status.chainId}`}
          </span>
        ) : (
          <span className="badge badge-red">{loading ? "Connecting…" : "Unreachable"}</span>
        )}
      </div>

      <div className="row between">
        <span className="tiny">Chain ID</span>
        <span className="small strong num" data-testid="rpc-chain-id">
          {status?.chainId ? `${status.chainId}` : EXPECTED_CHAIN_ID} ·{" "}
          {chain.isMainnet ? "mainnet" : EXPECTED_CHAIN_ID === 31337 ? "local rehearsal" : "testnet"}
        </span>
      </div>
      <div className="row between">
        <span className="tiny">Block</span>
        <span className="small num">{status?.ok ? status.blockNumber.toLocaleString("en-US") : "—"}</span>
      </div>
      <div className="row between">
        <span className="tiny">RPC latency</span>
        <span className="small num">{status?.ok ? `${status.latencyMs} ms` : "—"}</span>
      </div>
      {!compact && (
        <div className="row between">
          <span className="tiny">Endpoint</span>
          <span className="tiny mono truncate" style={{ maxWidth: 210 }}>
            {chain.rpc.replace("https://", "")}
          </span>
        </div>
      )}

      {status?.error && (
        <span className="tiny" style={{ color: "var(--negative)" }}>
          {status.error} — Robinhood Chain RPC is often blocked by Indonesian ISPs; enable a VPN before treating this as
          an endpoint failure.
        </span>
      )}

      <button className="btn btn-secondary btn-sm" onClick={() => void refresh()} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

export function OnChainVaultCard({ showLinks = true }: { showLinks?: boolean }) {
  const { vault, vaultError, loading, address, chain } = useChain();

  if (!address) {
    return (
      <div className="panel stack gap-8" style={{ padding: 14 }}>
        <div className="row between">
          <span className="small strong">Vault settlement</span>
          <span className="badge badge-amber">Simulated</span>
        </div>
        <span className="tiny">
          No vault address is configured, so deposits, NAV and withdrawals on this screen come from the simulated ledger
          — not from a contract. The contract and its test suite exist in the repository; nothing is deployed.
        </span>
        <div className="code" style={{ fontSize: 11 }}>
          {`NEXT_PUBLIC_COVAR_VAULT_ADDRESS=0x…\nNEXT_PUBLIC_RH_CHAIN_ID=46630`}
        </div>
        {showLinks && (
          <Link href="/chain" className="link-primary small">
            Chain &amp; deployment status →
          </Link>
        )}
      </div>
    );
  }

  if (loading && !vault) {
    return (
      <div className="panel stack gap-8" style={{ padding: 14 }}>
        <div className="row between">
          <span className="small strong">Vault settlement</span>
          <span className="badge badge-outline">Reading chain…</span>
        </div>
        <div className="skel" style={{ height: 54 }} />
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="panel stack gap-8" style={{ padding: 14 }}>
        <div className="row between">
          <span className="small strong">Vault settlement</span>
          <span className="badge badge-red">Unavailable</span>
        </div>
        <span className="tiny">Couldn&apos;t load the vault right now. {vaultError}</span>
        <span className="tiny mono">{address}</span>
      </div>
    );
  }

  return (
    <div className="panel stack gap-8" style={{ padding: 14 }}>
      <div className="row between">
        <span className="small strong">Vault settlement</span>
        <span className="badge badge-green">
          <span className="dot dot-live" /> On-chain
        </span>
      </div>
      <div className="row between">
        <span className="tiny">Contract</span>
        <a
          className="tiny mono link-primary"
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {shortAddr(address, 6)}
        </a>
      </div>
      <div className="row between">
        <span className="tiny">NAV / share</span>
        <span className="small strong num">{vault.navPerShare.toFixed(4)}</span>
      </div>
      <div className="row between">
        <span className="tiny">Reported assets</span>
        <span className="small strong num">
          {usd(vault.reportedAssets)} {vault.assetSymbol}
        </span>
      </div>
      <div className="row between">
        <span className="tiny">Shares outstanding</span>
        <span className="small num">{vault.totalShares.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="row between">
        <span className="tiny">Last NAV report</span>
        <span className={cx("small", vault.navIsStale ? "neg" : "")}>
          {vault.lastNavUpdate ? timeAgo(new Date(vault.lastNavUpdate * 1000).toISOString()) : "never"}
          {vault.navIsStale ? " · overdue" : ""}
        </span>
      </div>
      <div className="row gap-6 wrap">
        {vault.depositsPaused && <span className="badge badge-amber">Deposits paused</span>}
        {vault.closeOnly && <span className="badge badge-amber">Close-only</span>}
        {!vault.depositsPaused && !vault.closeOnly && vault.navIsStale && <span className="badge badge-amber">Deposits paused until the next price update</span>}
        {!vault.depositsPaused && !vault.closeOnly && !vault.navIsStale && <span className="badge badge-green">Deposits open</span>}
        <span className="badge badge-outline">
          {chain.isMainnet ? "Mainnet" : EXPECTED_CHAIN_ID === 31337 ? "Local rehearsal" : "Testnet"}
        </span>
      </div>
      <span className="tiny">
        Values read directly from the contract at block {vault.blockNumber.toLocaleString("en-US")}. Owner{" "}
        <span className="mono">{shortAddr(vault.owner, 3)}</span> · operator{" "}
        <span className="mono">{shortAddr(vault.operator, 3)}</span> · fees to{" "}
        <span className="mono">{shortAddr(vault.feeRecipient, 3)}</span>.
      </span>
    </div>
  );
}
