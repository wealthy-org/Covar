import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { microToUsd } from "@/lib/credits";

/**
 * GET /api/credits/stats: platform-wide credit totals for the treasury page
 * (aggregates only, no per-wallet data). Recorded rows, nothing estimated.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [topups, usage, holders] = await Promise.all([
      prisma.creditEntry.aggregate({ where: { kind: "topup" }, _sum: { amount: true }, _count: true }),
      prisma.creditEntry.aggregate({ where: { kind: "usage" }, _sum: { amount: true, providerCost: true, appFee: true, tokensIn: true, tokensOut: true }, _count: true }),
      prisma.creditEntry.groupBy({ by: ["owner"], where: { kind: "topup" } }),
    ]);
    const sold = topups._sum.amount ?? 0n;
    const used = -(usage._sum.amount ?? 0n);
    return NextResponse.json(
      {
        ok: true,
        soldUsd: microToUsd(sold),
        topups: topups._count,
        buyers: holders.length,
        consumedUsd: microToUsd(used),
        calls: usage._count,
        providerCostUsd: microToUsd(usage._sum.providerCost),
        appFeeUsd: microToUsd(usage._sum.appFee),
        tokens: { in: usage._sum.tokensIn ?? 0, out: usage._sum.tokensOut ?? 0 },
        outstandingUsd: microToUsd(sold - used), // unused credits: a liability
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[credits/stats]", err);
    return NextResponse.json({ ok: false, error: "Credit figures are temporarily unavailable." }, { status: 503 });
  }
}
