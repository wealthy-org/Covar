
import { describe, expect, it } from "vitest";

import {
  canTransitionStrategyStatus,
  transitionStrategyStatus,
} from "../utils/strategy-lifecycle";

import type { Strategy } from "../types/strategy.types";

const strategy: Strategy = {
  id: "strategy-001",
  name: "RSI Reversal",
  description: "RSI-based entry strategy",
  version: 1,
  status: "draft",

  market: {
    chain: "robinhood-chain",
    network: "testnet",
    symbol: "ETH/USD",
    baseAsset: "ETH",
    quoteAsset: "USD",
    timeframe: "1h",
  },

  indicators: [
    {
      id: "rsi-14",
      type: "RSI",
      parameters: { period: 14 },
    },
  ],

  entryConditions: {
    operator: "AND",
    conditions: [
      {
        id: "entry-1",
        left: {
          type: "indicator",
          indicatorId: "rsi-14",
        },
        operator: "less_than",
        right: {
          type: "constant",
          value: 30,
        },
      },
    ],
  },

  exitConditions: {
    operator: "OR",
    conditions: [
      {
        id: "exit-1",
        left: {
          type: "indicator",
          indicatorId: "rsi-14",
        },
        operator: "greater_than",
        right: {
          type: "constant",
          value: 70,
        },
      },
    ],
  },

  positionSizing: {
    method: "fixed_percent_equity",
    value: 10,
  },

  risk: {
    maxLeverage: 1,
    stopLossPercent: 2,
    takeProfitPercent: 5,
    maxPositionPercent: 10,
    dailyLossLimitPercent: 5,
    maxDrawdownPercent: 15,
    pauseAfterDailyLossLimit: true,
    emergencyStopEnabled: true,
  },

  execution: {
    mode: "testnet",
    orderType: "market",
  },

  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("strategy lifecycle", () => {
  it("allows draft to validated", () => {
    expect(
      canTransitionStrategyStatus("draft", "validated"),
    ).toBe(true);
  });

  it("prevents draft from being published directly", () => {
    expect(
      canTransitionStrategyStatus("draft", "published"),
    ).toBe(false);
  });

  it("allows validated strategy to be published", () => {
    expect(
      canTransitionStrategyStatus("validated", "published"),
    ).toBe(true);
  });

  it("prevents archived strategy from being reactivated", () => {
    expect(
      canTransitionStrategyStatus("archived", "draft"),
    ).toBe(false);
  });

  it("successfully transitions a draft strategy", () => {
    const result = transitionStrategyStatus(
      strategy,
      "validated",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.strategy.status).toBe("validated");
      expect(result.strategy.updatedAt).toBe(
        "2026-01-02T00:00:00.000Z",
      );
    }
  });

  it("rejects invalid lifecycle transitions", () => {
    const result = transitionStrategyStatus(
      strategy,
      "published",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.reason).toBe("INVALID_TRANSITION");
    }
  });

  it("rejects timestamps before strategy creation", () => {
    const result = transitionStrategyStatus(
      strategy,
      "validated",
      "2025-12-31T00:00:00.000Z",
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.reason).toBe("INVALID_TIMESTAMP");
    }
  });
});
