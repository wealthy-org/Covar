import { NextResponse } from "next/server";

/**
 * GET /api/vault/activity?address=0x…: one investor's vault events, straight
 * from the indexer (deposit, withdrawal request, positions closed, settled,
 * claimed — each with its tx hash and block time). Vault events are public
 * on-chain data, so no session is needed. The portfolio ledger uses this to
 * fill in confirmed transactions this device never recorded (another tab,
 * another device, a lost sync) — it never adds anything the chain doesn't have.
 */
export const dynamic = "force-dynamic";

const INDEXER_URL = (process.env.INDEXER_URL || "http://127.0.0.1:4016").replace(/\/$/, "");

export async function GET(req: Request) {
  const vault = process.env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS;
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ ok: false, error: "address must be a 0x address" }, { status: 400 });
  if (!vault) return NextResponse.json({ ok: false, configured: false }, { headers: { "cache-control": "no-store" } });
  try {
    const res = await fetch(`${INDEXER_URL}/events?investor=${address}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as { events?: unknown[]; vault?: string | null };
    if (!res.ok || !Array.isArray(body.events)) return NextResponse.json({ ok: false, error: "indexer has no events" }, { status: 503 });
    if (body.vault?.toLowerCase() !== vault.toLowerCase()) {
      return NextResponse.json({ ok: false, error: `indexer watches ${body.vault}, site uses ${vault}` }, { status: 503 });
    }
    return NextResponse.json({ ok: true, vault, events: body.events }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "indexer unreachable" }, { status: 503 });
  }
}
