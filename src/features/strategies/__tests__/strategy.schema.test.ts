
import { describe, expect, it } from "vitest";

import { strategySchema } from "../schemas/strategy.schema";
import { validateStrategy } from "../validators/validate-strategy";

const validStrategy = {
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
      parameters: {
        period: 14,
      },
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

describe("strategySchema", () => {
  it("accepts a valid strategy", () => {
    expect(strategySchema.safeParse(validStrategy).success).toBe(true);
  });

  it("rejects an empty strategy name", () => {
    const result = strategySchema.safeParse({
      ...validStrategy,
      name: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown indicator reference", () => {
    const result = strategySchema.safeParse({
      ...validStrategy,
      entryConditions: {
        operator: "AND",
        conditions: [
          {
            id: "entry-1",
            left: {
              type: "indicator",
              indicatorId: "unknown-rsi",
            },
            operator: "less_than",
            right: {
              type: "constant",
              value: 30,
            },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate indicator IDs", () => {
    const result = strategySchema.safeParse({
      ...validStrategy,
      indicators: [
        ...validStrategy.indicators,
        ...validStrategy.indicators,
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects updatedAt earlier than createdAt", () => {
    const result = strategySchema.safeParse({
      ...validStrategy,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("validateStrategy", () => {
  it("returns validated data for valid input", () => {
    const result = validateStrategy(validStrategy);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.id).toBe("strategy-001");
      expect(result.errors).toEqual([]);
    }
  });

  it("returns readable errors for invalid input", () => {
    const result = validateStrategy({
      ...validStrategy,
      name: "",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toBe("name");
    }
  });
});
