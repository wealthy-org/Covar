import { NextResponse } from "next/server";

/**
 * Server-side proxy to the execution plane.
 *
 * The browser never talks to the order services directly: they bind to
 * localhost ports inside the deployment, and only this route can reach them.
 * If the plane is not running the route reports that honestly instead of
 * inventing state.
 */
const EXEC_URL = process.env.EXEC_URL ?? "http://127.0.0.1:4010";
export const dynamic = "force-dynamic";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${EXEC_URL}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export async function GET() {
  try {
    const [state, journal] = await Promise.all([call("/state"), call("/journal")]);
    return NextResponse.json({ ok: true, state, journal, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, target: EXEC_URL, at: new Date().toISOString() },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  let body: { action?: string; paused?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine for `recover` */
  }
  try {
    switch (body.action) {
      case "recover":
        return NextResponse.json({ ok: true, result: await call("/recover", { method: "POST" }) });
      case "pause":
        return NextResponse.json({ ok: true, result: await call("/pause", { method: "POST", body: JSON.stringify({ paused: !!body.paused }) }) });
      case "tick":
        return NextResponse.json({ ok: true, result: await call("/tick", { method: "POST" }) });
      default:
        return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
