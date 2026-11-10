import type { Agent, Decision, VersionEntry } from "./types";

/** Investor notice window for a rules change on an agent with an open vault (brief §5 / runbook). */
export const NOTICE_HOURS = 48;
const HOUR = 36e5;

/**
 * Versions as they stand at `now`. A pending version whose notice window has run out
 * is shown as active and the version it replaces as superseded — the stored record is
 * not rewritten by the browser, it is only read against the clock.
 */
export function resolveVersions(list: VersionEntry[], now: number): VersionEntry[] {
  const matured = list.filter((v) => v.status === "pending_investor_notice" && v.effectiveAt && Date.parse(v.effectiveAt) <= now);
  if (matured.length === 0) return list;
  const newest = Math.max(...matured.map((v) => v.version));
  return list.map((v) => {
    if (v.version === newest)
      return { ...v, status: "active", notice: "Active version. Investors were notified 48h before activation." };
    if (v.status === "active" || (v.status === "pending_investor_notice" && v.version < newest))
      return { ...v, status: "superseded", notice: "Superseded — historical results kept for audit, not recalculated." };
    return v;
  });
}

export function activeVersionOf(list: VersionEntry[], fallback: number, now: number): number {
  return resolveVersions(list, now).find((v) => v.status === "active")?.version ?? fallback;
}

export function noticeWindow(v: VersionEntry, now: number) {
  const start = Date.parse(v.noticeAt ?? v.ts);
  const end = v.effectiveAt ? Date.parse(v.effectiveAt) : start + NOTICE_HOURS * HOUR;
  const total = Math.max(1, end - start);
  const remainingMs = Math.max(0, end - now);
  return { start, end, remainingMs, pct: Math.min(100, Math.max(0, ((now - start) / total) * 100)) };
}

export function fmtRemaining(ms: number): string {
  if (ms <= 0) return "notice period over";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m left` : `${m}m left`;
}

/** Copilot's recorded reason, or a plain statement of what the verdict means when none was recorded. */
export function copilotWhy(d: Decision): string {
  if (d.aiReason) return d.aiReason;
  switch (d.aiDecision) {
    case "rules_only":
      return "Not consulted — rules-only execution.";
    case "approve":
      return "Agreed with the rule signal (no reason text recorded).";
    case "reduce":
      return "Took the signal at a smaller size (no reason text recorded).";
    case "reject":
      return "Declined the rule signal (no reason text recorded).";
  }
}

/**
 * Brings records persisted before these fields existed up to date with the seed:
 * versions gain notice/effective timestamps (and any pending change), decisions gain
 * the Copilot reason and strategy version, agents gain rule visibility. Only seeded
 * agents are touched, and only where the field is missing.
 */
export function upgradeAgents(agents: Agent[], seed: Agent[]): Agent[] {
  const byId = new Map(seed.map((a) => [a.id, a]));
  return agents.map((a) => {
    const s = byId.get(a.id);
    if (!s) return a;
    const oldVersions = !(a.versions ?? []).some((v) => v.effectiveAt);
    const reasons = new Map(s.decisions.map((d) => [d.id, d]));
    return {
      ...a,
      rulesVisibility: a.rulesVisibility ?? s.rulesVisibility,
      versions: oldVersions ? s.versions : a.versions,
      decisions: (a.decisions ?? []).map((d) => {
        const sd = reasons.get(d.id);
        return sd && (d.aiReason === undefined || d.strategyVersion === undefined)
          ? { ...d, aiReason: d.aiReason ?? sd.aiReason, strategyVersion: d.strategyVersion ?? sd.strategyVersion }
          : d;
      }),
    };
  });
}
