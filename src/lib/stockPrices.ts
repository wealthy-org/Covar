/**
 * Live US stock prices for the Instant Stock Agent — server only.
 *
 * Primary source: Yahoo Finance chart API (no key), cached 5 s per instance with
 * in-flight de-duplication so a burst of watchers costs one upstream call.
 * Fallback per symbol: the token's Chainlink "Robinhood <SYM> / USD" feed on
 * Robinhood Chain (on-chain, no key). Never a 500: a symbol that no source can
 * price comes back with price null and a reason.
 *
 * These are prices of the underlying SHARE (reference, trigger). What a user pays
 * or receives is always the 0x quote for their exact trade.
 */
import { STOCKS, findStock, type StockAsset } from "./stockTrade";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { chainlinkPrice } from "./stockTradeServer";

export type MarketState = "open" | "pre" | "post" | "closed";

export interface StockPrice {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  currency: string;
  /** "yahoo" live/last close, or "chainlink" fallback */
  source: "yahoo" | "chainlink" | null;
  marketState: MarketState | null;
  /** human label, e.g. "Live" or "Market Closed · Using Last Close" */
  label: string;
  /** unix ms of the price itself (exchange time) */
  asOf: number | null;
  error?: string;
}

export interface PricesResponse {
  ok: true;
  source: "yahoo_live" | "yahoo_cached" | "mixed" | "chainlink" | "none";
  prices: Record<string, StockPrice>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: StockPrice }>();
let inflight: Promise<void> | null = null;
let inflightKey = "";

const CLOSED_LABEL = "Market Closed · Using Last Close";

export function marketStateAt(nowSec: number, period: any): MarketState {
  const inside = (p: any) => p && typeof p.start === "number" && typeof p.end === "number" && nowSec >= p.start && nowSec < p.end;
  if (inside(period?.regular)) return "open";
  if (inside(period?.pre)) return "pre";
  if (inside(period?.post)) return "post";
  return "closed";
}

export function labelFor(state: MarketState | null, source: StockPrice["source"]): string {
  if (source === "chainlink") return state === "open" ? "Chainlink feed (Yahoo unavailable)" : `${CLOSED_LABEL} · Chainlink`;
  if (state === "open") return "Live";
  if (state === "pre") return "Pre-market · Using Last Close";
  if (state === "post") return "After hours · Using Last Close";
  return CLOSED_LABEL;
}

async function fromYahoo(symbol: string): Promise<StockPrice> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 CovarMarketData/1.0", accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
  const json: any = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error("yahoo: no price");
  const price = Number(meta.regularMarketPrice);
  const prev = typeof meta.previousClose === "number" ? meta.previousClose : typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null;
  const state = marketStateAt(Math.floor(Date.now() / 1000), meta.currentTradingPeriod);
  return {
    symbol,
    price,
    previousClose: prev,
    changePct: prev ? Math.round(((price - prev) / prev) * 10_000) / 100 : null,
    currency: String(meta.currency || "USD"),
    source: "yahoo",
    marketState: state,
    label: labelFor(state, "yahoo"),
    asOf: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : null,
  };
}

async function fromChainlink(asset: StockAsset, reason: string): Promise<StockPrice> {
  try {
    const cl = await chainlinkPrice(asset);
    if (cl.price) {
      return {
        symbol: asset.symbol,
        price: cl.price,
        previousClose: null,
        changePct: null,
        currency: "USD",
        source: "chainlink",
        marketState: null,
        label: labelFor(null, "chainlink"),
        asOf: cl.updatedAt ? cl.updatedAt * 1000 : null,
      };
    }
  } catch {
    /* fall through */
  }
  return { symbol: asset.symbol, price: null, previousClose: null, changePct: null, currency: "USD", source: null, marketState: null, label: "Price unavailable", asOf: null, error: reason };
}

async function refresh(assets: StockAsset[]) {
  await Promise.all(
    assets.map(async (a) => {
      let value: StockPrice;
      try {
        value = await fromYahoo(a.symbol);
      } catch (e) {
        console.warn(`[stocks/prices] ${a.symbol}: ${(e as Error).message} — using Chainlink`);
        value = await fromChainlink(a, "Live price source unavailable");
      }
      if (value.price !== null || !cache.has(a.symbol)) cache.set(a.symbol, { at: Date.now(), value });
    })
  );
}

/** Prices for the given symbols (default: every known Stock Token). */
export async function getStockPrices(symbols?: string[]): Promise<PricesResponse> {
  const assets = (symbols?.length ? symbols.map(findStock).filter((a): a is StockAsset => !!a) : STOCKS).slice(0, 30);
  const now = Date.now();
  const stale = assets.filter((a) => {
    const c = cache.get(a.symbol);
    return !c || now - c.at >= CACHE_TTL_MS;
  });
  let fresh = false;
  if (stale.length) {
    const key = stale.map((a) => a.symbol).join(",");
    if (!inflight || inflightKey !== key) {
      inflightKey = key;
      inflight = refresh(stale).finally(() => {
        inflight = null;
      });
    }
    await inflight;
    fresh = true;
  }
  const prices: Record<string, StockPrice> = {};
  for (const a of assets) {
    const c = cache.get(a.symbol);
    prices[a.symbol] = c?.value ?? { symbol: a.symbol, price: null, previousClose: null, changePct: null, currency: "USD", source: null, marketState: null, label: "Price unavailable", asOf: null, error: "No price yet" };
  }
  const sources = new Set(Object.values(prices).map((p) => p.source));
  const source: PricesResponse["source"] =
    sources.size === 1 && sources.has("yahoo") ? (fresh ? "yahoo_live" : "yahoo_cached") : sources.size === 1 && sources.has("chainlink") ? "chainlink" : sources.size === 1 && sources.has(null) ? "none" : "mixed";
  return { ok: true, source, prices, fetchedAt: now };
}

/** test hook */
export function _resetPriceCache() {
  cache.clear();
  inflight = null;
}
