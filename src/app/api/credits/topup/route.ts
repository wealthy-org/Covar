import { NextResponse } from "next/server";
import { currentUser, rateLimited, sameOrigin } from "@/lib/auth";
import { creditTopup, microToUsd, TopupError } from "@/lib/credits";

/**
 * POST /api/credits/topup { txHash }: credit a USDG transfer to the credits
 * treasury. The server reads the receipt itself; the client's claim of an amount
 * is never trusted. Idempotent per transfer.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-origin request refused." }, { status: 403 });
  if (rateLimited(req, "credits-topup", 20)) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ ok: false, auth: "required", error: "Sign in with your wallet first." }, { status: 401 });
  let txHash = "";
  try {
    txHash = String(((await req.json()) as { txHash?: string }).txHash ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body" }, { status: 400 });
  }
  try {
    const r = await creditTopup(user.address, txHash);
    return NextResponse.json({ ok: true, creditedUsd: microToUsd(r.credited), alreadyCreditedUsd: microToUsd(r.already), balanceUsd: microToUsd(r.balance) });
  } catch (err) {
    if (err instanceof TopupError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: `Could not verify the transfer: ${(err as Error).message}` }, { status: 502 });
  }
}
