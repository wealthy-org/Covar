import { NextResponse } from "next/server";
import { copilotProvider, interpretDraft } from "@/lib/copilot";
import { currentUser, rateLimited, sameOrigin } from "@/lib/auth";
import { balanceOf, creditsMode, microToUsd, pricing, priceUsage, recordUsage, reserveFor, withOwnerLock } from "@/lib/credits";

/**
 * Copilot interpreter. The model (when configured) only proposes a bounded
 * interpretation; the deterministic strategy engine encodes, validates and clamps
 * it server-side. `engine` travels with the response so the UI labels exactly
 * which machinery answered.
 *
 * Credits (3.7): with CREDITS_MODE=enforce a model call needs a signed-in wallet
 * whose credit balance covers a worst-case call. The call is then debited at its
 * real token usage. Without credits, the free rules parser answers and says why.
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

  const provider = copilotProvider();
  if (provider.kind === "none" || creditsMode() === "off") {
    return NextResponse.json(await interpretDraft(prompt));
  }

  // ---- credits enforced ----
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-origin request refused." }, { status: 403 });
  if (rateLimited(req, "copilot", 20)) return NextResponse.json({ ok: false, error: "Too many requests, slow down." }, { status: 429 });
  const user = await currentUser(req);
  if (!user) return NextResponse.json(await interpretDraft(prompt, { skipModel: "Sign in with your wallet and add Copilot credits to use the language model." }));
  const p = pricing();
  const owner = user.address;

  const result = await withOwnerLock(owner, async () => {
    const balance = await balanceOf(owner);
    const reserve = reserveFor(p);
    if (balance < reserve) {
      return interpretDraft(prompt, {
        skipModel: `Not enough Copilot credits (balance $${microToUsd(balance).toFixed(4)}, a call can cost up to $${microToUsd(reserve).toFixed(4)}). Top up in Portfolio.`,
      });
    }
    const res = await interpretDraft(prompt);
    if (res.usage) {
      let priced = priceUsage(res.usage, p);
      let basis: string = priced?.basis ?? "";
      if (!priced) {
        // no price table and no provider-reported cost: bill the worst case rather than nothing, and say so
        priced = { providerCost: reserve, appFee: 0n, total: reserve, basis: "price-table" };
        basis = "worst-case (no price configured)";
      }
      await recordUsage(owner, res.usage, priced, basis === priced.basis ? undefined : basis);
      res.credits = { chargedUsd: microToUsd(priced.total), balanceUsd: microToUsd(await balanceOf(owner)), basis };
    } else if (res.engine === "model") {
      // a completed call that reported no usage is billed at the worst case
      await recordUsage(owner, { provider: provider.label, model: provider.model, tokensIn: 0, tokensOut: 0 }, { providerCost: reserve, appFee: 0n, total: reserve, basis: "price-table" }, "worst-case (provider sent no usage)");
      res.credits = { chargedUsd: microToUsd(reserve), balanceUsd: microToUsd(await balanceOf(owner)), basis: "worst-case (no usage reported)" };
    }
    return res;
  });
  return NextResponse.json(result);
}
