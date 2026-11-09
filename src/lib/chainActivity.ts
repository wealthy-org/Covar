import type { LedgerRow } from "./types";

/**
 * Merges an investor's indexed vault events into the portfolio ledger.
 *
 * The chain is the record: a confirmed deposit, withdrawal request or claim
 * that this device never wrote down (done in another tab, on another device,
 * or lost to a sync race) is added with its real tx hash and block time. A
 * request that has since been claimed is marked settled. Nothing is added that
 * the chain doesn't have, and rows already present (same tx hash) are kept.
 */
export interface VaultEvent {
  event: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  ts?: number;
  args: Record<string, string>;
}

const units = (raw: string | undefined, decimals: number): number => {
  if (!raw) return 0;
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  return Number(v / base) + Number(v % base) / Number(base);
};
const fmt = (n: number, max = 4) => n.toLocaleString("en-US", { maximumFractionDigits: max });

export function mergeChainActivity(
  ledger: LedgerRow[],
  events: VaultEvent[],
  opts: { decimals?: number; symbol?: string; agentId?: string } = {},
): { ledger: LedgerRow[]; added: number; updated: number } {
  const dec = opts.decimals ?? 6;
  const sym = opts.symbol ?? "USDG";
  const sorted = [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const known = new Set(ledger.map((l) => l.txHash?.toLowerCase()).filter(Boolean));
  const fresh: LedgerRow[] = [];

  // settled amount per request (the settle that follows each request, in order)
  const settledAfter = new Map<string, number>();
  const claimedRequests = new Set<string>();
  let openRequest: string | null = null;
  for (const e of sorted) {
    if (e.event === "WithdrawalRequested") openRequest = e.txHash.toLowerCase();
    else if (e.event === "WithdrawalSettled" && openRequest) settledAfter.set(openRequest, units(e.args.netAssets, dec));
    else if (e.event === "WithdrawalClaimed" && openRequest) {
      claimedRequests.add(openRequest);
      openRequest = null;
    }
  }

  for (const e of sorted) {
    const hash = e.txHash.toLowerCase();
    if (known.has(hash)) continue;
    const ts = e.ts ? new Date(e.ts * 1000).toISOString() : new Date().toISOString();
    const base = { id: `tx-${e.txHash.slice(2, 14)}`, ts, txHash: e.txHash, ...(opts.agentId ? { agentId: opts.agentId } : {}) };
    if (e.event === "Deposit") {
      const gross = units(e.args.assetsIn, dec);
      fresh.push({ ...base, kind: "deposit", label: `Deposited ${fmt(gross)} ${sym}`, amountUsd: gross, state: "settled", note: `fee ${fmt(units(e.args.fee, dec))} · from the chain` });
    } else if (e.event === "WithdrawalRequested") {
      const shares = units(e.args.shares, dec);
      const net = settledAfter.get(hash);
      fresh.push({
        ...base,
        kind: "withdrawal_request",
        label: `Withdrawal requested · ${fmt(shares)} shares`,
        amountUsd: net ?? 0,
        state: claimedRequests.has(hash) ? "settled" : "pending",
        note: net === undefined ? "amount fixed at settlement · from the chain" : "settled amount · from the chain",
      });
    } else if (e.event === "WithdrawalClaimed") {
      const amt = units(e.args.assets, dec);
      fresh.push({ ...base, kind: "withdrawal_claim", label: `Claimed ${fmt(amt)} ${sym}`, amountUsd: amt, state: "settled", note: "from the chain" });
    }
    known.add(hash);
  }

  // existing pending request rows whose request has been claimed on-chain
  let updated = 0;
  const merged = ledger.map((l) => {
    if (l.kind === "withdrawal_request" && l.state === "pending" && l.txHash && claimedRequests.has(l.txHash.toLowerCase())) {
      updated++;
      return { ...l, state: "settled" as const };
    }
    return l;
  });
  const all = [...fresh, ...merged].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return { ledger: fresh.length || updated ? all : ledger, added: fresh.length, updated };
}
