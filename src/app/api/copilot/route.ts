import { NextResponse } from "next/server";
import { interpretDraft } from "@/lib/copilot";

/**
 * Copilot interpreter. The model (when configured) only proposes a bounded
 * interpretation; the deterministic strategy engine encodes, validates and clamps
 * it server-side. `engine` travels with the response so the UI labels exactly
 * which machinery answered.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let prompt = "";
  try {
    const body = (await req.json()) as { prompt?: string };
    prompt = String(body.prompt ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body" }, { status: 400 });
  }
  if (!prompt || prompt.length > 2000) {
    return NextResponse.json({ ok: false, error: "A prompt of 1–2000 characters is required." }, { status: 400 });
  }
  const result = await interpretDraft(prompt);
  return NextResponse.json(result);
}
