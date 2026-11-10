/**
 * Market data adapter.
 *
 * The brief's market service is Lighter: agents trade Lighter perpetuals on Robinhood
 * Chain, so practice marks come from the same venue's public market endpoints
 * (mark price + top of the order book, no key required). Read-only: nothing here can
 * place an order. Fallbacks are labelled, never blended:
 *   1. Lighter perps · Robinhood Chain  (venue-native — the brief's source)
 *   2. Hyperliquid perp mids            (same instrument type, used only if Lighter is unreachable)
 *   3. Coinbase spot                    (last resort)
 *
 * This module is server-only on purpose: the app must not call third-party APIs
 * from the browser (sandboxed previews have no network, and a browser fetch would
 * leak the user's request pattern to a third party).
 */

export type PriceSource = "lighter" | "hyperliquid" | "coinbase" | "none";

export interface BookTop {
  bid: number;
  ask: number;
}

export interface PriceSnapshot {
  ok: boolean;
  source: PriceSource;
  /** ISO time the numbers were fetched. */
  at: string;
  /** Underlying symbol → USD price (Lighter: mark price; Hyperliquid: mid; Coinbase: spot). */
  prices: Record<string, number>;
  /** Best bid / best ask per symbol, when the source exposes its order book (Lighter only). */
  books?: Record<string, BookTop>;
  /** True when the numbers came from cache because a refresh failed. */
  stale: boolean;
  error?: string;
}

/** Market id used across the app → underlying symbol at the venue. */
export const MARKET_SYMBOL: Record<string, string> = {
  "BTC-PERP": "BTC",
  "ETH-PERP": "ETH",
  "SOL-PERP": "SOL",
  "HYPE-PERP": "HYPE",
};

export const SYMBOLS = ["BTC", "ETH", "SOL", "HYPE"] as const;

/** Lighter's Robinhood Chain deployment (public market data). Override for another Lighter host. */
const LIGHTER = (process.env.LIGHTER_MARKET_URL || "https://api.rh.lighter.xyz").replace(/\/$/, "");
const HYPERLIQUID = "https://api.hyperliquid.xyz/info";
const COINBASE = "https://api.coinbase.com/v2/prices";
const TIMEOUT_MS = 4000;

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);
}

type Fetched = { prices: Record<string, number>; books?: Record<string, BookTop> };

async function fromLighter(): Promise<Fetched> {
  const res = await withTimeout(fetch(`${LIGHTER}/api/v1/orderBookDetails`, { cache: "no-store" }));
  if (!res.ok) throw new Error(`lighter → HTTP ${res.status}`);
  const json = (await res.json()) as {
    order_book_details?: { symbol?: string; market_id?: number; market_type?: string; status?: string; mark_price?: string | number; last_trade_price?: string | number }[];
  };
  const prices: Record<string, number> = {};
  const ids: Record<string, number> = {};
  for (const d of json.order_book_details ?? []) {
    const sym = String(d.symbol ?? "").toUpperCase();
    if (!(SYMBOLS as readonly string[]).includes(sym)) continue;
    if (d.market_type && d.market_type !== "perp") continue;
    if (d.status && d.status !== "active") continue;
    const v = Number(d.mark_price) || Number(d.last_trade_price);
    if (Number.isFinite(v) && v > 0) {
      prices[sym] = v;
      ids[sym] = Number(d.market_id);
    }
  }
  if (!Object.keys(prices).length) throw new Error("lighter returned no usable marks");

  // top of book per market; a missing book only drops the spread, never the mark
  const books: Record<string, BookTop> = {};
  await Promise.all(
    Object.entries(ids).map(async ([sym, id]) => {
      try {
        const r = await withTimeout(fetch(`${LIGHTER}/api/v1/orderBookOrders?market_id=${id}&limit=1`, { cache: "no-store" }));
        if (!r.ok) return;
        const b = (await r.json()) as { bids?: { price?: string }[]; asks?: { price?: string }[] };
        const bid = Number(b.bids?.[0]?.price);
        const ask = Number(b.asks?.[0]?.price);
        if (bid > 0 && ask > 0 && ask >= bid) books[sym] = { bid, ask };
      } catch {
        /* book unavailable — mark still stands */
      }
    })
  );
  return { prices, books };
}

async function fromHyperliquid(): Promise<Record<string, number>> {
  const res = await withTimeout(
    fetch(HYPERLIQUID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      cache: "no-store",
    })
  );
  if (!res.ok) throw new Error(`hyperliquid → HTTP ${res.status}`);
  const mids = (await res.json()) as Record<string, string>;
  const out: Record<string, number> = {};
  for (const s of SYMBOLS) {
    const v = Number(mids[s]);
    if (Number.isFinite(v) && v > 0) out[s] = v;
  }
  if (!Object.keys(out).length) throw new Error("hyperliquid returned no usable mids");
  return out;
}

async function fromCoinbase(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    SYMBOLS.map(async (s) => {
      const res = await withTimeout(fetch(`${COINBASE}/${s}-USD/spot`, { cache: "no-store" }));
      if (!res.ok) throw new Error(`coinbase ${s} → HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { amount?: string } };
      const v = Number(json.data?.amount);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`coinbase ${s} → bad payload`);
      return [s, v] as const;
    })
  );
  return Object.fromEntries(entries);
}

let cache: PriceSnapshot | null = null;
let cacheAt = 0;
const CACHE_MS = 2_000;

const SOURCES: [Exclude<PriceSource, "none">, () => Promise<Fetched>][] = [
  ["lighter", fromLighter],
  ["hyperliquid", async () => ({ prices: await fromHyperliquid() })],
  ["coinbase", async () => ({ prices: await fromCoinbase() })],
];

/** Cached snapshot. Never throws: an outage is reported, not hidden. */
export async function getPrices(): Promise<PriceSnapshot> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const errors: string[] = [];
  for (const [source, fn] of SOURCES) {
    try {
      const { prices, books } = await fn();
      cache = { ok: true, source, at: new Date().toISOString(), prices, ...(books && Object.keys(books).length ? { books } : {}), stale: false };
      cacheAt = now;
      return cache;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const error = errors.join("; ") || "no source reachable";
  // Keep the last good numbers, but say they are stale — never pretend they are live.
  if (cache) {
    cache = { ...cache, ok: false, stale: true, error };
    return cache;
  }
  return { ok: false, source: "none", at: new Date().toISOString(), prices: {}, stale: false, error };
}

export const SOURCE_LABEL: Record<PriceSource, string> = {
  lighter: "Lighter perps · Robinhood Chain",
  hyperliquid: "Hyperliquid perp mids (fallback)",
  coinbase: "Coinbase spot (fallback)",
  none: "unavailable",
};

export const priceLabel = (s: PriceSnapshot) => (s.ok ? SOURCE_LABEL[s.source] : s.stale ? "stale cache" : "unavailable");
