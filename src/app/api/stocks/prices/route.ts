import { NextResponse } from "next/server";
import { getStockPrices } from "@/lib/stockPrices";

/**
 * GET /api/stocks/prices?symbols=NVDA,TSLA,AAPL
 *
 * Live share prices (Yahoo Finance, 5 s cache) with a per-symbol Chainlink
 * fallback. When the US market is closed every price is labelled
 * "Market Closed · Using Last Close". Always 200 — a symbol nobody can price is
 * returned with price null and a reason, never a server error.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") || "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  try {
    const body = await getStockPrices(symbols.length ? symbols : undefined);
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[stocks/prices]", (e as Error).message);
    return NextResponse.json({ ok: true, source: "none", prices: {}, fetchedAt: Date.now() });
  }
}
