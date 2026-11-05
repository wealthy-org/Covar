import { Journal } from "../shared/journal";
import {
  round,
  TERMINAL,
  type OrderIntent,
  type OrderRecord,
  type OrderStatus,
  type Position,
  type RiskDecision,
  type VenueOrder,
} from "../shared/types";

/**
 * Execution service.
 *
 * Responsibilities the brief calls out (§8): durable intent-to-order state,
 * exchange ids, nonce/keyed idempotency, fills, positions, and restart
 * reconciliation without placing duplicate orders or paying a fee twice.
 *
 * The state machine per order:
 *
 *   queued → risk_rejected                      (terminal)
 *   queued → signed → submitting → submitted → filled
 *                          └── crash here ──→ recover() adopts or resubmits
 *
 * `submitting` is journaled *before* the venue call, so a process that dies after
 * the venue accepts the order knows, on restart, that an order may exist and asks
 * the venue by `clientOrderId` instead of blindly resubmitting.
 */
export interface RiskPort {
  evaluate(intent: OrderIntent): RiskDecision | Promise<RiskDecision>;
  applyFill(input: { market: string; side: "buy" | "sell"; qty: number; price: number; fee: number; realizedPnl?: number }): unknown;
}
export interface SignerPort {
  sign(req: { clientOrderId: string; intent: OrderIntent; destination?: string }):
    | { ok: true; signature: string }
    | { ok: false; error: string }
    | Promise<{ ok: true; signature: string } | { ok: false; error: string }>;
}
export interface VenuePort {
  submit(input: { clientOrderId: string; market: string; side: "buy" | "sell"; qty: number; price: number }): VenueOrder | Promise<VenueOrder>;
  get(clientOrderId: string): VenueOrder | undefined | Promise<VenueOrder | undefined>;
  advance(): void | Promise<void>;
}

export interface ExecutionFaults {
  /** Simulate death after the venue accepted the order but before we journaled the ack. */
  crashAfterVenueAckOnce?: boolean;
  /**
   * Called after `crashed_after_venue_ack` is journaled and before the normal
   * throw. The execution process passes `() => process.exit(137)` so the test is
   * a real SIGKILL-style death, not a caught exception.
   */
  onFault?: (reason: string) => void;
}

export interface RecoveryReport {
  at: string;
  scanned: number;
  adopted: string[];
  resubmitted: string[];
  alreadyTerminal: string[];
  duplicatePrevented: number;
  note: string;
}

export function createExecution(opts: {
  dir: string;
  risk: RiskPort;
  signer: SignerPort;
  exchange: VenuePort;
  faults?: ExecutionFaults;
}) {
  const journal = new Journal(opts.dir, "execution");
  const { risk, signer, exchange, faults } = opts;
  const orders = new Map<string, OrderRecord>();
  const intents = new Map<string, OrderIntent>();
  const intentIndex = new Map<string, string>(); // intentId → clientOrderId
  const positions = new Map<string, Position>();
  let newRiskPaused = false;
  let lastRecovery: RecoveryReport | null = null;
  let venueCallCount = 0;

  const clientIdFor = (intentId: string) => `c-${intentId}`;
  const now = () => new Date().toISOString();

  /* ------------------------------------------------------------ replay on boot */
  for (const entry of journal.resume()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- journal payloads are heterogeneous by design
    const p = entry.payload as Record<string, any>;
    switch (entry.type) {
      case "intent_accepted":
        intents.set(p.intentId, {
          intentId: p.intentId,
          agentId: p.agentId ?? "unknown",
          market: p.market,
          side: p.side,
          qty: p.qty,
          price: p.price,
          reduceOnly: !!p.reduceOnly,
          leverage: p.leverage ?? 1,
          strategyVersion: p.strategyVersion ?? 1,
          proposedBy: p.proposedBy ?? "rules",
          copilotDecision: p.copilotDecision ?? "rules_only",
          createdAt: entry.at,
        });
        orders.set(p.clientOrderId, {
          clientOrderId: p.clientOrderId,
          intentId: p.intentId,
          market: p.market,
          side: p.side,
          qty: p.qty,
          price: p.price,
          reduceOnly: !!p.reduceOnly,
          status: "queued",
          filledQty: 0,
          avgFillPrice: 0,
          appliedFillIds: [],
          attempts: 0,
          updatedAt: entry.at,
        });
        intentIndex.set(p.intentId, p.clientOrderId);
        break;
      case "status": {
        const o = orders.get(p.clientOrderId);
        if (o) {
          o.status = p.status as OrderStatus;
          o.updatedAt = entry.at;
          if (p.venueOrderId) o.venueOrderId = p.venueOrderId;
          if (p.signature) o.signature = p.signature;
          if (p.attempts !== undefined) o.attempts = p.attempts;
          if (p.lastError !== undefined) o.lastError = p.lastError;
        }
        break;
      }
      case "fill_applied": {
        const o = orders.get(p.clientOrderId);
        if (o) {
          o.appliedFillIds.push(p.fillId);
          o.filledQty = round(o.filledQty + p.qty, 6);
          o.avgFillPrice = p.price;
        }
        const pos = positions.get(p.market) ?? { market: p.market, qty: 0, avgPrice: 0, realizedPnl: 0 };
        const signed = p.side === "buy" ? p.qty : -p.qty;
        if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
          pos.avgPrice = round((Math.abs(pos.qty) * pos.avgPrice + p.qty * p.price) / Math.abs(pos.qty + signed || 1), 2);
          pos.qty = round(pos.qty + signed, 6);
        } else {
          const closing = Math.min(Math.abs(pos.qty), p.qty);
          const pnl = p.side === "buy" ? (pos.avgPrice - p.price) * closing : (p.price - pos.avgPrice) * closing;
          pos.realizedPnl = round(pos.realizedPnl + pnl - p.fee, 6);
          pos.qty = round(pos.qty + signed, 6);
          if (pos.qty === 0) pos.avgPrice = 0;
        }
        positions.set(p.market, pos);
        break;
      }
    }
  }

  function setStatus(o: OrderRecord, status: OrderStatus, extra: Record<string, unknown> = {}) {
    o.status = status;
    o.updatedAt = now();
    // `extra` (venueOrderId, signature, lastError, attempts) is part of the record,
    // not just the audit line — otherwise the UI shows a status with no reason.
    const { clientOrderId: _ignored, status: _s, ...rest } = extra as Record<string, unknown>;
    Object.assign(o, rest);
    journal.append("execution", "status", { clientOrderId: o.clientOrderId, status, ...extra });
  }

  /* --------------------------------------------------------------- accept intent */
  async function submitIntent(intent: OrderIntent) {
    const clientOrderId = clientIdFor(intent.intentId);
    const existing = orders.get(clientOrderId);
    if (existing) {
      journal.append("execution", "intent_deduplicated", {
        intentId: intent.intentId,
        clientOrderId,
        status: existing.status,
      });
      return existing; // replaying an intent never creates a second order
    }
    const order: OrderRecord = {
      clientOrderId,
      intentId: intent.intentId,
      market: intent.market,
      side: intent.side,
      qty: intent.qty,
      price: intent.price,
      reduceOnly: intent.reduceOnly,
      status: "queued",
      filledQty: 0,
      avgFillPrice: 0,
      appliedFillIds: [],
      attempts: 0,
      updatedAt: now(),
    };
    orders.set(clientOrderId, order);
    intents.set(intent.intentId, intent);
    intentIndex.set(intent.intentId, clientOrderId);
    journal.append("execution", "intent_accepted", {
      clientOrderId,
      intentId: intent.intentId,
      market: intent.market,
      side: intent.side,
      qty: intent.qty,
      price: intent.price,
      reduceOnly: intent.reduceOnly,
      leverage: intent.leverage,
      strategyVersion: intent.strategyVersion,
      proposedBy: intent.proposedBy,
      copilotDecision: intent.copilotDecision,
      agentId: intent.agentId,
      createdAt: intent.createdAt,
    });
    return order;
  }

  /* ------------------------------------------------------------------ processing */
  async function processOne(order: OrderRecord, intent: OrderIntent) {
    // An operator pause holds new risk — it does not destroy the intent. The order
    // stays queued and resumes when the pause is lifted; exits keep flowing.
    if (newRiskPaused && !order.reduceOnly) {
      const note = "held — new risk paused by operator";
      if (order.lastError !== note) {
        order.lastError = note;
        journal.append("execution", "held_by_pause", { clientOrderId: order.clientOrderId });
      }
      return;
    }

    if (order.lastError?.includes("paused by operator")) order.lastError = undefined;

    // 1 — risk is consulted on every attempt, never cached from a previous run
    const decision = await risk.evaluate(intent);
    order.riskDecision = decision;
    if (!decision.approved) {
      setStatus(order, "risk_rejected", { lastError: decision.reason });
      return;
    }

    // 2 — signature from the isolated signer
    const sig = await signer.sign({ clientOrderId: order.clientOrderId, intent });
    if (!sig.ok) {
      setStatus(order, "failed", { lastError: sig.error });
      return;
    }

    // 3 — durable "I am about to submit" record, journaled BEFORE the venue call
    order.attempts += 1;
    setStatus(order, "submitting", { attempts: order.attempts, signature: sig.signature });

    venueCallCount += 1;
    const venueOrder = await exchange.submit({
      clientOrderId: order.clientOrderId,
      market: order.market,
      side: order.side,
      qty: order.qty,
      price: order.price,
    });

    // 4 — the crash window: venue accepted, our ack was never written
    if (faults?.crashAfterVenueAckOnce) {
      faults.crashAfterVenueAckOnce = false;
      journal.append("execution", "crashed_after_venue_ack", { clientOrderId: order.clientOrderId, venueOrderId: venueOrder.orderId });
      faults.onFault?.(`crash after venue ack for ${order.clientOrderId}`);
      throw new Error(
        `simulated crash after venue ack for ${order.clientOrderId} (venueOrderId ${venueOrder.orderId}); journal says "submitting" with no ack`
      );
    }

    setStatus(order, "submitted", { venueOrderId: venueOrder.orderId, signature: sig.signature });
  }

  async function applyVenueFills(order: OrderRecord) {
    const venueOrder = await exchange.get(order.clientOrderId);
    if (!venueOrder || venueOrder.status !== "filled") return;
    for (const fill of venueOrder.fills) {
      if (order.appliedFillIds.includes(fill.fillId)) continue; // idempotent fill processing
      order.appliedFillIds.push(fill.fillId);
      order.filledQty = round(order.filledQty + fill.qty, 6);
      order.avgFillPrice = fill.price;

      const pos = positions.get(order.market) ?? { market: order.market, qty: 0, avgPrice: 0, realizedPnl: 0 };
      const signed = order.side === "buy" ? fill.qty : -fill.qty;
      let realized = 0;
      if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
        pos.avgPrice = round((Math.abs(pos.qty) * pos.avgPrice + fill.qty * fill.price) / Math.abs(pos.qty + signed || 1), 2);
        pos.qty = round(pos.qty + signed, 6);
      } else {
        const closing = Math.min(Math.abs(pos.qty), fill.qty);
        realized = order.side === "buy" ? (pos.avgPrice - fill.price) * closing : (fill.price - pos.avgPrice) * closing;
        pos.realizedPnl = round(pos.realizedPnl + realized - fill.fee, 6);
        pos.qty = round(pos.qty + signed, 6);
        if (pos.qty === 0) pos.avgPrice = 0;
      }
      positions.set(order.market, pos);

      journal.append("execution", "fill_applied", {
        clientOrderId: order.clientOrderId,
        fillId: fill.fillId,
        market: order.market,
        side: order.side,
        qty: fill.qty,
        price: fill.price,
        fee: fill.fee,
      });

      await risk.applyFill({ market: order.market, side: order.side, qty: fill.qty, price: fill.price, fee: fill.fee, realizedPnl: realized });
    }
    setStatus(order, "filled");
  }

  /** One pass of the worker loop. Idempotent: safe to call on a timer or after a restart. */
  async function tick() {
    await exchange.advance();
    for (const order of orders.values()) {
      if (TERMINAL.includes(order.status)) continue;
      if (order.status === "submitted") {
        await applyVenueFills(order);
        continue;
      }
      const intent = intents.get(order.intentId);
      if (!intent) continue;
      await processOne(order, intent);
    }
    for (const order of orders.values()) {
      if (order.status === "submitted") await applyVenueFills(order);
    }
    return state();
  }

  /* -------------------------------------------------------------- reconciliation */
  /**
   * Reconciles this service's journal against the venue. Runs on boot, and can be
   * triggered by the operator. Never resubmits with a fresh key: the same
   * `clientOrderId` is reused so the venue itself deduplicates.
   */
  async function recover(): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      at: now(),
      scanned: 0,
      adopted: [],
      resubmitted: [],
      alreadyTerminal: [],
      duplicatePrevented: 0,
      note: "Journal is authoritative for intent; the venue is authoritative for existence.",
    };

    for (const order of orders.values()) {
      if (TERMINAL.includes(order.status) || order.status === "queued" || order.status === "signed") continue;
      report.scanned++;
      const venueOrder = await exchange.get(order.clientOrderId);

      if (venueOrder) {
        // The venue already has this clientOrderId — adopt it, never submit again.
        report.adopted.push(order.clientOrderId);
        if (venueOrder.orderId !== order.venueOrderId) report.duplicatePrevented++;
        journal.append("execution", "recovered_adopted", {
          clientOrderId: order.clientOrderId,
          venueOrderId: venueOrder.orderId,
          previousStatus: order.status,
        });
        setStatus(order, "submitted", { venueOrderId: venueOrder.orderId, lastError: undefined });
        await applyVenueFills(order);
      } else {
        // Nothing at the venue: safe to retry, with the same key.
        report.resubmitted.push(order.clientOrderId);
        journal.append("execution", "recovered_resubmit", { clientOrderId: order.clientOrderId, previousStatus: order.status });
        setStatus(order, "signed");
      }
    }

    journal.append("execution", "recovery_report", report as unknown as Record<string, unknown>);
    lastRecovery = report;
    return report;
  }

  function state() {
    const all = [...orders.values()];
    return {
      orders: all,
      positions: [...positions.values()],
      queueDepth: all.filter((o) => !TERMINAL.includes(o.status)).length,
      newRiskPaused,
      venueCalls: venueCallCount,
      intents: [...intents.values()],
      lastRecovery,
      counts: {
        total: all.length,
        queued: all.filter((o) => o.status === "queued").length,
        submitting: all.filter((o) => o.status === "submitting").length,
        submitted: all.filter((o) => o.status === "submitted").length,
        filled: all.filter((o) => o.status === "filled").length,
        rejected: all.filter((o) => o.status === "risk_rejected").length,
        failed: all.filter((o) => o.status === "failed").length,
      },
    };
  }

  return {
    submitIntent,
    tick,
    recover,
    state,
    journalEntries: () => journal.read(),
    setNewRiskPaused: (paused: boolean) => {
      newRiskPaused = paused;
      journal.append("execution", "pause_changed", { newRiskPaused: paused });
      return state();
    },
    getOrder: (clientOrderId: string) => orders.get(clientOrderId),
    intentClientId: clientIdFor,
  };
}

export type Execution = ReturnType<typeof createExecution>;
