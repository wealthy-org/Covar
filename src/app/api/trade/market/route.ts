import { NextResponse } from "next/server";
import { STOCKS, findStock } from "@/lib/stockTrade";
import { marketInfo } from "@/lib/stockTradeServer";

/**
 * Asset identity, reference prices and region status for one Stock Token.
 * Reference prices (Robinhood API, Chainlink) are for context only — the
 * execution price always comes from a quote for the exact trade.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") || STOCKS[0].symbol;
  const asset = findStock(symbol);
  if (!asset) return NextResponse.json({ ok: false, code: "ASSET", error: "Unknown asset." }, { status: 404 });
  try {
    const info = await marketInfo(asset, req.headers);
    return NextResponse.json(info, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[trade/market]", (e as Error).message);
    return NextResponse.json({ ok: false, code: "UPSTREAM", error: "Couldn't load market data right now." }, { status: 502 });
  }
}
