/**
 * Covar Stock Trade — browser side.
 *
 * Reads balances and allowances straight from Robinhood Chain, asks our API for
 * quotes (the 0x key stays on the server), and has the user's wallet sign:
 *   check allowance → approve AllowanceHolder if needed → firm quote →
 *   simulate → sign swap → wait for receipt → read Transfer logs + balances.
 * Every trade is kept in this browser's history together with its proof.
 */
import { CHAINS } from "./chain";
import {
  ALLOWANCE_HOLDER,
  TRADE_CHAIN_ID,
  USDG,
  netTransfers,
  routerEvent,
  type MarketInfo,
  type RawLog,
  type Side,
  type StockAsset,
  type TradeError,
  type TradeQuote,
} from "./stockTrade";
import { SEL, calldata, encAddress, encUint, ethCall, explainError, injected, rpcFetch, sendTx, switchChain, withTimeout } from "./vaultTx";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TRADE_CHAIN = CHAINS[TRADE_CHAIN_ID];
export const txUrl = (hash: string) => `${TRADE_CHAIN.explorer}/tx/${hash}`;
export const tokenUrl = (address: string) => `${TRADE_CHAIN.explorer}/token/${address}`;
export const addressUrl = (address: string) => `${TRADE_CHAIN.explorer}/address/${address}`;

const word = (hex: string) => BigInt(hex && hex !== "0x" ? "0x" + hex.slice(2, 66) : "0x0");

export interface WalletState {
  usdg: bigint;
  stock: bigint;
  eth: bigint;
  /** allowances to the spender of the active route (CovarStockRouter or the 0x AllowanceHolder) */
  usdgAllowance: bigint;
  stockAllowance: bigint;
  spender: string;
  at: number;
}

/** The contract the user approves for this market: the Covar router when trades go through it. */
export const spenderFor = (m: MarketInfo | null | undefined) => (m?.route?.via === "router" && m.route.router ? m.route.router.address : ALLOWANCE_HOLDER);

export async function readWallet(account: string, asset: StockAsset, spender: string = ALLOWANCE_HOLDER): Promise<WalletState> {
  const bal = (token: string) => ethCall(token, calldata(SEL.balanceOf, encAddress(account)), TRADE_CHAIN_ID).then(word);
  const alw = (token: string) => ethCall(token, calldata(SEL.allowance, encAddress(account), encAddress(spender)), TRADE_CHAIN_ID).then(word);
  const ethBal = rpcFetch(TRADE_CHAIN.rpc, { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [account, "latest"] }, "ETH balance").then((r) => {
    if (r.error) throw new Error(r.error.message);
    return BigInt(String(r.result ?? "0x0"));
  });
  const [usdg, stock, eth, usdgAllowance, stockAllowance] = await Promise.all([bal(USDG.address), bal(asset.address), ethBal, alw(USDG.address), alw(asset.address)]);
  return { usdg, stock, eth, usdgAllowance, stockAllowance, spender, at: Date.now() };
}

export async function fetchMarket(symbol: string): Promise<MarketInfo> {
  const r = await fetch(`/api/trade/market?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error || "Couldn't load market data right now.");
  return j as MarketInfo;
}

export async function fetchQuote(p: { symbol: string; side: Side; amount: string; taker: string; slippageBps: number; firm: boolean }): Promise<TradeQuote | TradeError> {
  const qs = new URLSearchParams({ symbol: p.symbol, side: p.side, amount: p.amount, taker: p.taker, slippageBps: String(p.slippageBps), firm: p.firm ? "1" : "0" });
  try {
    const r = await fetch(`/api/trade/quote?${qs}`, { cache: "no-store" });
    return (await r.json()) as TradeQuote | TradeError;
  } catch {
    return { ok: false, code: "NETWORK", error: "Couldn't reach Covar. Check your connection and try again." };
  }
}

/**
 * Approve exactly `amount` of `token` to `spender`: the Covar router (router route) or
 * the 0x AllowanceHolder (direct route) — never to whatever a quote names.
 */
export async function approveExact(from: string, token: string, amount: bigint, spender: string = ALLOWANCE_HOLDER): Promise<string> {
  await ensureChain();
  return sendTx({ from, to: token, data: calldata(SEL.approve, encAddress(spender), encUint(amount)), chain: TRADE_CHAIN_ID });
}

export async function ensureChain(): Promise<void> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask (or Rabby) and reload this page.");
  const c = Number(BigInt(await eth.request({ method: "eth_chainId" })));
  if (c !== TRADE_CHAIN_ID) await switchChain(TRADE_CHAIN_ID);
}

const SWAP_REVERT_HINT =
  "This trade would fail right now (the price moved or the quote expired). Nothing was sent — get a new price and try again.";

/** Simulate the firm-quote transaction from the taker, then have the wallet sign and send it. */
export async function sendSwap(from: string, tx: NonNullable<TradeQuote["transaction"]>, expectedTo: string = ALLOWANCE_HOLDER): Promise<string> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  if (tx.to.toLowerCase() !== expectedTo.toLowerCase()) throw new Error("The transaction isn't addressed to the expected contract, so we stopped. Nothing was sent.");
  if (BigInt(tx.value || "0") !== 0n) throw new Error("This trade should not send ETH, so we stopped. Nothing was sent.");
  await ensureChain();
  try {
    await ethCall(tx.to, tx.data, TRADE_CHAIN_ID, from);
  } catch (e) {
    const msg = explainError(e);
    // vault-specific hints don't apply to swaps; keep balance/allowance ones
    throw new Error(/USDG|approv|balance/i.test(msg) ? msg : SWAP_REVERT_HINT);
  }
  const gas = tx.gas ? "0x" + ((BigInt(tx.gas) * 12n) / 10n).toString(16) : undefined;
  try {
    return await eth.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data, value: "0x0", ...(gas ? { gas } : {}) }] });
  } catch (e) {
    throw new Error(explainError(e));
  }
}

export interface FullReceipt {
  ok: boolean;
  blockNumber: number;
  logs: RawLog[];
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  to: string;
  from: string;
}

/** Poll the chain (not the wallet) for the receipt, so the logs come from Robinhood Chain itself. */
export async function waitForFullReceipt(hash: string, timeoutMs = 180_000): Promise<FullReceipt> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await withTimeout(
      rpcFetch(TRADE_CHAIN.rpc, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }, "receipt"),
      15_000,
      "receipt",
    ).catch(() => null);
    const x: any = r?.result;
    if (x) {
      return {
        ok: x.status === "0x1",
        blockNumber: Number(BigInt(x.blockNumber)),
        logs: (x.logs ?? []).map((l: any) => ({ address: l.address, topics: l.topics, data: l.data })),
        gasUsed: BigInt(x.gasUsed ?? "0x0"),
        effectiveGasPrice: BigInt(x.effectiveGasPrice ?? "0x0"),
        to: String(x.to ?? ""),
        from: String(x.from ?? ""),
      };
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("The transaction is taking longer than usual to confirm. Check the explorer link — it may still go through.");
}

/* ----------------------------------------------------------------- history */

export interface TradeRecord {
  hash: string;
  wallet: string;
  side: Side;
  symbol: string;
  stockAddress: string;
  status: "confirmed" | "failed";
  block: number;
  at: string;
  /** actual movement from the receipt's Transfer logs (base units, signed, as strings) */
  usdgDelta: string;
  stockDelta: string;
  /** what the quote promised */
  quotedBuy: string;
  minBuy: string | null;
  price: number;
  gasCostWei: string;
  approveHash?: string;
  /** "router" = through CovarStockRouter */
  via?: "router" | "direct";
  /** the router's StockPurchased / StockSold event, decoded from the receipt (strings) */
  covarEvent?: { kind: "StockPurchased" | "StockSold"; router: string; usdg: string; stock: string; fee: string } | null;
  /** balances after the trade, read from chain */
  after?: { usdg: string; stock: string };
  before?: { usdg: string; stock: string };
}

const KEY = "covar.stockTrades.v1";

export function loadHistory(wallet?: string | null): TradeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const all: TradeRecord[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    return (wallet ? all.filter((t) => t.wallet.toLowerCase() === wallet.toLowerCase()) : all).sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

export function saveTrade(t: TradeRecord) {
  if (typeof window === "undefined") return;
  try {
    const all: TradeRecord[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    const next = [t, ...all.filter((x) => x.hash.toLowerCase() !== t.hash.toLowerCase())].slice(0, 200);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked: the trade is still on chain */
  }
}

/** Build the record from a receipt: amounts are what actually moved, not what was quoted. */
export function recordFromReceipt(p: {
  hash: string;
  wallet: string;
  side: Side;
  asset: StockAsset;
  receipt: FullReceipt;
  quote: TradeQuote;
  approveHash?: string;
  before?: WalletState | null;
  after?: WalletState | null;
}): TradeRecord {
  const net = netTransfers(p.receipt.logs, p.wallet);
  const ev = p.quote.via === "router" ? routerEvent(p.receipt.logs, p.quote.spender) : null;
  const covarEvent = ev && ev.trader.toLowerCase() === p.wallet.toLowerCase() && ev.stock.toLowerCase() === p.asset.address.toLowerCase()
    ? { kind: ev.kind, router: ev.router, usdg: String(ev.usdg), stock: String(ev.stockAmount), fee: String(ev.fee) }
    : null;
  return {
    hash: p.hash,
    wallet: p.wallet,
    side: p.side,
    symbol: p.asset.symbol,
    stockAddress: p.asset.address,
    status: p.receipt.ok ? "confirmed" : "failed",
    block: p.receipt.blockNumber,
    at: new Date().toISOString(),
    usdgDelta: String(net[USDG.address.toLowerCase()] ?? 0n),
    stockDelta: String(net[p.asset.address.toLowerCase()] ?? 0n),
    quotedBuy: p.quote.buyAmount,
    minBuy: p.quote.minBuyAmount,
    price: p.quote.price,
    gasCostWei: String(p.receipt.gasUsed * p.receipt.effectiveGasPrice),
    approveHash: p.approveHash,
    via: p.quote.via,
    covarEvent,
    before: p.before ? { usdg: String(p.before.usdg), stock: String(p.before.stock) } : undefined,
    after: p.after ? { usdg: String(p.after.usdg), stock: String(p.after.stock) } : undefined,
  };
}

const ATTEST_KEY = "covar.stockTrade.attested.v1";
export const hasAttested = () => typeof window !== "undefined" && localStorage.getItem(ATTEST_KEY) === "1";
export const setAttested = (v: boolean) => {
  if (typeof window === "undefined") return;
  if (v) localStorage.setItem(ATTEST_KEY, "1");
  else localStorage.removeItem(ATTEST_KEY);
};
