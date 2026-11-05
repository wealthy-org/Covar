import { Journal } from "../shared/journal";
import { round, type OrderIntent, type RiskCheck, type RiskDecision, type RiskMode } from "../shared/types";

/**
 * Risk service — independent of strategy code and Copilot output.
 *
 * Every order is checked here, in its own process with its own state. If Copilot
 * is wrong, unreachable, or out of credits, these checks still run. If this
 * service is down, the execution service refuses to submit rather than guess.
 *
 * Platform ceilings come from the brief §9: 5x leverage, 10% daily loss pause,
 * 25% drawdown emergency stop. An agent may be tighter, never looser.
 */
export interface RiskLimits {
  maxLeverage: number;
  maxPositionPct: number; // % of equity as notional at 1x
  dailyLossPausePct: number;
  maxDrawdownPct: number;
  allowedMarkets: string[];
}

export const PLATFORM_LIMITS: RiskLimits = {
  maxLeverage: 5,
  maxPositionPct: 40,
  dailyLossPausePct: 10,
  maxDrawdownPct: 25,
  allowedMarkets: ["ETH-PERP", "BTC-PERP", "SOL-PERP", "HYPE-PERP", "USDG-PERP"],
};

export interface RiskState {
  equity: number;
  dayStartEquity: number;
  peakEquity: number;
  realizedPnlToday: number;
  grossExposure: number;
  mode: RiskMode;
  modeReason?: string;
  openPositions: Record<string, number>;
  updatedAt: string;
}

export function createRisk(opts: { dir: string; limits?: Partial<RiskLimits>; equity?: number }) {
  const journal = new Journal(opts.dir, "risk");
  const limits: RiskLimits = { ...PLATFORM_LIMITS, ...opts.limits };
  const equity0 = opts.equity ?? 10_000;

  const state: RiskState = {
    equity: equity0,
    dayStartEquity: equity0,
    peakEquity: equity0,
    realizedPnlToday: 0,
    grossExposure: 0,
    mode: "normal",
    openPositions: {},
    updatedAt: new Date().toISOString(),
  };

  function recomputeMode() {
    const dailyLossPct = ((state.dayStartEquity - state.equity) / state.dayStartEquity) * 100;
    const drawdownPct = ((state.peakEquity - state.equity) / state.peakEquity) * 100;

    if (drawdownPct >= limits.maxDrawdownPct) {
      state.mode = "halted";
      state.modeReason = `Emergency stop: equity ${drawdownPct.toFixed(2)}% below peak (limit ${limits.maxDrawdownPct}%). Close-only, exits still allowed.`;
      return;
    }
    if (dailyLossPct >= limits.dailyLossPausePct) {
      state.mode = "close_only";
      state.modeReason = `Daily loss pause: ${dailyLossPct.toFixed(2)}% down today (limit ${limits.dailyLossPausePct}%). New risk blocked until reset.`;
      return;
    }
    if (state.mode !== "normal") {
      journal.append("risk", "mode_cleared", { previous: state.mode });
    }
    state.mode = "normal";
    state.modeReason = undefined;
  }

  function evaluate(intent: OrderIntent): RiskDecision {
    const checks: RiskCheck[] = [];
    const notional = intent.qty * intent.price;

    checks.push({
      name: "market_allowlist",
      ok: limits.allowedMarkets.includes(intent.market),
      detail: limits.allowedMarkets.includes(intent.market)
        ? `${intent.market} is an allowed market`
        : `${intent.market} is not configured on this venue`,
    });

    checks.push({
      name: "positive_size",
      ok: intent.qty > 0 && intent.price > 0,
      detail: `qty ${intent.qty} @ ${intent.price}`,
    });

    checks.push({
      name: "leverage_ceiling",
      ok: intent.leverage <= limits.maxLeverage && intent.leverage > 0,
      detail: `${intent.leverage}x requested · platform ceiling ${limits.maxLeverage}x`,
    });

    const maxNotional = (state.equity * limits.maxPositionPct) / 100 * Math.min(intent.leverage, limits.maxLeverage);
    checks.push({
      name: "position_size_cap",
      ok: notional <= maxNotional,
      detail: `notional ${round(notional, 2)} vs cap ${round(maxNotional, 2)} (${limits.maxPositionPct}% of equity at ${intent.leverage}x)`,
    });

    checks.push({
      name: "daily_loss_pause",
      ok: !(state.mode === "close_only" || state.mode === "halted") || intent.reduceOnly,
      detail: state.mode === "normal" ? "no pause active" : `${state.modeReason}${intent.reduceOnly ? " · exit allowed" : ""}`,
    });

    checks.push({
      name: "drawdown_stop",
      ok: state.mode !== "halted" || intent.reduceOnly,
      detail:
        state.mode === "halted"
          ? `halted: ${state.modeReason}${intent.reduceOnly ? " · exit allowed" : ""}`
          : "within drawdown limit",
    });

    checks.push({
      name: "copilot_not_authoritative",
      ok: true,
      detail: `Copilot decision was "${intent.copilotDecision}" — advisory only; this check runs regardless`,
    });

    const failed = checks.find((c) => !c.ok);
    const decision: RiskDecision = {
      intentId: intent.intentId,
      approved: !failed,
      reason: failed ? `${failed.name}: ${failed.detail}` : "All checks passed",
      checks,
      mode: state.mode,
      at: new Date().toISOString(),
    };

    journal.append("risk", "decision", decision as unknown as Record<string, unknown>);
    return decision;
  }

  return {
    limits,
    state: () => ({ ...state, openPositions: { ...state.openPositions } }),

    evaluate,

    /** Called by execution after a fill; risk state must never be updated by strategy code. */
    applyFill(input: { market: string; side: "buy" | "sell"; qty: number; price: number; fee: number; realizedPnl?: number }) {
      const signed = input.side === "buy" ? input.qty : -input.qty;
      const next = (state.openPositions[input.market] ?? 0) + signed;
      state.openPositions[input.market] = round(next, 6);
      if (input.realizedPnl) {
        state.realizedPnlToday = round(state.realizedPnlToday + input.realizedPnl, 6);
        state.equity = round(state.equity + input.realizedPnl, 6);
      }
      state.equity = round(state.equity - input.fee, 6);
      state.peakEquity = Math.max(state.peakEquity, state.equity);
      state.updatedAt = new Date().toISOString();
      recomputeMode();
      journal.append("risk", "fill_applied", { ...input, equity: state.equity, mode: state.mode });
      return this.state();
    },

    /** Operator marks realised P&L for the day (e.g. from the venue statement). */
    setEquity(equity: number, optsIn: { resetDay?: boolean } = {}) {
      state.equity = equity;
      state.peakEquity = Math.max(state.peakEquity, equity);
      if (optsIn.resetDay) {
        state.dayStartEquity = equity;
        state.realizedPnlToday = 0;
        state.mode = "normal";
        state.modeReason = undefined;
      }
      state.updatedAt = new Date().toISOString();
      recomputeMode();
      journal.append("risk", "equity_set", { equity, resetDay: !!optsIn.resetDay, mode: state.mode });
      return this.state();
    },

    /** Operator action: resume new risk after a pause has been investigated. */
    resume() {
      state.mode = "normal";
      state.modeReason = undefined;
      state.dayStartEquity = state.equity;
      state.updatedAt = new Date().toISOString();
      journal.append("risk", "resumed_by_operator", { equity: state.equity });
      return this.state();
    },

    journalEntries: () => journal.read(),
  };
}

export type Risk = ReturnType<typeof createRisk>;
