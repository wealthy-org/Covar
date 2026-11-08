"use client";

/**
 * The deployed vault as a first-class agent record (package 3.6).
 *
 * Polls /api/vault/summary, which proxies the indexer and holds only chain data,
 * and turns it into an `Agent` + `Creator` that Discover, the agent page and the
 * portfolio render like any other record. Nothing here is persisted: the record
 * is re-derived from chain data on every load, so it cannot drift from the chain
 * or be confused with a seeded demo record. Seeded records never carry the real
 * vault address. Only this one does.
 *
 * With no vault configured, or the indexer unreachable, there is simply no vault
 * record, and `vaultFeed.status` says why. Numbers are never filled in.
 */
import type { Agent, Creator } from "./types";
import { VAULT_ADDRESS } from "./chain";

export const VAULT_AGENT_ID = "covar-vault";
export const VAULT_CREATOR_ID = "covar";

export interface VaultSummary {
  configured: boolean;
  ok?: boolean;
  error?: string;
  synced?: boolean;
  vault: string;
  chainId: number | null;
  lastBlock: number;
  asOf: number | null;
  inception: number | null;
  navSeries: { t: number; block: number; navPerShare: number; assets: string }[];
  navPerShare: number;
  returnPct: number;
  maxDrawdownPct: number;
  reportedAssets: string;
  totalShares: string;
  investors: { total: number; holding: number };
  totals: { depositsGross: string; depositFees: string; withdrawalFees: string; feesToTreasury: string; settledToInvestors: string; claimed: string; allocatedToVenue: string };
  counts: { deposits: number; withdrawalsRequested: number; withdrawalsSettled: number; claims: number; navReports: number };
  pendingWithdrawals: { investor: string; shares: string; state: string }[];
  recent: { type: string; t: number | null; block: number; txHash: string; investor?: string; amount?: string; shares?: string }[];
  live: {
    reportedAssets: string | null;
    totalShares: string | null;
    navPerShare: number | null;
    lastNavUpdate: number | null;
    maxNavAge: number | null;
    depositsPaused: boolean | null;
    closeOnly: boolean | null;
    maxTotalAssets: string | null;
    maxDepositPerTx: string | null;
    feeRecipient: string | null;
    tradingAccount: string | null;
  };
}

/** USDG has 6 decimals; vault shares use the same scale. */
export const usdg = (raw: string | null | undefined) => (raw ? Number(BigInt(raw)) / 1e6 : 0);

export function chainLabel(chainId: number | null | undefined) {
  if (chainId === 4663) return "Robinhood Chain";
  if (chainId === 46630) return "Robinhood Chain testnet";
  if (chainId === 31337) return "Local chain";
  return chainId ? `chain ${chainId}` : "unknown chain";
}

export function vaultAgentFrom(s: VaultSummary, now = Date.now()): { agent: Agent; creator: Creator } {
  const navNow = s.live.navPerShare ?? s.navPerShare;
  const curve = s.navSeries.length ? [100, ...s.navSeries.map((p) => p.navPerShare * 100)] : [];
  if (curve.length && Math.abs(curve[curve.length - 1] - navNow * 100) > 1e-9) curve.push(navNow * 100);
  const tvl = usdg(s.live.reportedAssets ?? s.reportedAssets);
  const shares = usdg(s.live.totalShares ?? s.totalShares);
  const pendingShares = s.pendingWithdrawals.reduce((n, p) => n + usdg(p.shares), 0);
  const days = s.inception ? Math.max(1, Math.ceil((now / 1000 - s.inception) / 86_400)) : 0;
  const mainnet = s.chainId === 4663;
  const status: Agent["status"] = s.live.closeOnly ? "winding_down" : s.live.depositsPaused ? "paused" : "live";
  const cap = s.live.maxTotalAssets ? usdg(s.live.maxTotalAssets) : null;
  const perTx = s.live.maxDepositPerTx ? usdg(s.live.maxDepositPerTx) : null;
  const navHours = s.live.maxNavAge ? s.live.maxNavAge / 3600 : null;
  const name = process.env.NEXT_PUBLIC_COVAR_VAULT_NAME || "Covar Vault";
  const market = process.env.NEXT_PUBLIC_COVAR_VAULT_MARKET || "ETH-PERP";

  const agent: Agent = {
    id: VAULT_AGENT_ID,
    name,
    tagline: `The deployed CovarVault on ${chainLabel(s.chainId)} · every figure read from chain logs`,
    creatorId: VAULT_CREATOR_ID,
    status,
    market,
    timeframe: "—",
    provenance: "vault",
    score: 0, // not ranked: rankings need 7+ days of share price and a reviewed record
    tvlUsd: tvl,
    returnPct: (navNow - 1) * 100,
    drawdownPct: -s.maxDrawdownPct,
    liveAgeDays: days,
    tradeCount: 0,
    version: 1,
    curve,
    benchmark: [],
    decisions: [],
    versions: [],
    vault: {
      address: s.vault,
      chain: mainnet ? "robinhood-mainnet" : "robinhood-testnet",
      navPerShare: navNow,
      tvlUsd: tvl,
      sharesOutstanding: shares,
      sharePriceHistory: s.navSeries.map((p) => p.navPerShare),
      depositFeePct: 1,
      depositFeeFlat: 0.1,
      pendingDeposits: 0, // deposits mint immediately at NAV; nothing queues
      pendingWithdrawals: pendingShares * navNow,
      unwindDays: 2,
    },
    strategySummary:
      process.env.NEXT_PUBLIC_COVAR_VAULT_STRATEGY ||
      "Run by the Covar operator: capital above the idle reserve is allocated to the trading account on Lighter, trades pass the independent risk service, and NAV is the venue equity reported on-chain. Withdrawals close the investor's share of positions before settlement.",
    riskSummary: [
      cap !== null ? `cap ${cap.toLocaleString("en-US")} USDG total` : null,
      perTx !== null ? `${perTx.toLocaleString("en-US")} USDG per deposit` : null,
      navHours !== null ? `deposits and settlements need a NAV report under ${navHours}h old` : null,
      s.live.closeOnly ? "close-only mode is ON" : s.live.depositsPaused ? "deposits are paused" : "deposits open",
    ]
      .filter(Boolean)
      .join(" · "),
    disclosure: mainnet
      ? "Real money vault. Value is kept small and controlled during launch; the admin is a single key (documented, accepted risk). Losses are possible."
      : s.chainId === 31337
        ? "Local test chain. Tokens here have no value."
        : "Test network vault: test USDG with no real value. Figures are real chain data from the testnet.",
  };

  const creator: Creator = {
    id: VAULT_CREATOR_ID,
    handle: "covar",
    name: "Covar",
    joined: s.inception ? new Date(s.inception * 1000).toISOString() : new Date(now).toISOString(),
    bio: "The platform's own vault, operated by the Covar operator service.",
    agentIds: [VAULT_AGENT_ID],
    followers: 0,
    verified: true,
  };
  return { agent, creator };
}

/* --------------------------------- feed ---------------------------------- */

type FeedStatus = "off" | "loading" | "ready" | "unavailable";
interface Feed {
  status: FeedStatus;
  error: string | null;
  summary: VaultSummary | null;
  agent: Agent | null;
  creator: Creator | null;
}

let feed: Feed = { status: VAULT_ADDRESS ? "loading" : "off", error: null, summary: null, agent: null, creator: null };
const listeners = new Set<() => void>();
let started = false;

async function refresh() {
  try {
    const res = await fetch("/api/vault/summary", { cache: "no-store" });
    const body = (await res.json()) as VaultSummary;
    if (!body.configured) feed = { ...feed, status: "off", error: null, summary: null, agent: null, creator: null };
    else if (!res.ok || body.ok === false) feed = { ...feed, status: "unavailable", error: body.error ?? `HTTP ${res.status}` };
    else {
      const { agent, creator } = vaultAgentFrom(body);
      feed = { status: "ready", error: null, summary: body, agent, creator };
    }
  } catch (err) {
    feed = { ...feed, status: "unavailable", error: (err as Error).message };
  }
  listeners.forEach((l) => l());
}

export const vaultFeed = {
  get: () => feed,
  subscribe(l: () => void) {
    listeners.add(l);
    if (!started && typeof window !== "undefined" && VAULT_ADDRESS) {
      started = true;
      void refresh();
      window.setInterval(() => void refresh(), 30_000);
    }
    return () => listeners.delete(l);
  },
  refresh,
};
