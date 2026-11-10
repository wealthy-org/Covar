"use client";

import { useEffect, useState } from "react";
import type { PriceSnapshot } from "./prices";

/**
 * Polls our own /api/prices route. When the feed is down the snapshot says so and
 * practice stays on simulated ticks — no invented prices reach the ledger.
 */
export function usePrices(intervalMs = 5000) {
  const [snapshot, setSnapshot] = useState<PriceSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/prices", { cache: "no-store" });
        const json = (await res.json()) as PriceSnapshot;
        if (!cancelled) setSnapshot(json);
      } catch {
        if (!cancelled)
          setSnapshot({
            ok: false,
            source: "none",
            at: new Date().toISOString(),
            prices: {},
            stale: false,
            error: "the app could not reach its own price route",
          });
      }
    }

    void load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);

  return snapshot;
}

/** MARKET_SYMBOL lookup, kept here so client code does not import the server module. */
export const MARKET_TO_SYMBOL: Record<string, string> = {
  "BTC-PERP": "BTC",
  "ETH-PERP": "ETH",
  "SOL-PERP": "SOL",
  "HYPE-PERP": "HYPE",
};

export function priceFor(snapshot: PriceSnapshot | null, market: string): number | undefined {
  if (!snapshot?.ok) return undefined;
  const symbol = MARKET_TO_SYMBOL[market];
  return symbol ? snapshot.prices[symbol] : undefined;
}

const LABEL: Record<PriceSnapshot["source"], string> = {
  lighter: "Lighter perps · Robinhood Chain",
  hyperliquid: "Hyperliquid perp mids (fallback)",
  coinbase: "Coinbase spot (fallback)",
  none: "unavailable",
};
/** Short venue name for badges ("LIVE MARKS · LIGHTER"). */
export const VENUE_SHORT: Record<PriceSnapshot["source"], string> = {
  lighter: "Lighter",
  hyperliquid: "Hyperliquid",
  coinbase: "Coinbase",
  none: "—",
};

export function sourceLabel(snapshot: PriceSnapshot | null): string {
  if (!snapshot) return "connecting…";
  if (snapshot.ok) return LABEL[snapshot.source];
  if (snapshot.stale) return "stale cache";
  return "unavailable";
}

export function bookFor(snapshot: PriceSnapshot | null, market: string): { bid: number; ask: number } | undefined {
  if (!snapshot?.ok) return undefined;
  const symbol = MARKET_TO_SYMBOL[market];
  return symbol ? snapshot.books?.[symbol] : undefined;
}

/** Feed freshness: a snapshot older than this is shown as stale, not live. */
export const STALE_AFTER_MS = 15_000;
