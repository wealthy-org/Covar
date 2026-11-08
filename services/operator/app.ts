/**
 * Operator service (package 3.3) — the automated "wallet B".
 *
 * Each cycle it reads the vault and the venue, computes the NAV it can prove,
 * and decides — with a pure, testable `plan()` — which operator transactions are
 * due:
 *
 *   1. reportNav      when the report is getting old or the value moved, but only
 *                     inside a deviation band; anything bigger is HELD for a human
 *   2. close → mark   withdrawal requests in ClosingPositions: reduce-only exits for
 *                     the investor's share of every open position (through the
 *                     execution service, so risk and idempotency still apply),
 *                     then markPositionsClosed once those exits are terminal
 *   3. settle         Settling requests at shares × fresh NAV, funded from free
 *                     vault liquidity, topped up from the operator wallet when the
 *                     venue has already paid capital back to it (opt-in)
 *   4. allocate       optional: move idle USDG above a reserve to the trading
 *                     account (v2 vaults only; destination fixed by the owner)
 *
 * NAV = vault USDG − USDG reserved for settled claims + venue equity (+ declared
 *       in-transit). Every term is read, none is assumed; a missing venue reading
 *       blocks the report instead of silently counting it as zero.
 *
 * Default mode is dry-run: the plan is computed and journaled, nothing is sent.
 */
import { Journal } from "../shared/journal";

export type RequestState = "None" | "ClosingPositions" | "Settling" | "Claimable" | "Claimed";

export interface VaultSnapshot {
  isV2: boolean;
  now: number; // chain time (s)
  reportedAssets: bigint;
  totalShares: bigint;
  lastNavUpdate: number;
  maxNavAge: number;
  maxNavChangeBps: number;
  depositsPaused: boolean;
  closeOnly: boolean;
  vaultBalance: bigint;
  reservedForClaims: bigint;
  availableLiquidity: bigint;
  tradingAccount: string | null;
  operatorUsdg: bigint;
  operatorGasWei: bigint;
  requests: { investor: string; shares: bigint; requestedAt: number; state: RequestState }[];
}

export type Action =
  | { kind: "reportNav"; assets: bigint; reason: string }
  | { kind: "closePositions"; investor: string; requestedAt: number; fraction: number; reason: string }
  | { kind: "markPositionsClosed"; investor: string; reason: string }
  | { kind: "fundVault"; amount: bigint; reason: string }
  | { kind: "settleWithdrawal"; investor: string; netAssets: bigint; reason: string }
  | { kind: "allocateToVenue"; amount: bigint; reason: string };

export type Alert = { level: "warn" | "critical"; code: string; message: string };

export interface OperatorConfig {
  /** Report again when the last report is older than this (s). Default: half of maxNavAge. */
  navRefreshSec?: number;
  /** Report when NAV moved at least this much (bps). */
  minChangeBps: number;
  /** Never auto-report a change larger than this (bps); hold and alert instead. */
  maxAutoChangeBps: number;
  /** USDG (6 dp) declared in transit between vault and venue. */
  inTransit: bigint;
  autoFundFromOperatorWallet: boolean;
  /**
   * Count USDG sitting in the operator wallet as vault capital (venue → wallet B →
   * vault return path). Defaults to `autoFundFromOperatorWallet`. Wallet B must
   * then hold vault capital only.
   */
  operatorWalletInNav?: boolean;
  /** Allocation not visible at the venue after this long (s) → alert. */
  transitTimeoutSec: number;
  autoAllocate: boolean;
  /** Keep this share of NAV idle in the vault for withdrawals (bps). */
  idleReserveBps: number;
  minAllocate: bigint;
  minGasWei: bigint;
}

export const DEFAULT_CONFIG: OperatorConfig = {
  minChangeBps: 50,
  maxAutoChangeBps: 500,
  inTransit: 0n,
  autoFundFromOperatorWallet: false,
  transitTimeoutSec: 3600,
  autoAllocate: false,
  idleReserveBps: 2_000,
  minAllocate: 10_000_000n,
  minGasWei: 50_000_000_000_000n, // 0.00005 ETH ≈ 50 operator txs at 0.01 gwei
};

/** Close status per investor, supplied by the close port. */
export type CloseStatus = "not_started" | "pending" | "done" | "failed";

export interface PlanInput {
  vault: VaultSnapshot;
  /** Venue equity in USDG (6 dp). `null` = the venue could not be read → no NAV report. */
  venueEquity: bigint | null;
  closeStatus: (r: { investor: string; requestedAt: number }) => CloseStatus;
  cfg: OperatorConfig;
}

export interface Plan {
  computedNav: bigint | null;
  navAfter: bigint; // reported assets after this plan's report (or unchanged)
  navFreshAfter: boolean;
  actions: Action[];
  alerts: Alert[];
  notes: string[];
}

const bps = (a: bigint, b: bigint) => (b === 0n ? (a === 0n ? 0 : Number.POSITIVE_INFINITY) : Number(((a > b ? a - b : b - a) * 10_000n) / b));
const fmt = (v: bigint) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
};

export function plan({ vault: v, venueEquity, closeStatus, cfg }: PlanInput): Plan {
  const actions: Action[] = [];
  const alerts: Alert[] = [];
  const notes: string[] = [];

  // ---------------------------------------------------------------- 1. NAV
  const navAge = v.lastNavUpdate === 0 ? Number.POSITIVE_INFINITY : v.now - v.lastNavUpdate;
  const refresh = cfg.navRefreshSec ?? Math.floor(v.maxNavAge / 2);
  let computedNav: bigint | null = null;
  let navAfter = v.reportedAssets;
  let navFreshAfter = navAge <= v.maxNavAge;

  if (venueEquity === null) {
    alerts.push({ level: "critical", code: "VENUE_UNREADABLE", message: "Venue equity could not be read — NAV not reported (a missing term is never counted as zero)." });
  } else {
    const walletTerm = (cfg.operatorWalletInNav ?? cfg.autoFundFromOperatorWallet) ? v.operatorUsdg : 0n;
    computedNav = v.vaultBalance - v.reservedForClaims + venueEquity + cfg.inTransit + walletTerm;
    if (computedNav < 0n) computedNav = 0n;
    const change = bps(computedNav, v.reportedAssets);
    const contractCap = v.reportedAssets === 0n ? Number.POSITIVE_INFINITY : v.maxNavChangeBps;
    const due = navAge >= refresh || change >= cfg.minChangeBps;
    notes.push(
      `NAV: vault ${fmt(v.vaultBalance)} − reserved ${fmt(v.reservedForClaims)} + venue ${fmt(venueEquity)} + in-transit ${fmt(cfg.inTransit)}${walletTerm ? ` + operator wallet ${fmt(walletTerm)}` : ""} = ${fmt(computedNav)} USDG (reported ${fmt(v.reportedAssets)}, Δ ${Number.isFinite(change) ? `${change} bps` : "first report"}, age ${Number.isFinite(navAge) ? `${navAge}s` : "never"})`,
    );
    const firstReport = v.reportedAssets === 0n;
    if (due) {
      if (!firstReport && (change > cfg.maxAutoChangeBps || change > contractCap)) {
        alerts.push({
          level: "critical",
          code: "NAV_DEVIATION_HELD",
          message: `Computed NAV ${fmt(computedNav)} differs ${change} bps from reported ${fmt(v.reportedAssets)} (auto limit ${cfg.maxAutoChangeBps} bps, contract cap ${v.maxNavChangeBps} bps). Held for manual review.`,
        });
      } else {
        actions.push({ kind: "reportNav", assets: computedNav, reason: navAge >= refresh ? `report is ${Number.isFinite(navAge) ? `${navAge}s` : "missing"} old (refresh at ${refresh}s)` : `NAV moved ${change} bps` });
        navAfter = computedNav;
        navFreshAfter = true;
      }
    }
  }
  if (!navFreshAfter) alerts.push({ level: "critical", code: "NAV_STALE", message: "NAV is stale and was not refreshed: deposits are blocked and settlements wait." });

  // ---------------------------------------------------------------- 2–3. withdrawals
  // navPerShare after this cycle's report; totalShares still includes escrowed shares
  const navWad = v.totalShares === 0n ? 10n ** 18n : (navAfter * 10n ** 18n) / v.totalShares;
  let liquidity = v.availableLiquidity;
  let operatorUsdg = v.operatorUsdg;
  let pendingWithdrawals = 0;

  for (const r of v.requests) {
    if (r.state === "ClosingPositions") {
      pendingWithdrawals++;
      const s = closeStatus(r);
      if (s === "done") actions.push({ kind: "markPositionsClosed", investor: r.investor, reason: "investor's share of positions is closed at the venue" });
      else if (s === "failed") alerts.push({ level: "critical", code: "CLOSE_FAILED", message: `Closing positions for ${r.investor} failed at the venue — needs a human.` });
      else if (s === "not_started") {
        const fraction = closeFraction(r.shares, v.totalShares);
        actions.push({ kind: "closePositions", investor: r.investor, requestedAt: r.requestedAt, fraction, reason: `${fmt(r.shares)} of ${fmt(v.totalShares)} shares requested out` });
      } else notes.push(`closing positions for ${r.investor}: in progress`);
    } else if (r.state === "Settling") {
      pendingWithdrawals++;
      if (!navFreshAfter) {
        notes.push(`settlement for ${r.investor} waits for a fresh NAV`);
        continue;
      }
      // shares × NAV as one mulDiv (exact for a full redemption, no per-share rounding)
      const net = v.totalShares === 0n ? 0n : (r.shares * navAfter) / v.totalShares;
      if (net > liquidity) {
        const shortfall = net - liquidity;
        if (cfg.autoFundFromOperatorWallet && operatorUsdg >= shortfall) {
          actions.push({ kind: "fundVault", amount: shortfall, reason: `capital returned from the venue sits in the operator wallet; vault needs ${fmt(shortfall)} more to settle ${r.investor}` });
          operatorUsdg -= shortfall;
          liquidity += shortfall;
        } else {
          alerts.push({
            level: "warn",
            code: "LIQUIDITY_SHORTFALL",
            message: `Settling ${r.investor} needs ${fmt(net)} USDG; free in vault ${fmt(liquidity)}. Withdraw ${fmt(shortfall)} USDG from the venue to the operator wallet${cfg.autoFundFromOperatorWallet ? "" : " and send it to the vault (or enable OPERATOR_AUTO_FUND=yes)"}.`,
          });
          continue;
        }
      }
      actions.push({ kind: "settleWithdrawal", investor: r.investor, netAssets: net, reason: `${fmt(r.shares)} shares × NAV/share ${Number(navWad) / 1e18} = ${fmt(net)} USDG` });
      liquidity -= net;
    }
  }

  // ---------------------------------------------------------------- 4. allocation
  if (cfg.autoAllocate) {
    if (!v.isV2) notes.push("auto-allocate skipped: v1 vault has no trading account");
    else if (!v.tradingAccount) notes.push("auto-allocate skipped: owner has not set a trading account");
    else if (v.closeOnly) notes.push("auto-allocate skipped: close-only mode");
    else if (pendingWithdrawals > 0) notes.push("auto-allocate skipped: withdrawals in progress");
    else if (navFreshAfter) {
      const reserve = (navAfter * BigInt(cfg.idleReserveBps)) / 10_000n;
      const excess = liquidity - reserve;
      if (excess >= cfg.minAllocate) actions.push({ kind: "allocateToVenue", amount: excess, reason: `free ${fmt(liquidity)} above the ${cfg.idleReserveBps / 100}% idle reserve ${fmt(reserve)}` });
    }
  }

  // ---------------------------------------------------------------- gas
  if (v.operatorGasWei < cfg.minGasWei) {
    alerts.push({ level: "critical", code: "OPERATOR_GAS_LOW", message: `Operator wallet has ${Number(v.operatorGasWei) / 1e18} ETH for gas (minimum ${Number(cfg.minGasWei) / 1e18}).` });
  }
  if (v.depositsPaused || v.closeOnly) notes.push(`vault is ${v.closeOnly ? "close-only" : "paused for deposits"} — withdrawals continue`);

  return { computedNav, navAfter, navFreshAfter, actions, alerts, notes };
}

/* ------------------------------------------------------------------ runtime */

export interface VaultPort {
  snapshot(): Promise<VaultSnapshot>;
  /** Simulate then send one operator transaction; resolves after the receipt. */
  send(action: Exclude<Action, { kind: "closePositions" }>): Promise<{ hash: string }>;
}
export interface VenueEquityPort {
  /** USDG, 6 dp. Throw if it cannot be read. */
  equity(): Promise<bigint>;
  describe: string;
}
/** Investor's share of a position = request shares / total shares. */
export const closeFraction = (shares: bigint, totalShares: bigint) =>
  totalShares === 0n ? 1 : Number((shares * 1_000_000n) / totalShares) / 1_000_000;

export interface ClosePort {
  describe: string;
  status(req: { investor: string; requestedAt: number }, fraction: number): Promise<CloseStatus>;
  start(req: { investor: string; requestedAt: number }, fraction: number): Promise<void>;
}

export interface CycleReport {
  at: string;
  mode: "dry-run" | "live";
  plan: Omit<Plan, "computedNav" | "navAfter"> & { computedNav: string | null; navAfter: string };
  sent: { kind: string; hash?: string; error?: string }[];
}

const ser = (a: Action) => JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

export function createOperator(opts: {
  dir: string;
  vault: VaultPort;
  venue: VenueEquityPort;
  close: ClosePort;
  cfg?: Partial<OperatorConfig>;
  live: boolean;
  onAlert?: (a: Alert) => void;
}) {
  const journal = new Journal(opts.dir, "operator");
  const cfg: OperatorConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  let last: CycleReport | null = null;
  let running = false;

  // Allocation in transit: sent by the vault, not yet credited at the venue. Without
  // this the NAV would "drop" by the allocated amount until the venue credits it.
  type Transit = { amount: string; equityBefore: string | null; at: number };
  let transit: Transit | null = null;
  for (const e of journal.resume()) {
    if (e.type === "transit_open") transit = e.payload as unknown as Transit;
    if (e.type === "transit_closed") transit = null;
  }

  async function cycle(): Promise<CycleReport> {
    if (running) throw new Error("a cycle is already running");
    running = true;
    try {
      const snap = await opts.vault.snapshot();
      let venueEquity: bigint | null = null;
      try {
        venueEquity = await opts.venue.equity();
      } catch (e) {
        journal.append("operator", "venue_unreadable", { error: (e as Error).message });
      }
      const statuses = new Map<string, CloseStatus>();
      for (const r of snap.requests.filter((x) => x.state === "ClosingPositions")) {
        try {
          statuses.set(r.investor, await opts.close.status(r, closeFraction(r.shares, snap.totalShares)));
        } catch (e) {
          statuses.set(r.investor, "pending");
          journal.append("operator", "close_status_unreadable", { investor: r.investor, error: (e as Error).message });
        }
      }
      let transitAmount = 0n;
      const transitAlerts: Alert[] = [];
      if (transit) {
        const amount = BigInt(transit.amount);
        const before = transit.equityBefore === null ? null : BigInt(transit.equityBefore);
        if (venueEquity !== null && before !== null && venueEquity >= before + (amount * 99n) / 100n) {
          journal.append("operator", "transit_closed", { amount: transit.amount, venueEquity: venueEquity.toString() });
          transit = null;
        } else {
          transitAmount = amount;
          if (snap.now - transit.at > cfg.transitTimeoutSec) {
            transitAlerts.push({ level: "critical", code: "TRANSIT_OVERDUE", message: `${Number(amount) / 1e6} USDG allocated ${Math.round((snap.now - transit.at) / 60)} min ago is still not credited at the venue.` });
          }
        }
      }
      const p = plan({ vault: snap, venueEquity, closeStatus: (r) => statuses.get(r.investor) ?? "not_started", cfg: { ...cfg, inTransit: cfg.inTransit + transitAmount } });
      p.alerts.unshift(...transitAlerts);
      if (transit && p.actions.some((a) => a.kind === "allocateToVenue")) {
        // never stack a second allocation on an uncredited one
        p.actions = p.actions.filter((a) => a.kind !== "allocateToVenue");
        p.notes.push("auto-allocate skipped: previous allocation still in transit");
      }

      const sent: CycleReport["sent"] = [];
      for (const a of p.alerts) opts.onAlert?.(a);
      journal.append("operator", "plan", { live: opts.live, actions: p.actions.map(ser), alerts: p.alerts, notes: p.notes });

      if (opts.live) {
        for (const a of p.actions) {
          try {
            if (a.kind === "closePositions") {
              await opts.close.start(a, a.fraction);
              sent.push({ kind: a.kind });
            } else {
              const { hash } = await opts.vault.send(a);
              sent.push({ kind: a.kind, hash });
              if (a.kind === "allocateToVenue") {
                transit = { amount: a.amount.toString(), equityBefore: venueEquity === null ? null : venueEquity.toString(), at: snap.now };
                journal.append("operator", "transit_open", transit as unknown as Record<string, unknown>);
              }
            }
            journal.append("operator", "action_done", { ...ser(a), hash: sent.at(-1)?.hash });
          } catch (e) {
            const error = (e as Error).message;
            sent.push({ kind: a.kind, error });
            journal.append("operator", "action_failed", { ...ser(a), error });
            opts.onAlert?.({ level: "critical", code: "OPERATOR_TX_FAILED", message: `${a.kind} failed: ${error}` });
            break; // later actions may depend on this one (e.g. settle after reportNav)
          }
        }
      }

      last = {
        at: new Date().toISOString(),
        mode: opts.live ? "live" : "dry-run",
        plan: { ...p, computedNav: p.computedNav?.toString() ?? null, navAfter: p.navAfter.toString(), actions: p.actions.map(ser) },
        sent,
      };
      return last;
    } finally {
      running = false;
    }
  }

  return { cycle, last: () => last, cfg, transit: () => transit, journalEntries: () => journal.read() };
}
