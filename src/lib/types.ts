// Shared domain types for Covar.
// Provenance categories are first-class: the brief forbids merging backtest,
// practice, test-exchange and real-money records into one misleading metric.

export type Provenance = "backtest" | "practice" | "testnet" | "live" | "vault";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  backtest: "Historical backtest",
  practice: "Practice (simulated ticks)",
  testnet: "Test exchange",
  live: "Real money",
  vault: "Vault share price",
};

export type AgentStatus = "draft" | "backtesting" | "practice" | "live" | "paused" | "winding_down";

export type Operator = "and" | "or";

export interface Condition {
  id: string;
  left: string; // e.g. "EMA(20)"
  op: "crossesAbove" | "crossesBelow" | ">" | "<" | ">=" | "<=";
  right: string; // e.g. "EMA(50)" or "3200"
}

export interface Strategy {
  id: string;
  agentId: string;
  version: number;
  name: string;
  market: string; // "ETH-PERP"
  venue: string; // "Lighter"
  timeframe: "5m" | "15m" | "1h" | "4h";
  indicators: { id: string; kind: "ema" | "rsi" | "atr" | "bollinger" | "volume"; period: number }[];
  entryLogic: Operator;
  entry: Condition[];
  exitLogic: Operator;
  exit: Condition[];
  risk: {
    leverage: number;
    maxPositionPct: number;
    stopLossPct: number;
    takeProfitPct: number;
    dailyLossPausePct: number;
    maxDrawdownPct: number;
  };
  copilot: {
    mode: "off" | "advisory" | "veto";
    allowExtraTrades: boolean;
    fallbackToRules: boolean;
    rulesOnlyTwin: boolean;
  };
  feeChoicePct: number; // creator fee on winning trades, max 20
  notes: string;
  createdAt: string;
  publishedAt?: string;
}

export interface Decision {
  id: string;
  ts: string;
  market: string;
  inputs: string;
  proposed: string;
  aiDecision: "approve" | "reduce" | "reject" | "rules_only";
  riskDecision: "approved" | "rejected";
  riskReason?: string;
  order?: string;
  outcome?: string;
}

export interface VersionEntry {
  version: number;
  ts: string;
  summary: string;
  status: "superseded" | "active" | "pending_investor_notice";
  notice: string;
}

export interface VaultInfo {
  address: string;
  chain: "robinhood-testnet" | "robinhood-mainnet";
  navPerShare: number;
  tvlUsd: number;
  sharesOutstanding: number;
  sharePriceHistory: number[];
  depositFeePct: number;
  depositFeeFlat: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  unwindDays: number;
}

export interface Agent {
  id: string;
  name: string;
  tagline: string;
  creatorId: string;
  status: AgentStatus;
  market: string;
  timeframe: string;
  provenance: Provenance;
  score: number;
  tvlUsd: number;
  returnPct: number;
  drawdownPct: number;
  liveAgeDays: number;
  tradeCount: number;
  version: number;
  curve: number[];
  benchmark: number[];
  twin?: number[];
  decisions: Decision[];
  versions: VersionEntry[];
  vault?: VaultInfo;
  strategySummary: string;
  riskSummary: string;
  disclosure?: string;
  isMine?: boolean;
}

export interface Creator {
  id: string;
  handle: string;
  name: string;
  joined: string;
  bio: string;
  agentIds: string[];
  followers: number;
  verified: boolean;
}

export interface LedgerRow {
  id: string;
  ts: string;
  kind:
    | "deposit"
    | "withdrawal_request"
    | "withdrawal_claim"
    | "fee_deposit"
    | "trade_fee"
    | "creator_share"
    | "platform_share"
    | "ai_credit"
    | "pnl";
  agentId?: string;
  label: string;
  amountUsd: number;
  state: "settled" | "pending" | "escrowed";
  txHash?: string;
  note?: string;
}

export interface Holding {
  agentId: string;
  shares: number;
  costBasisUsd: number;
  entryNav: number;
  requestedWithdrawal?: {
    shares: number;
    requestedAt: string;
    state: "closing_positions" | "settling" | "claimable" | "claimed";
    estUsd: number;
  };
}

export interface Portfolio {
  wallet: string;
  chain: string;
  cashUsd: number;
  creditUsd: number;
  holdings: Holding[];
  ledger: LedgerRow[];
}

export interface PracticeRun {
  agentId: string;
  startedAt: string;
  capitalUsd: number;
  pnlUsd: number;
  ticks: number;
  status: "running" | "stopped";
  /** Where the marks come from. Never blended: the UI labels which one is in use. */
  priceMode: "live" | "simulated";
  /** Last observed mark, so P&L is a price change and not an invented wave. */
  lastPrice?: number;
  entryPrice?: number;
  priceSource?: string;
}

export type NotificationKind = "practice" | "publish" | "money" | "risk" | "copilot" | "system";

export interface AppNotification {
  id: string;
  ts: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  read: boolean;
}

export interface CovarState {
  /** Wallet gate state. Which provider produced the connection is recorded; "connected" does not imply a signature. */
  walletConnected: boolean;
  walletProviderId?: string;
  walletGuarantee?: string;
  /** In-app inbox. Written only by explicit user actions and by observed system events. */
  notifications: AppNotification[];
  /** Signed-in (SIWE) wallet that owns this state, lower-case. Undefined = anonymous device state. */
  owner?: string;
  /** Set by the session-sync route when the snapshot was durably stored. Local-only state has none. */
  savedAt?: string;
  agents: Agent[];
  creators: Creator[];
  portfolio: Portfolio;
  practice: Record<string, PracticeRun>;
  drafts: Strategy[];
  liveStrategy: Record<string, Strategy>;
}
