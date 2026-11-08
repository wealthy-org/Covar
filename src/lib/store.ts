"use client";

import { useSyncExternalStore } from "react";
import type { Agent, AppNotification, CovarState, Creator, Holding, LedgerRow, NotificationKind, PracticeRun, Strategy } from "./types";
import { vaultFeed } from "./vaultAgent";
import { getWalletProvider } from "./wallet";
import { seedState } from "./seed";
import { PLATFORM_LIMITS } from "./strategy";

const KEY = "covar.state.v1";

let state: CovarState = seedState();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled — in-memory state still works */
  }
}

/* ------------------------------------------------------------------ *
 * Durable session sync (Prisma over SQLite by default)                *
 * ------------------------------------------------------------------ *
 * localStorage stays the fast path. On top of it, every burst of      *
 * changes is mirrored to /api/state (debounced), and a fresh session  *
 * hydrates from the DB when it is newer. If the DB is not configured  *
 * the app keeps working from localStorage — and says so nowhere it    *
 * would be misleading, because durability is not a user claim.        */

let syncTimer: ReturnType<typeof setTimeout> | null = null;
// Local edits the server has not acknowledged yet survive reloads via this flag,
// so a reload inside the debounce window can never let an older server copy win.
const DIRTY_KEY = "covar.state.dirty";
let localVersion = 0;
const markDirty = (on: boolean) => {
  try {
    if (on) window.localStorage.setItem(DIRTY_KEY, "1");
    else window.localStorage.removeItem(DIRTY_KEY);
  } catch {
    /* storage disabled */
  }
};
const isDirty = () => {
  try {
    return window.localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
};

function pushNow(keepalive = false) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  const sentVersion = localVersion;
  return fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
    keepalive,
  })
    .then((r) => r.json())
    .then((r) => {
      if (r?.ok && r.savedAt) {
        state = { ...state, savedAt: r.savedAt };
        persist();
        if (sentVersion === localVersion) markDirty(false);
      }
    })
    .catch(() => {
      /* offline, signed out or DB not configured — localStorage is the fallback */
    });
}

function scheduleDbSync() {
  if (typeof window === "undefined") return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void pushNow(), 1500);
}

if (typeof window !== "undefined") {
  // leaving the page inside the debounce window: send now, the browser keeps it alive
  window.addEventListener("pagehide", () => {
    if (syncTimer) void pushNow(true);
  });
}

async function hydrateFromDb() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const data = await res.json();
    if (data?.ok && !data.state && data.owner && data.owner !== "local" && state.owner && state.owner !== data.owner) {
      // signed in as a new account on a device holding someone else's data: start clean
      state = { ...seedState(), owner: data.owner };
      persist();
      emit();
      return;
    }
    // unacknowledged local edits win over the server copy for the same owner
    if (data?.ok && isDirty() && (!data.owner || data.owner === "local" || data.owner === state.owner)) {
      void pushNow();
      return;
    }
    if (!data?.ok || !data?.state) return;
    // a different owner's snapshot on this device is never merged — the server copy wins
    if (data.owner && data.owner !== "local" && state.owner !== data.owner) {
      state = { ...data.state, owner: data.owner, savedAt: data.savedAt } as CovarState;
      persist();
      emit();
      return;
    }
    const serverSaved = Date.parse(data.savedAt ?? data.state.savedAt ?? "");
    const localSaved = Date.parse((state as { savedAt?: string }).savedAt ?? "");
    if (Number.isFinite(serverSaved) && (!Number.isFinite(localSaved) || serverSaved > localSaved)) {
      state = { ...data.state, savedAt: data.savedAt } as CovarState;
      persist();
      emit();
    }
  } catch {
    /* DB unreachable — session still works from localStorage */
  }
}

/**
 * Appends an inbox entry. Notifications are derived from things that actually
 * happened in this session (a practice run started, a withdrawal requested), never
 * from marketing copy — an empty inbox is a legitimate state.
 */
function pushNotification(
  state: CovarState,
  input: { kind: NotificationKind; title: string; body: string; href?: string }
): CovarState {
  const entry: AppNotification = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    read: false,
    ...input,
  };
  return { ...state, notifications: [entry, ...state.notifications].slice(0, 80) };
}

function set(next: CovarState) {
  state = { ...next };
  localVersion++;
  markDirty(true);
  persist();
  scheduleDbSync();
  emit();
}

export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  void hydrateFromDb();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CovarState;
      if (parsed?.agents?.length) {
        state = parsed;
        emit();
      }
    }
  } catch {
    /* corrupt payload — keep seed */
  }
}

const subscribe = (l: () => void) => {
  hydrate();
  listeners.add(l);
  const offFeed = vaultFeed.subscribe(l);
  return () => {
    listeners.delete(l);
    offFeed();
  };
};
/**
 * Snapshot = persisted state + the on-chain vault record (3.6). The vault record is
 * derived from chain data on every load and never written to localStorage or the DB.
 */
let derivedFrom: { s: CovarState; agent: Agent; creator: Creator } | null = null;
let derived: CovarState = state;
const getSnapshot = () => {
  const { agent, creator } = vaultFeed.get();
  if (!agent || !creator) return state;
  if (derivedFrom?.s === state && derivedFrom.agent === agent && derivedFrom.creator === creator) return derived;
  derived = {
    ...state,
    agents: [agent, ...state.agents.filter((a) => a.id !== agent.id)],
    creators: [creator, ...state.creators.filter((c) => c.id !== creator.id)],
  };
  derivedFrom = { s: state, agent, creator };
  return derived;
};
const getServerSnapshot = () => seed;

let seed = seedState();

export function useCovar() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/* ------------------------------- drafts ------------------------------- */
export const actions = {
  /**
   * Connects through the configured WalletProvider (session / injected EVM / Privy).
   * The provider's `guarantee` — exactly what the connection proves — is stored and
   * shown in the wallet dialog. Nothing is signed by any provider in this build.
   */
  async connectWallet(): Promise<{ ok: boolean; error?: string }> {
    const provider = getWalletProvider();
    try {
      const conn = await provider.connect();
      state = {
        ...state,
        walletConnected: true,
        walletProviderId: conn.providerId,
        walletGuarantee: conn.guarantee,
        portfolio: { ...state.portfolio, wallet: conn.address },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    persist();
    emit();
    return { ok: true };
  },

  /**
   * Called after a successful Sign-In with Ethereum. The account's server copy wins;
   * a brand-new account adopts this device's anonymous work, but never another
   * account's data left on a shared device.
   */
  async adoptAccount(address: string) {
    if (syncTimer) clearTimeout(syncTimer);
    const owner = address.toLowerCase();
    if (state.owner === owner && isDirty()) {
      // same account signing in again with unsynced local edits: keep them, push them
      void pushNow();
      return;
    }
    try {
      const data = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
      if (data?.ok && data.state) {
        state = { ...data.state, owner, savedAt: data.savedAt } as CovarState;
        persist();
        emit();
        return;
      }
    } catch {
      /* fall through: keep working locally */
    }
    const base = state.owner && state.owner !== owner ? { ...seedState(), walletConnected: state.walletConnected, walletProviderId: state.walletProviderId, walletGuarantee: state.walletGuarantee } : state;
    set({ ...base, owner });
  },

  /** Signed out: this device forgets the account's data (the server keeps it). */
  forgetAccount() {
    if (syncTimer) clearTimeout(syncTimer);
    markDirty(false);
    state = { ...seedState(), owner: undefined };
    persist();
    emit();
  },

  /**
   * Records a CONFIRMED on-chain vault transaction (hash from the wallet, receipt
   * status 1). The only ledger rows that carry a tx hash; idempotent per hash.
   */
  recordChainTx(input: { kind: "deposit" | "withdrawal_request" | "withdrawal_claim"; label: string; amountUsd: number; txHash: string; agentId?: string; note?: string }) {
    if (state.portfolio.ledger.some((l) => l.txHash === input.txHash)) return;
    const row: LedgerRow = { id: `tx-${input.txHash.slice(2, 14)}`, ts: new Date().toISOString(), state: input.kind === "withdrawal_request" ? "pending" : "settled", ...input };
    const next = { ...state, portfolio: { ...state.portfolio, ledger: [row, ...state.portfolio.ledger] } };
    set(pushNotification(next, { kind: "money", title: input.label, body: `Confirmed on-chain · ${input.txHash.slice(0, 10)}…`, href: "/portfolio" }));
  },

  disconnectWallet() {
    getWalletProvider().disconnect();
    state = { ...state, walletConnected: false, walletProviderId: undefined, walletGuarantee: undefined };
    persist();
    emit();
  },

  notify(input: { kind: NotificationKind; title: string; body: string; href?: string }) {
    set(pushNotification(state, input));
  },

  markNotificationRead(id: string) {
    set({ ...state, notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  },

  markAllNotificationsRead() {
    set({ ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) });
  },

  clearNotifications() {
    set({ ...state, notifications: [] });
  },

  saveDraft(strategy: Strategy) {
    const exists = state.drafts.some((d) => d.id === strategy.id);
    set({
      ...state,
      drafts: exists ? state.drafts.map((d) => (d.id === strategy.id ? strategy : d)) : [...state.drafts, strategy],
    });
  },
  removeDraft(id: string) {
    set({ ...state, drafts: state.drafts.filter((d) => d.id !== id) });
  },
  publishStrategy(strategy: Strategy, agentName: string) {
    const agentId = uid("ag");
    const agent: Agent = {
      id: agentId,
      name: agentName,
      tagline: strategy.notes.slice(0, 140) || "New Covar agent.",
      creatorId: "cr-me",
      status: "practice",
      market: strategy.market,
      timeframe: strategy.timeframe,
      provenance: "practice",
      score: 0,
      tvlUsd: 0,
      returnPct: 0,
      drawdownPct: 0,
      liveAgeDays: 0,
      tradeCount: 0,
      version: 1,
      curve: [100],
      benchmark: [100],
      twin: [100],
      decisions: [
        {
          id: uid("d"),
          ts: new Date().toISOString(),
          market: strategy.market,
          inputs: "agent created",
          proposed: "start practice session",
          aiDecision: strategy.copilot.mode === "off" ? "rules_only" : "approve",
          riskDecision: "approved",
          outcome: "awaiting first signal",
        },
      ],
      versions: [
        {
          version: 1,
          ts: new Date().toISOString(),
          summary: `v1 published from Studio draft (${strategy.entry.length} entry / ${strategy.exit.length} exit conditions).`,
          status: "active",
          notice: "First version — no investor notice required because the vault is not open yet.",
        },
      ],
      strategySummary: strategy.notes || "Created in Studio.",
      riskSummary: `${strategy.risk.leverage}x leverage, ${strategy.risk.maxPositionPct}% max position, ${strategy.risk.stopLossPct}% stop, ${strategy.risk.dailyLossPausePct}% daily pause, ${strategy.risk.maxDrawdownPct}% drawdown stop.`,
      disclosure: "Practice run — simulated ticks, simulated fills, no investor capital.",
      isMine: true,
    };
    const publishTarget = {
      ...state,
      agents: [agent, ...state.agents],
      creators: state.creators.some((c) => c.id === "cr-me")
        ? state.creators.map((c) => (c.id === "cr-me" ? { ...c, agentIds: [...c.agentIds, agentId] } : c))
        : [
            {
              id: "cr-me",
              handle: "you",
              name: "Your workspace",
              joined: new Date().toISOString(),
              bio: "Local workspace creator profile.",
              agentIds: [agentId],
              followers: 0,
              verified: false,
            },
            ...state.creators,
          ],
      drafts: state.drafts.filter((d) => d.id !== strategy.id),
      liveStrategy: { ...state.liveStrategy, [agentId]: { ...strategy, agentId } },
    };
    set(
      pushNotification(publishTarget, {
        kind: "publish",
        title: `Published v1 · ${agentName}`,
        body: `Rules are public and versioned (${strategy.entry.length} entry / ${strategy.exit.length} exit conditions). The vault is closed until a practice record exists and you open it with an investor notice.`,
        href: `/agents/${agentId}`,
      })
    );
    return agent;
  },
  updateAgent(id: string, patch: Partial<Agent>) {
    set({ ...state, agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },
  setAgentStatus(id: string, status: Agent["status"]) {
    const agent = state.agents.find((a) => a.id === id);
    const next = { ...state, agents: state.agents.map((a) => (a.id === id ? { ...a, status } : a)) };
    set(
      status === "paused"
        ? pushNotification(next, {
            kind: "risk",
            title: `${agent?.name ?? "Agent"} paused`,
            body: "Close-only: no new entries. Exits, stops and the emergency close path stay enabled.",
            href: `/agents/${id}`,
          })
        : status === "live"
        ? pushNotification(next, {
            kind: "system",
            title: `${agent?.name ?? "Agent"} resumed`,
            body: "Operating again within the published risk caps.",
            href: `/agents/${id}`,
          })
        : next
    );
  },

  /* ----------------------------- practice ----------------------------- */
  startPractice(agentId: string, capitalUsd: number, marks?: { price?: number; source?: string }) {
    const run: PracticeRun = {
      agentId,
      startedAt: new Date().toISOString(),
      capitalUsd,
      pnlUsd: 0,
      ticks: 0,
      status: "running",
      priceMode: marks?.price !== undefined ? "live" : "simulated",
      lastPrice: marks?.price,
      entryPrice: marks?.price,
      priceSource: marks?.source,
    };
    const agent = state.agents.find((a) => a.id === agentId);
    const next = {
      ...state,
      practice: { ...state.practice, [agentId]: run },
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status: "practice" as const, provenance: "practice" as const, ...(a.isMine ? {} : {}) } : a
      ),
    };
    set(
      pushNotification(next, {
        kind: "practice",
        title: `Practice started · ${agent?.name ?? agentId}`,
        body:
          run.priceMode === "live"
            ? `Marks are live (${marks?.source ?? "market feed"}); fills are simulated. $${capitalUsd.toLocaleString()} practice capital.`
            : `Price feed unavailable — simulated ticks, simulated fills. $${capitalUsd.toLocaleString()} practice capital.`,
        href: `/agents/${agentId}`,
      })
    );
  },
  /**
   * One mark for a running practice session.
   *
   * With a live price the P&L is a real price move applied to the session's exposure;
   * without one it falls back to the simulated wave and the run keeps saying so.
   * Exposure is 35% of practice capital — the same order of size the rule caps allow.
   */
  tickPractice(agentId: string, price?: number) {
    const run = state.practice[agentId];
    if (!run || run.status !== "running") return;

    let nextPnl: number;
    let lastPrice = run.lastPrice;
    if (run.priceMode === "live" && price !== undefined && run.lastPrice !== undefined && run.lastPrice > 0) {
      const ret = (price - run.lastPrice) / run.lastPrice;
      nextPnl = run.pnlUsd + run.capitalUsd * 0.35 * ret;
      lastPrice = price;
    } else {
      const wave = Math.sin(run.ticks / 3.1) * 0.55 + (Math.random() - 0.45) * 1.4;
      nextPnl = run.pnlUsd + wave * 1.6;
    }
    set({
      ...state,
      practice: { ...state.practice, [agentId]: { ...run, ticks: run.ticks + 1, pnlUsd: nextPnl, lastPrice } },
      agents: state.agents.map((a) =>
        a.id === agentId
          ? { ...a, returnPct: (nextPnl / run.capitalUsd) * 100, curve: [...a.curve.slice(-119), 100 + (nextPnl / run.capitalUsd) * 100] }
          : a
      ),
    });
  },
  stopPractice(agentId: string) {
    const run = state.practice[agentId];
    if (!run) return;
    const agent = state.agents.find((a) => a.id === agentId);
    const next = {
      ...state,
      practice: { ...state.practice, [agentId]: { ...run, status: "stopped" as const } },
    };
    set(
      pushNotification(next, {
        kind: "practice",
        title: `Practice stopped · ${agent?.name ?? agentId}`,
        body: `Result kept under the practice label: ${run.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(run.pnlUsd).toFixed(2)} over ${run.ticks} marks. Not a real-money record.`,
        href: `/agents/${agentId}`,
      })
    );
  },

  /* ------------------------------ vault ------------------------------ */
  deposit(agentId: string, amountUsd: number) {
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent?.vault) return { ok: false, error: "Vault unavailable" };
    if (amountUsd < 10) return { ok: false, error: "Minimum deposit is 10 USDG." };
    if (amountUsd > state.portfolio.cashUsd) return { ok: false, error: "Insufficient USDG balance." };
    const fee = amountUsd * (PLATFORM_LIMITS.depositFeePct / 100) + PLATFORM_LIMITS.depositFeeFlat;
    const net = amountUsd - fee;
    const shares = net / agent.vault.navPerShare;
    const holding: Holding = state.portfolio.holdings.find((h) => h.agentId === agentId) ?? {
      agentId,
      shares: 0,
      costBasisUsd: 0,
      entryNav: agent.vault.navPerShare,
    };
    const rows: LedgerRow[] = [
      {
        id: uid("l"),
        ts: new Date().toISOString(),
        kind: "deposit",
        agentId,
        label: `Deposit into ${agent.name}`,
        amountUsd,
        state: "settled",
        // No hash: this ledger is simulated, and a made-up hash looks like proof.
        note: `Net ${net.toFixed(2)} USDG · ${shares.toFixed(4)} shares at NAV ${agent.vault.navPerShare.toFixed(4)}`,
      },
      {
        id: uid("l"),
        ts: new Date().toISOString(),
        kind: "fee_deposit",
        agentId,
        label: "Deposit fee (1% + 0.10 USDG)",
        amountUsd: -fee,
        state: "settled",
        note: "Capital flow fee — recorded separately from trading P&L.",
      },
    ];
    const depositNext = {
      ...state,
      agents: state.agents.map((a) =>
        a.id === agentId && a.vault
          ? { ...a, tvlUsd: a.vault.tvlUsd + net, vault: { ...a.vault, tvlUsd: a.vault.tvlUsd + net, sharesOutstanding: a.vault.sharesOutstanding + shares } }
          : a
      ),
      portfolio: {
        ...state.portfolio,
        cashUsd: state.portfolio.cashUsd - amountUsd,
        holdings: state.portfolio.holdings.some((h) => h.agentId === agentId)
          ? state.portfolio.holdings.map((h) =>
              h.agentId === agentId ? { ...h, shares: h.shares + shares, costBasisUsd: h.costBasisUsd + amountUsd } : h
            )
          : [...state.portfolio.holdings, { ...holding, shares, costBasisUsd: amountUsd }],
        ledger: [...rows, ...state.portfolio.ledger],
      },
    };
    set(
      pushNotification(depositNext, {
        kind: "money",
        title: `Deposit into ${agent.name}`,
        body: `$${amountUsd.toFixed(2)} in, fee $${fee.toFixed(2)}, ${shares.toFixed(4)} shares at NAV ${agent.vault.navPerShare.toFixed(4)}. Simulated ledger — no transaction was sent.`,
        href: "/portfolio",
      })
    );
    return { ok: true, shares, fee, net };
  },

  requestWithdrawal(agentId: string, shares: number) {
    const agent = state.agents.find((a) => a.id === agentId);
    const holding = state.portfolio.holdings.find((h) => h.agentId === agentId);
    if (!agent?.vault || !holding) return { ok: false, error: "No position in this vault." };
    if (shares <= 0 || shares > holding.shares) return { ok: false, error: "Enter a valid share amount." };
    const est = shares * agent.vault.navPerShare * (1 - PLATFORM_LIMITS.depositFeePct / 100) - PLATFORM_LIMITS.depositFeeFlat;
    const withdrawNext: CovarState = {
      ...state,
      portfolio: {
        ...state.portfolio,
        holdings: state.portfolio.holdings.map((h) =>
          h.agentId === agentId
            ? {
                ...h,
                requestedWithdrawal: {
                  shares,
                  requestedAt: new Date().toISOString(),
                  state: "closing_positions" as const,
                  estUsd: Math.max(0, est),
                },
              }
            : h
        ),
        ledger: [
          {
            id: uid("l"),
            ts: new Date().toISOString(),
            kind: "withdrawal_request",
            agentId,
            label: `Withdrawal requested · ${shares.toFixed(2)} shares`,
            amountUsd: Math.max(0, est),
            state: "pending",
            note: "A request is not a completed withdrawal. Positions are closed first (est. 2 days), then funds are claimable.",
          },
          ...state.portfolio.ledger,
        ],
      },
    };
    set(
      pushNotification(withdrawNext, {
        kind: "money",
        title: `Withdrawal requested · ${shares.toFixed(2)} shares`,
        body: `A request is not a completed withdrawal: positions are closed first, then the money becomes claimable (est. $${Math.max(0, est).toFixed(2)}).`,
        href: "/portfolio",
      })
    );
    return { ok: true, est };
  },

  advanceWithdrawal(agentId: string) {
    set({
      ...state,
      portfolio: {
        ...state.portfolio,
        holdings: state.portfolio.holdings.map((h) => {
          if (h.agentId !== agentId || !h.requestedWithdrawal) return h;
          const next = h.requestedWithdrawal.state === "closing_positions" ? "settling" : "claimable";
          return { ...h, requestedWithdrawal: { ...h.requestedWithdrawal, state: next } };
        }),
      },
    });
  },

  claimWithdrawal(agentId: string) {
    const holding = state.portfolio.holdings.find((h) => h.agentId === agentId);
    if (!holding?.requestedWithdrawal) return { ok: false, error: "Nothing to claim." };
    const { shares, estUsd } = holding.requestedWithdrawal;
    const claimNext: CovarState = {
      ...state,
      portfolio: {
        ...state.portfolio,
        cashUsd: state.portfolio.cashUsd + estUsd,
        holdings: state.portfolio.holdings
          .map((h) =>
            h.agentId === agentId
              ? { ...h, shares: h.shares - shares, costBasisUsd: h.costBasisUsd * (1 - shares / Math.max(h.shares, 0.0001)), requestedWithdrawal: undefined }
              : h
          )
          .filter((h) => h.shares > 0.0001),
        ledger: [
          {
            id: uid("l"),
            ts: new Date().toISOString(),
            kind: "withdrawal_claim",
            agentId,
            label: `Withdrawal claimed · ${shares.toFixed(2)} shares`,
            amountUsd: estUsd,
            state: "settled",
            note: "Settled amount at the NAV used for closure, net of withdrawal fee.",
          },
          ...state.portfolio.ledger,
        ],
      },
    };
    set(
      pushNotification(claimNext, {
        kind: "money",
        title: "Withdrawal claimed",
        body: `$${estUsd.toFixed(2)} returned to your wallet balance for ${shares.toFixed(2)} shares. Simulated ledger — no transaction was sent.`,
        href: "/portfolio",
      })
    );
    return { ok: true };
  },


  reset() {
    state = seedState();
    seed = state;
    persist();
    emit();
  },
};
