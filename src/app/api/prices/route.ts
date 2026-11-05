import { NextResponse } from "next/server";
import { getPrices } from "@/lib/prices";

/**
 * Server-side price proxy. The browser never calls Hyperliquid/Coinbase directly.
 * A failure is surfaced as `ok:false` — the UI then says "unavailable" and practice
 * falls back to simulated ticks rather than displaying invented prices.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getPrices();
  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
