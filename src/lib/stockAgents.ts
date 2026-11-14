/**
 * Instant Stock Agent — positions and the take-profit watcher (browser side).
 *
 * A position exists only after a REAL buy confirmed on Robinhood Chain: its
 * amounts come from the receipt, never from the quote. The watcher compares the
 * live share price (/api/stocks/prices, Yahoo) with the share price at the fill.
 * When the target (or stop) is crossed it raises a banner and a sound; the sale is
 * still signed by the user in their own wallet — Covar never holds a key.
 */
import { USDG, findStock, fromUnits, type MarketInfo, type Side, type StockAsset, type TradeQuote } from "./stockTrade";
import {
  approveExact,
  fetchQuote,
  readWallet,
  recordFromReceipt,
  saveTrade,
  sendSwap,
  spenderFor,
  waitForFullReceipt,
  type TradeRecord,
  type WalletState,
} from "./stockTradeClient";

export type PositionStatus = "watching" | "target_hit" | "stop_hit" | "closed";

export interface StockPosition {
  id: string;
  wallet: string;
  symbol: string;
  stockAddress: string;
  status: PositionStatus;
  prompt: string;
  openedAt: string;
  buyHash: string;
  via: "router" | "direct";
  /** base units actually moved by the buy (receipt) */
  usdgIn: string;
  shares: string;
  /** USDG per token actually paid */
  entryExec: number;
  /** share price (Yahoo) at the fill — the watcher's reference */
  entryRef: number | null;
  refLabel: string | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  targetRef: number | null;
  stopRef: number | null;
  hitAt?: string;
  hitPrice?: number;
  sellHash?: string;
  usdgOut?: string;
  closedAt?: string;
  closeReason?: "take_profit" | "stop_loss" | "manual";
}

const KEY = "covar.stockAgents.v1";

export function loadPositions(wallet?: string | null): StockPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const all: StockPosition[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    return (wallet ? all.filter((p) => p.wallet.toLowerCase() === wallet.toLowerCase()) : all).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  } catch {
    return [];
  }
}

export function savePosition(p: StockPosition) {
  if (typeof window === "undefined") return;
  try {
    const all: StockPosition[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.setItem(KEY, JSON.stringify([p, ...all.filter((x) => x.id !== p.id)].slice(0, 200)));
  } catch {
    /* storage blocked: the trade itself is on chain */
  }
}

export function removePosition(id: string) {
  if (typeof window === "undefined") return;
  try {
    const all: StockPosition[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.setItem(KEY, JSON.stringify(all.filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}

/** Watcher math: move since entry, progress to target, and whether a level was crossed. */
export function watchState(p: Pick<StockPosition, "entryRef" | "targetRef" | "stopRef">, price: number | null | undefined) {
  if (!p.entryRef || price === null || price === undefined || !Number.isFinite(price)) return { pnlPct: null, progressPct: 0, hit: null as null | "target" | "stop" };
  const pnlPct = ((price - p.entryRef) / p.entryRef) * 100;
  const progressPct = p.targetRef && p.targetRef > p.entryRef ? Math.min(100, Math.max(0, ((price - p.entryRef) / (p.targetRef - p.entryRef)) * 100)) : 0;
  const hit = p.targetRef && price >= p.targetRef ? "target" : p.stopRef && price <= p.stopRef ? "stop" : null;
  return { pnlPct, progressPct, hit: hit as null | "target" | "stop" };
}

/** Position from the buy receipt (amounts actually moved). */
export function positionFromBuy(p: {
  rec: TradeRecord;
  prompt: string;
  takeProfitPct?: number;
  stopLossPct?: number;
  entryRef: number | null;
  refLabel: string | null;
}): StockPosition {
  const usdgIn = -BigInt(p.rec.usdgDelta);
  const shares = BigInt(p.rec.stockDelta);
  const asset = findStock(p.rec.symbol)!;
  const entryExec = shares > 0n ? Number((usdgIn * 10n ** BigInt(asset.decimals) * 1_000_000n) / (shares * 10n ** BigInt(USDG.decimals))) / 1e6 : 0;
  const tp = p.takeProfitPct ?? null;
  const sl = p.stopLossPct ?? null;
  return {
    id: p.rec.hash,
    wallet: p.rec.wallet,
    symbol: p.rec.symbol,
    stockAddress: p.rec.stockAddress,
    status: "watching",
    prompt: p.prompt,
    openedAt: new Date().toISOString(),
    buyHash: p.rec.hash,
    via: p.rec.via ?? "direct",
    usdgIn: usdgIn.toString(),
    shares: shares.toString(),
    entryExec,
    entryRef: p.entryRef,
    refLabel: p.refLabel,
    takeProfitPct: tp,
    stopLossPct: sl,
    targetRef: p.entryRef && tp ? round2(p.entryRef * (1 + tp / 100)) : null,
    stopRef: p.entryRef && sl ? round2(p.entryRef * (1 - sl / 100)) : null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ flow */

export type TradeStep = "checking" | "approve" | "approve_wait" | "quote" | "sign" | "confirming" | "done";

export const STEP_TEXT: Record<"id" | "en", Record<TradeStep, string>> = {
  en: {
    checking: "Checking your balance and approval…",
    approve: "Step 1 · Approve in your wallet (exact amount only)…",
    approve_wait: "Waiting for the approval to confirm…",
    quote: "Getting the executable 0x quote…",
    sign: "Step 2 · Confirm the swap in your wallet…",
    confirming: "Waiting for Robinhood Chain to confirm…",
    done: "Confirmed on chain.",
  },
  id: {
    checking: "Memeriksa saldo dan approval…",
    approve: "Langkah 1 · Approve di wallet (hanya jumlah persis)…",
    approve_wait: "Menunggu approval terkonfirmasi…",
    quote: "Mengambil quote 0x yang bisa dieksekusi…",
    sign: "Langkah 2 · Konfirmasi swap di wallet…",
    confirming: "Menunggu konfirmasi Robinhood Chain…",
    done: "Terkonfirmasi on-chain.",
  },
};

/**
 * One real trade from the user's wallet: balance check → exact approval if needed →
 * firm quote → simulate + sign → receipt → record (amounts from Transfer logs).
 */
export async function runTrade(p: {
  account: string;
  asset: StockAsset;
  market: MarketInfo;
  side: Side;
  /** sell-token amount as a decimal string (USDG for buy, Stock Token for sell) */
  amount: string;
  amountUnits: bigint;
  slippageBps: number;
  onStep: (s: TradeStep, info?: { hash?: string; quote?: TradeQuote }) => void;
}): Promise<{ rec: TradeRecord; after: WalletState | null }> {
  const spender = spenderFor(p.market);
  p.onStep("checking");
  const before = await readWallet(p.account, p.asset, spender);
  const bal = p.side === "buy" ? before.usdg : before.stock;
  if (bal < p.amountUnits) {
    throw new Error(p.side === "buy" ? "Not enough USDG in this wallet for that amount." : `Not enough ${p.asset.symbol} in this wallet for that amount.`);
  }
  if (before.eth === 0n) throw new Error("This wallet has no ETH on Robinhood Chain to pay the network fee.");
  let approveHash: string | undefined;
  const allowance = p.side === "buy" ? before.usdgAllowance : before.stockAllowance;
  if (allowance < p.amountUnits) {
    p.onStep("approve");
    approveHash = await approveExact(p.account, p.side === "buy" ? USDG.address : p.asset.address, p.amountUnits, spender);
    p.onStep("approve_wait", { hash: approveHash });
    const r = await waitForFullReceipt(approveHash);
    if (!r.ok) throw new Error("The approval failed on chain. Nothing was swapped.");
  }
  p.onStep("quote");
  const q = await fetchQuote({ symbol: p.asset.symbol, side: p.side, amount: p.amount, taker: p.account, slippageBps: p.slippageBps, firm: true });
  if (!q.ok) throw new Error(q.error);
  if (!q.transaction) throw new Error("The quote came back without a transaction. Please try again.");
  p.onStep("sign", { quote: q });
  const hash = await sendSwap(p.account, q.transaction, spender);
  p.onStep("confirming", { hash, quote: q });
  const receipt = await waitForFullReceipt(hash);
  let after: WalletState | null = null;
  try {
    after = await readWallet(p.account, p.asset, spender);
  } catch {
    /* balances refresh later */
  }
  const rec = recordFromReceipt({ hash, wallet: p.account, side: p.side, asset: p.asset, receipt, quote: q, approveHash, before, after });
  saveTrade(rec);
  if (!receipt.ok) throw Object.assign(new Error("The swap reverted on chain. Your tokens did not move (only the network fee was spent)."), { rec });
  p.onStep("done", { hash, quote: q });
  return { rec, after };
}

/** Plain decimal string for a base-unit amount (no grouping), for the quote API. */
export const plainUnits = (v: bigint, decimals: number) => fromUnits(v, decimals, decimals).replace(/,/g, "");

/** Short two-tone chime for "target hit" (Web Audio; silent if the browser blocks audio). */
export function chime() {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.18);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    /* no audio */
  }
}
