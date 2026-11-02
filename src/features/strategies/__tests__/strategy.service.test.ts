
import { beforeEach, describe, expect, it } from "vitest";

import { StrategyService } from "../application/strategy.service";
import { InMemoryStrategyRepository } from "../repositories/in-memory-strategy.repository";

import type { Strategy } from "../types/strategy.types";

const createStrategy = (
  overrides: Partial<Strategy> = {},
): Strategy => ({
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

  ...overrides,
});

describe("StrategyService", () => {
  let service: StrategyService;

  beforeEach(() => {
    const repository = new InMemoryStrategyRepository();
    service = new StrategyService(repository);
  });

  it("creates a valid strategy", async () => {
    const result = await service.create(createStrategy());

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.id).toBe("strategy-001");
      expect(result.data.status).toBe("draft");
    }
  });

  it("normalizes strategy text before storing", async () => {
    const result = await service.create(
      createStrategy({
        name: "  RSI Reversal  ",
        market: {
          chain: "robinhood-chain",
          network: "testnet",
          symbol: " eth/usd ",
          baseAsset: " eth ",
          quoteAsset: " usd ",
          timeframe: "1h",
        },
      }),
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.name).toBe("RSI Reversal");
      expect(result.data.market.symbol).toBe("ETH/USD");
      expect(result.data.market.baseAsset).toBe("ETH");
      expect(result.data.market.quoteAsset).toBe("USD");
    }
  });

  it("rejects invalid strategy data", async () => {
    const result = await service.create({
      ...createStrategy(),
      name: "",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a duplicate strategy ID", async () => {
    await service.create(createStrategy());

    const result = await service.create(createStrategy());

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("DUPLICATE_ID");
    }
  });

  it("returns a strategy by ID", async () => {
    await service.create(createStrategy());

    const result = await service.getById("strategy-001");

    expect(result?.id).toBe("strategy-001");
  });

  it("returns all strategies", async () => {
    await service.create(createStrategy());

    await service.create(
      createStrategy({
        id: "strategy-002",
        name: "EMA Trend",
      }),
    );

    const result = await service.getAll();

    expect(result).toHaveLength(2);
  });

  it("updates an existing strategy", async () => {
    await service.create(createStrategy());

    const result = await service.update(
      "strategy-001",
      createStrategy({
        name: "Updated RSI Strategy",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.name).toBe("Updated RSI Strategy");
    }
  });

  it("prevents changing strategy ID", async () => {
    await service.create(createStrategy());

    const result = await service.update(
      "strategy-001",
      createStrategy({
        id: "strategy-002",
      }),
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("ID_MISMATCH");
    }
  });

  it("prevents status changes through update", async () => {
    await service.create(createStrategy());

    const result = await service.update(
      "strategy-001",
      createStrategy({
        status: "validated",
      }),
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe(
        "STATUS_CHANGE_NOT_ALLOWED",
      );
    }
  });

  it("transitions strategy status through lifecycle", async () => {
    await service.create(createStrategy());

    const result = await service.transitionStatus(
      "strategy-001",
      "validated",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.status).toBe("validated");
    }
  });

  it("rejects invalid lifecycle transitions", async () => {
    await service.create(createStrategy());

    const result = await service.transitionStatus(
      "strategy-001",
      "published",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
    }
  });

  it("returns not found when updating an unknown strategy", async () => {
    const result = await service.update(
      "unknown",
      createStrategy(),
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("deletes a strategy", async () => {
    await service.create(createStrategy());

    const deleted = await service.delete("strategy-001");
    const result = await service.getById("strategy-001");

    expect(deleted).toBe(true);
    expect(result).toBeNull();
  });
});
