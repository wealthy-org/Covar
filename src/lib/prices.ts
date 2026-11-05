/**
 * Market data adapter.
 *
 * Covar's markets are perpetuals (BTC/ETH/SOL/HYPE-PERP), so the primary source is
 * Hyperliquid's public mids endpoint — the same instrument type, no key required.
 * Coinbase spot is the fallback if that host is unreachable or geo-blocked.
 *
 * This module is server-only on purpose: the app must not call third-party APIs
 * from the browser (sandboxed previews have no network, and a browser fetch would
 * leak the user's request pattern to a third party).
 */

export type PriceSource = "hyperliquid" | "coinbase" | "none";

export interface PriceSnapshot {
  ok: boolean;
  source: PriceSource;
  /** ISO time the numbers were fetched. */
  at: string;
  /** Underlying symbol → USD price. */
  prices: Record<string, number>;
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

const HYPERLIQUID = "https://api.hyperliquid.xyz/info";
const COINBASE = "https://api.coinbase.com/v2/prices";
const TIMEOUT_MS = 4000;

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);
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
const CACHE_MS = 5_000;

/** Cached snapshot. Never throws: an outage is reported, not hidden. */
export async function getPrices(): Promise<PriceSnapshot> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  for (const [source, fn] of [
    ["hyperliquid", fromHyperliquid],
    ["coinbase", fromCoinbase],
  ] as const) {
    try {
      const prices = await fn();
      cache = { ok: true, source, at: new Date().toISOString(), prices, stale: false };
      cacheAt = now;
      return cache;
    } catch (err) {
      if (source === "coinbase") {
        const error = (err as Error).message;
        // Keep the last good numbers, but say they are stale — never pretend they are live.
        if (cache) {
          cache = { ...cache, ok: false, stale: true, error };
          return cache;
        }
        return { ok: false, source: "none", at: new Date().toISOString(), prices: {}, stale: false, error };
      }
    }
  }
  return { ok: false, source: "none", at: new Date().toISOString(), prices: {}, stale: false, error: "no source reachable" };
}

export const priceLabel = (s: PriceSnapshot) =>
  s.ok ? `${s.source === "hyperliquid" ? "Hyperliquid perp mids" : "Coinbase spot"}` : s.stale ? "stale cache" : "unavailable";
