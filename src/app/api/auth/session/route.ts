import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

/** Who is signed in (from the HttpOnly cookie). */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser(req);
  return NextResponse.json({ ok: true, user });
}
