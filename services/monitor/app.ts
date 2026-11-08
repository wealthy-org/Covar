/**
 * Monitor (package 3.10) — an independent watcher. It does not trust the
 * operator to report on itself: it polls every service's /health and reads the
 * vault over its own RPC connection, so a dead operator, a stale NAV or a stuck
 * withdrawal still pages someone.
 *
 * `evaluate()` is pure: observations in, the set of currently-active problems
 * out. `createMonitor()` diffs that set between rounds, so each problem pages
 * once when it starts and once when it resolves (plus the sink's cooldown).
 */
import type { VaultSnapshot } from "../operator/app";
import type { AlertMessage, AlertSink } from "./alerts";

export interface Observation {
  now: number; // ms
  services: { name: string; ok: boolean; error?: string; body?: Record<string, unknown> }[];
  vault: VaultSnapshot | { error: string } | null;
}

export interface MonitorConfig {
  /** Consecutive failed polls before a service counts as down. */
  downAfter: number;
  /** Operator cycle older than this (ms) = stalled. */
  operatorStallMs: number;
  /** Warn when NAV age passes this share of maxNavAge. */
  navWarnFraction: number;
  /** Withdrawal not settled after this long (s) = delayed. */
  withdrawalSlaSec: number;
  minGasWei: bigint;
}

export const DEFAULT_MONITOR: MonitorConfig = {
  downAfter: 2,
  operatorStallMs: 5 * 60_000,
  navWarnFraction: 0.75,
  withdrawalSlaSec: 24 * 3600,
  minGasWei: 50_000_000_000_000n,
};

type Problem = Omit<AlertMessage, "source" | "resolved">;

export function evaluate(o: Observation, failures: Record<string, number>, cfg: MonitorConfig): Problem[] {
  const out: Problem[] = [];
  for (const s of o.services) {
    if (!s.ok && (failures[s.name] ?? 0) >= cfg.downAfter) {
      out.push({ level: "critical", code: `SERVICE_DOWN:${s.name}`, message: `${s.name} is not answering /health (${failures[s.name]} polls): ${s.error ?? "no response"}` });
    }
    if (s.name === "operator" && s.ok && s.body) {
      const last = typeof s.body.lastCycle === "string" ? Date.parse(s.body.lastCycle) : NaN;
      if (!Number.isFinite(last) || o.now - last > cfg.operatorStallMs) {
        out.push({ level: "critical", code: "OPERATOR_STALLED", message: `operator is up but its last cycle was ${Number.isFinite(last) ? `${Math.round((o.now - last) / 1000)}s ago` : "never"}` });
      }
    }
  }

  const v = o.vault;
  if (v && "error" in v) out.push({ level: "critical", code: "VAULT_UNREADABLE", message: `cannot read the vault over RPC: ${v.error}` });
  else if (v) {
    const age = v.lastNavUpdate === 0 ? Infinity : v.now - v.lastNavUpdate;
    if (v.totalShares > 0n || v.reportedAssets > 0n) {
      if (age > v.maxNavAge) out.push({ level: "critical", code: "NAV_STALE", message: `NAV is ${Math.round(age / 60)} min old (limit ${v.maxNavAge / 60} min): deposits are blocked` });
      else if (age > v.maxNavAge * cfg.navWarnFraction) out.push({ level: "warn", code: "NAV_AGING", message: `NAV is ${Math.round(age / 60)} min old; it goes stale at ${v.maxNavAge / 60} min` });
    }
    for (const r of v.requests) {
      if ((r.state === "ClosingPositions" || r.state === "Settling") && v.now - r.requestedAt > cfg.withdrawalSlaSec) {
        out.push({ level: "warn", code: `WITHDRAWAL_DELAYED:${r.investor.toLowerCase()}`, message: `withdrawal by ${r.investor} is in ${r.state} for ${Math.round((v.now - r.requestedAt) / 3600)} h` });
      }
    }
    if (v.vaultBalance < v.reservedForClaims) out.push({ level: "critical", code: "CLAIMS_UNDERFUNDED", message: `vault holds ${v.vaultBalance} but owes ${v.reservedForClaims} to claimants` });
    if (v.operatorGasWei < cfg.minGasWei) out.push({ level: "critical", code: "OPERATOR_GAS_LOW", message: `operator wallet has ${Number(v.operatorGasWei) / 1e18} ETH for gas` });
    if (v.closeOnly) out.push({ level: "warn", code: "VAULT_CLOSE_ONLY", message: "vault is in close-only mode" });
    else if (v.depositsPaused) out.push({ level: "info", code: "VAULT_DEPOSITS_PAUSED", message: "vault deposits are paused" });
  }
  return out;
}

export function createMonitor(opts: {
  sink: AlertSink;
  observe: () => Promise<Observation>;
  cfg?: Partial<MonitorConfig>;
  heartbeatMs?: number;
  summary?: (o: Observation) => string;
}) {
  const cfg = { ...DEFAULT_MONITOR, ...opts.cfg };
  const failures: Record<string, number> = {};
  let active = new Map<string, Problem>();
  let lastHeartbeat = Number.NEGATIVE_INFINITY; // first round announces the monitor is up
  let last: { at: number; active: Problem[] } | null = null;

  async function round() {
    const o = await opts.observe();
    for (const s of o.services) failures[s.name] = s.ok ? 0 : (failures[s.name] ?? 0) + 1;
    const now = new Map(evaluate(o, failures, cfg).map((p) => [p.code, p]));
    const sent: string[] = [];
    for (const [code, p] of now) {
      // a NAV_AGING → NAV_STALE escalation is a new code, so it pages again
      if (!active.has(code) || active.get(code)!.level !== p.level) {
        await opts.sink.send({ source: "monitor", ...p });
        sent.push(code);
      }
    }
    for (const [code, p] of active) {
      if (!now.has(code)) {
        await opts.sink.send({ source: "monitor", ...p, resolved: true, message: `cleared: ${p.message}` });
        sent.push(`resolved:${code}`);
      }
    }
    active = now;
    if (opts.heartbeatMs && o.now - lastHeartbeat >= opts.heartbeatMs) {
      lastHeartbeat = o.now;
      await opts.sink.send({ source: "monitor", level: "info", code: `HEARTBEAT:${new Date(o.now).toISOString().slice(0, 13)}`, message: `${active.size === 0 ? "all checks green" : `${active.size} open problem(s)`}${opts.summary ? ` · ${opts.summary(o)}` : ""}` });
      sent.push("heartbeat");
    }
    last = { at: o.now, active: [...active.values()] };
    return { sent, active: [...active.values()] };
  }

  return { round, last: () => last, failures: () => ({ ...failures }) };
}
