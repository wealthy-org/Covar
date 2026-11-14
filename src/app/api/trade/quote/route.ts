import { NextResponse } from "next/server";
import { findStock } from "@/lib/stockTrade";
import { clientKey, getTradeQuote, rateLimited, regionVerdict } from "@/lib/stockTradeServer";

/**
 * GET /api/trade/quote?symbol=NVDA&side=buy|sell&amount=10&taker=0x…&slippageBps=100&firm=0|1
 *
 * firm=0 → indicative price (no transaction). firm=1 → executable quote with the
 * transaction the wallet will sign, validated server-side first (target is the
 * 0x AllowanceHolder, tokens and amount match, no ETH value).
 * The region block is enforced here, not only in the page.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const symbol = q.get("symbol") || "";
  const asset = findStock(symbol);
  const region = regionVerdict(req.headers, asset?.symbol ?? "Stock Tokens");
  if (!region.allowed) {
    return NextResponse.json({ ok: false, code: "REGION", error: region.message }, { status: 451 });
  }
  if (rateLimited(clientKey(req.headers))) {
    return NextResponse.json({ ok: false, code: "RATE_LIMITED", error: "Too many price requests. Wait a few seconds and try again." }, { status: 429 });
  }
  try {
    const result = await getTradeQuote({
      symbol,
      side: q.get("side") === "sell" ? "sell" : "buy",
      amount: q.get("amount") || "",
      taker: q.get("taker") || "",
      slippageBps: q.get("slippageBps") ? Number(q.get("slippageBps")) : undefined,
      firm: q.get("firm") === "1",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[trade/quote]", (e as Error).message);
    return NextResponse.json({ ok: false, code: "INTERNAL", error: "Couldn't get a price right now. Please try again in a moment." }, { status: 500 });
  }
}
