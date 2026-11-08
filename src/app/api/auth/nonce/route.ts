import { NextResponse } from "next/server";
import { AuthError, issueNonce, rateLimited, sameOrigin } from "@/lib/auth";

/** Step 1 of Sign-In with Ethereum: a one-time nonce and the exact text to sign. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  if (rateLimited(req, "nonce", 20)) return NextResponse.json({ ok: false, error: "too many sign-in attempts — wait a minute" }, { status: 429 });
  try {
    const body = (await req.json().catch(() => ({}))) as { address?: string; chainId?: number };
    const out = await issueNonce(req, String(body.address ?? ""), Number(body.chainId));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}
