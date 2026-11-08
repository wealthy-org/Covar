import { NextResponse } from "next/server";
import { logout, sameOrigin, sessionCookie } from "@/lib/auth";

/** Revoke the session server-side and clear the cookie. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  await logout(req);
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", sessionCookie("", req, 0));
  return res;
}
