import path from "node:path";
import { Journal } from "../shared/journal";
import { round, type Fill, type OrderIntent, type Side, type VenueOrder } from "../shared/types";
import { mulberry32, hashSeed } from "@/lib/format";

/**
 * Paper venue — a stand-in for the Lighter test venue.
 *
 * It exists so the execution plane can be exercised against a venue that behaves
 * like one: keyed by `clientOrderId` (so a retried submit cannot create a second
 * order), asynchronous fills, and the ability to drop a response after accepting
 * the order. It is NOT a real exchange and says so everywhere it is surfaced.
 */
export interface ExchangeOptions {
  dir: string;
  /** Polls required before an accepted order reports its fill (default 1). */
  fillDelayPolls?: number;
  /** Simulate slippage in basis points, deterministic per clientOrderId. */
  slippageBps?: number;
}

export function createExchange(opts: ExchangeOptions) {
  const journal = new Journal(opts.dir, "exchange");
  const orders = new Map<string, VenueOrder>();
  const polls = new Map<string, number>();
  const fills: Fill[] = [];
  const positions = new Map<string, { qty: number; avgPrice: number; realizedPnl: number }>();
  const fillDelay = opts.fillDelayPolls ?? 1;
  const slippageBps = opts.slippageBps ?? 4;

  // Rebuild from the journal on boot. A venue that forgets its own clientOrderIds
  // after a restart cannot deduplicate, which is exactly the failure the execution
  // plane relies on it not to have.
  for (const entry of journal.resume()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- journal payloads are heterogeneous by design
    const p = entry.payload as Record<string, any>;
    if (entry.type === "order_accepted" && p.clientOrderId && !orders.get(p.clientOrderId)) {
      orders.set(p.clientOrderId, {
        clientOrderId: p.clientOrderId,
        orderId: p.orderId,
        market: p.market,
        side: p.side ?? "buy",
        qty: Number(p.qty ?? 0),
        price: Number(p.price ?? 0),
        status: "open",
        filledQty: 0,
        avgFillPrice: 0,
        fills: [],
        createdAt: entry.at,
      });
      polls.set(p.clientOrderId, 0);
    }
    if (entry.type === "fill") {
      const order = orders.get(p.clientOrderId);
      if (order && !order.fills.some((f) => f.fillId === p.fillId)) {
        const fill: Fill = {
          fillId: p.fillId ?? `${order.orderId}-f1`,
          clientOrderId: p.clientOrderId,
          qty: Number(p.qty ?? order.qty),
          price: Number(p.price ?? 0),
          fee: Number(p.fee ?? 0),
          at: entry.at,
        };
        order.fills.push(fill);
        order.filledQty = round(order.filledQty + fill.qty, 6);
        order.avgFillPrice = fill.price;
        if (order.filledQty >= order.qty) order.status = "filled";
        fills.push(fill);
        applyToPosition(order.side, order.market, fill);
      }
    }
  }

  function submit(input: { clientOrderId: string; market: string; side: Side; qty: number; price: number }) {
    const existing = orders.get(input.clientOrderId);
    if (existing) {
      journal.append("exchange", "submit_deduplicated", {
        clientOrderId: input.clientOrderId,
        orderId: existing.orderId,
      });
      return existing; // idempotent: same key → same order, never a second one
    }
    const orderId = `v-${hashSeed(input.clientOrderId).toString(36)}`;
    const order: VenueOrder = {
      clientOrderId: input.clientOrderId,
      orderId,
      market: input.market,
      side: input.side,
      qty: input.qty,
      price: input.price,
      status: "open",
      filledQty: 0,
      avgFillPrice: 0,
      fills: [],
      createdAt: new Date().toISOString(),
    };
    orders.set(input.clientOrderId, order);
    polls.set(input.clientOrderId, 0);
    journal.append("exchange", "order_accepted", {
      clientOrderId: input.clientOrderId,
      orderId,
      market: input.market,
      side: input.side,
      qty: input.qty,
      price: input.price,
    });
    return order;
  }

  /** Advances the simulated matching engine. Called by the execution service tick. */
  function advance() {
    for (const [key, order] of orders) {
      if (order.status !== "open") continue;
      const n = (polls.get(key) ?? 0) + 1;
      polls.set(key, n);
      if (n < fillDelay) continue;

      const rnd = mulberry32(hashSeed(key));
      const slip = (slippageBps / 10_000) * (rnd() - 0.5) * 2;
      const price = round(order.price * (1 + slip), 2);
      const fee = round(order.qty * price * 0.00045, 6); // 4.5 bps taker, same as the backtest assumption
      const fill: Fill = {
        fillId: `${order.orderId}-f1`,
        clientOrderId: key,
        qty: order.qty,
        price,
        fee,
        at: new Date().toISOString(),
      };
      order.status = "filled";
      order.filledQty = order.qty;
      order.avgFillPrice = price;
      order.fills = [fill];
      fills.push(fill);
      applyToPosition(order.side, order.market, fill);
      journal.append("exchange", "fill", { clientOrderId: key, orderId: order.orderId, qty: order.qty, price, fee, fillId: fill.fillId });
    }
  }

  function applyToPosition(side: Side, market: string, fill: Fill) {
    const pos = positions.get(market) ?? { qty: 0, avgPrice: 0, realizedPnl: 0 };
    const signed = side === "buy" ? fill.qty : -fill.qty;
    if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
      const newQty = pos.qty + signed;
      pos.avgPrice = round((Math.abs(pos.qty) * pos.avgPrice + fill.qty * fill.price) / Math.abs(newQty || 1), 2);
      pos.qty = round(newQty, 6);
    } else {
      const closing = Math.min(Math.abs(pos.qty), fill.qty);
      const pnl = side === "buy" ? (pos.avgPrice - fill.price) * closing : (fill.price - pos.avgPrice) * closing;
      pos.realizedPnl = round(pos.realizedPnl + pnl - fill.fee, 6);
      pos.qty = round(pos.qty + signed, 6);
      if (pos.qty === 0) pos.avgPrice = 0;
    }
    positions.set(market, pos);
  }

  return {
    orderDir: path.basename(opts.dir),
    submit,
    advance,
    get(clientOrderId: string) {
      return orders.get(clientOrderId);
    },
    allOrders() {
      return [...orders.values()];
    },
    positions() {
      return [...positions.entries()].map(([market, p]) => ({ market, ...p }));
    },
    fills() {
      return fills;
    },
    journalEntries() {
      return journal.read();
    },
  };
}

export type Exchange = ReturnType<typeof createExchange>;

export const demoIntent = (over: Partial<OrderIntent> = {}): OrderIntent => ({
  intentId: `intent-${Math.random().toString(36).slice(2, 9)}`,
  agentId: "ag-01",
  market: "ETH-PERP",
  side: "buy",
  qty: 0.25,
  price: 3180,
  reduceOnly: false,
  leverage: 3,
  strategyVersion: 4,
  proposedBy: "rules",
  copilotDecision: "approve",
  createdAt: new Date().toISOString(),
  ...over,
});
