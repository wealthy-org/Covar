import { NextResponse } from "next/server";

/**
 * GET /api/vault/summary: the deployed vault's on-chain summary (package 3.6).
 *
 * Proxies the indexer's /summary (INDEXER_URL, server-side only). It never
 * fabricates a fallback: with no vault configured it says so, and with the
 * indexer down it returns 503 and the UI shows "unavailable", not numbers.
 */
export const dynamic = "force-dynamic";

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://127.0.0.1:4016").replace(/\/$/, "");

export async function GET() {
  const vault = process.env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS;
  if (!vault) return NextResponse.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  try {
    const res = await fetch(`${INDEXER_URL}/summary`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as { ok?: boolean; vault?: string };
    if (!res.ok || !body.ok) return NextResponse.json({ configured: true, ok: false, error: "indexer has no summary yet" }, { status: 503 });
    // the indexer must be watching the same vault the site points investors at
    if (body.vault?.toLowerCase() !== vault.toLowerCase()) {
      return NextResponse.json({ configured: true, ok: false, error: `indexer watches ${body.vault}, site uses ${vault}` }, { status: 503 });
    }
    return NextResponse.json({ configured: true, ...body }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ configured: true, ok: false, error: "indexer unreachable" }, { status: 503 });
  }
}
