import { NextResponse } from "next/server";
import { prisma, dbLabel } from "@/lib/db";
import { sameOrigin, stateOwner } from "@/lib/auth";
import type { AppNotification, CovarState, LedgerRow, PracticeRun, Strategy } from "@/lib/types";

/**
 * Session durability for the web app.
 *
 * POST — the client pushes its state snapshot; the server upserts it and mirrors
 * the per-entity rows (notifications, ledger, practice runs, strategy versions)
 * so they are queryable as real tables. localStorage remains the offline cache.
 * GET — returns the stored snapshot with `savedAt` so a fresh browser can resume.
 *
 * Owner: the wallet signed in with SIWE (multi-user), or the shared "local" row in
 * single-operator dev mode. In production, anonymous visitors get 401 and keep
 * their state in localStorage only — one shared row for everyone would leak data.
 *
 * App state is SIMULATED/practice data unless a ledger row carries a chain tx hash.
 */
export const dynamic = "force-dynamic";

const needAuth = () =>
  NextResponse.json({ ok: false, auth: "required", error: "Sign in with your wallet to sync across devices." }, { status: 401 });

export async function GET(req: Request) {
  if (!prisma) return NextResponse.json({ ok: false, db: "unconfigured", simulated: true });
  const SESSION_ID = await stateOwner(req);
  if (!SESSION_ID) return needAuth();
  const row = await prisma.sessionState.findUnique({ where: { id: SESSION_ID } });
  if (!row) return NextResponse.json({ ok: true, db: dbLabel(), owner: SESSION_ID, simulated: true, state: null });
  return NextResponse.json({
    ok: true,
    db: dbLabel(),
    owner: SESSION_ID,
    simulated: true,
    savedAt: row.savedAt.toISOString(),
    state: JSON.parse(row.stateJson),
  });
}

export async function POST(req: Request) {
  if (!prisma) return NextResponse.json({ ok: false, db: "unconfigured", simulated: true }, { status: 503 });
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  const SESSION_ID = await stateOwner(req);
  if (!SESSION_ID) return needAuth();
  let state: CovarState;
  try {
    state = (await req.json()) as CovarState;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed body" }, { status: 400 });
  }
  if (!state || typeof state !== "object" || !Array.isArray(state.agents)) {
    return NextResponse.json({ ok: false, error: "Not a CovarState snapshot" }, { status: 400 });
  }

  const savedAt = new Date();
  const stateJson = JSON.stringify({ ...state, savedAt: savedAt.toISOString() });
  const notifications: AppNotification[] = Array.isArray(state.notifications) ? state.notifications : [];
  const ledger: LedgerRow[] = state.portfolio?.ledger ?? [];
  const practice: PracticeRun[] = Object.values(state.practice ?? {});
  const drafts: Strategy[] = [
    ...(Array.isArray(state.drafts) ? state.drafts : []),
    ...Object.values(state.liveStrategy ?? {}),
  ];

  await prisma.$transaction([
    prisma.sessionState.upsert({
      where: { id: SESSION_ID },
      update: { stateJson },
      create: { id: SESSION_ID, stateJson },
    }),
    prisma.notification.deleteMany({ where: { sessionId: SESSION_ID } }),
    prisma.notification.createMany({
      data: notifications.slice(0, 200).map((n: AppNotification) => ({
        id: String(n.id),
        ts: new Date(n.ts),
        kind: String(n.kind),
        title: String(n.title).slice(0, 200),
        body: String(n.body).slice(0, 1000),
        href: n.href ? String(n.href) : null,
        read: !!n.read,
        sessionId: SESSION_ID,
      })),
    }),
    prisma.ledgerEntry.deleteMany({ where: { sessionId: SESSION_ID } }),
    prisma.ledgerEntry.createMany({
      data: ledger.slice(0, 500).map((l: LedgerRow) => ({
        id: String(l.id),
        ts: new Date(l.ts),
        kind: String(l.kind),
        agentId: l.agentId ? String(l.agentId) : null,
        label: String(l.label).slice(0, 200),
        amountUsd: Number(l.amountUsd) || 0,
        state: String(l.state),
        txHash: l.txHash ? String(l.txHash) : null,
        note: l.note ? String(l.note).slice(0, 500) : null,
        sessionId: SESSION_ID,
      })),
    }),
    prisma.practiceRun.deleteMany({ where: { sessionId: SESSION_ID } }),
    prisma.practiceRun.createMany({
      data: practice.map((p: PracticeRun) => ({
        agentId: String(p.agentId),
        startedAt: new Date(p.startedAt),
        capitalUsd: Number(p.capitalUsd) || 0,
        pnlUsd: Number(p.pnlUsd) || 0,
        ticks: Number(p.ticks) || 0,
        status: String(p.status),
        priceMode: p.priceMode === "live" ? "live" : "simulated",
        entryPrice: p.entryPrice ?? null,
        lastPrice: p.lastPrice ?? null,
        priceSource: p.priceSource ? String(p.priceSource) : null,
        sessionId: SESSION_ID,
      })),
    }),
    prisma.strategyVersion.deleteMany({ where: { sessionId: SESSION_ID } }),
    prisma.strategyVersion.createMany({
      data: drafts.map((d: Strategy) => ({
        id: String(d.id),
        agentId: d.agentId && d.agentId !== "draft" ? String(d.agentId) : String(d.id),
        version: Number(d.version) || 1,
        name: String(d.name).slice(0, 100),
        rulesJson: JSON.stringify(d),
        publishedAt: statusIsPublished(d) ? new Date(d.createdAt) : null,
        createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
        sessionId: SESSION_ID,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, db: dbLabel(), owner: SESSION_ID, simulated: true, savedAt: savedAt.toISOString() });
}

function statusIsPublished(d: Strategy): boolean {
  return !!d.agentId && d.agentId !== "draft";
}
