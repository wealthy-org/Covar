import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { copilotProvider } from "@/lib/copilot";
import { balanceOf, creditsMode, microToUsd, pricing, reserveFor, topupConfig } from "@/lib/credits";

/**
 * GET /api/credits: the signed-in wallet's Copilot credit balance and ledger,
 * plus the public top-up configuration (treasury, token, chain, pricing).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = topupConfig();
  const p = pricing();
  const provider = copilotProvider();
  const config = {
    mode: creditsMode(),
    model: provider.kind === "none" ? null : `${provider.label} · ${provider.model}`,
    chainId: cfg.chainId,
    usdg: cfg.usdg,
    treasury: cfg.treasury,
    topupsEnabled: !!(cfg.treasury && cfg.usdg && cfg.rpc),
    minTopupUsd: cfg.minTopupUsd,
    maxTopupUsd: cfg.maxTopupUsd,
    pricing: { inPerMTok: p.inPerMTok, outPerMTok: p.outPerMTok, appFeePct: p.appFeePct },
    reserveUsd: microToUsd(reserveFor(p)),
  };
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ signedIn: false, config }, { headers: { "cache-control": "no-store" } });
  const rows = await prisma.creditEntry.findMany({ where: { owner: user.address }, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json(
    {
      signedIn: true,
      owner: user.address,
      balanceUsd: microToUsd(await balanceOf(user.address)),
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amountUsd: microToUsd(r.amount),
        at: r.createdAt.toISOString(),
        txHash: r.txHash,
        chainId: r.chainId,
        model: r.model,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        providerCostUsd: r.providerCost === null ? null : microToUsd(r.providerCost),
        appFeeUsd: r.appFee === null ? null : microToUsd(r.appFee),
        basis: r.note ?? r.priceBasis,
      })),
      config,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
