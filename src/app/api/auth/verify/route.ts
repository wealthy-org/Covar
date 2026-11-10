import { NextResponse } from "next/server";
import { AuthError, rateLimited, sameOrigin, sessionCookie, verifyLogin } from "@/lib/auth";

/** Step 2 of Sign-In with Ethereum: verify the signature, open a session. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  if (rateLimited(req, "verify", 20)) return NextResponse.json({ ok: false, error: "too many sign-in attempts — wait a minute" }, { status: 429 });
  try {
    const body = (await req.json().catch(() => ({}))) as { message?: string; signature?: string };
    const s = await verifyLogin(req, String(body.message ?? ""), String(body.signature ?? ""));
    const res = NextResponse.json({ ok: true, user: { address: s.address, chainId: s.chainId, expiresAt: s.expiresAt.toISOString() } });
    res.headers.append("set-cookie", sessionCookie(s.token, req, Math.floor((s.expiresAt.getTime() - Date.now()) / 1000)));
    return res;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    // database or server fault: log the detail, never show it to the user
    console.error("[auth]", e);
    return NextResponse.json({ ok: false, error: "Sign-in is temporarily unavailable. Please try again in a few minutes." }, { status: 503 });
  }
}
