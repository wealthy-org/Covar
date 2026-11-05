// Shared types for the Covar execution plane.
// The web app never signs anything: intents flow web → execution → risk → signer → venue.

export type Side = "buy" | "sell";

export type OrderStatus =
  | "queued" // durable, not yet risk-checked
  | "risk_rejected" // terminal: risk service said no
  | "signed" // signature obtained, not yet submitted
  | "submitting" // submitted to the venue, ack not journaled (crash window)
  | "submitted" // venue accepted, awaiting fill
  | "filled" // terminal
  | "failed"; // terminal: venue error or exhausted retries

export const TERMINAL: OrderStatus[] = ["filled", "failed", "risk_rejected"];

export interface OrderIntent {
  /** Idempotency key produced once by the caller. Replaying it must never double-trade. */
  intentId: string;
  agentId: string;
  market: string;
  side: Side;
  qty: number;
  price: number;
  /** Exits are allowed in close-only mode; new risk is not. */
  reduceOnly: boolean;
  leverage: number;
  strategyVersion: number;
  proposedBy: "rules" | "copilot";
  copilotDecision: "approve" | "reduce" | "reject" | "rules_only";
  createdAt: string;
}

export interface RiskCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RiskDecision {
  intentId: string;
  approved: boolean;
  reason: string;
  checks: RiskCheck[];
  mode: RiskMode;
  at: string;
}

export type RiskMode = "normal" | "close_only" | "halted";

export interface Fill {
  fillId: string;
  clientOrderId: string;
  qty: number;
  price: number;
  fee: number;
  at: string;
}

export interface VenueOrder {
  clientOrderId: string;
  orderId: string;
  market: string;
  side: Side;
  qty: number;
  price: number;
  status: "open" | "filled" | "rejected";
  filledQty: number;
  avgFillPrice: number;
  fills: Fill[];
  createdAt: string;
}

export interface OrderRecord {
  clientOrderId: string;
  intentId: string;
  market: string;
  side: Side;
  qty: number;
  price: number;
  reduceOnly: boolean;
  status: OrderStatus;
  venueOrderId?: string;
  filledQty: number;
  avgFillPrice: number;
  appliedFillIds: string[];
  attempts: number;
  signature?: string;
  riskDecision?: RiskDecision;
  lastError?: string;
  updatedAt: string;
}

export interface Position {
  market: string;
  qty: number;
  avgPrice: number;
  realizedPnl: number;
}

export interface JournalEntry {
  seq: number;
  at: string;
  service: string;
  type: string;
  payload: Record<string, unknown>;
}

export const round = (n: number, dp = 6) => Number(n.toFixed(dp));
