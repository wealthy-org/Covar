
import { beforeEach, describe, expect, it } from "vitest";

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

describe("InMemoryStrategyRepository", () => {
  let repository: InMemoryStrategyRepository;

  beforeEach(() => {
    repository = new InMemoryStrategyRepository();
  });

  it("creates a strategy", async () => {
    const strategy = createStrategy();

    const result = await repository.create(strategy);

    expect(result).toEqual(strategy);
  });

  it("rejects duplicate strategy IDs", async () => {
    const strategy = createStrategy();

    await repository.create(strategy);

    await expect(
      repository.create(strategy),
    ).rejects.toThrow("already exists");
  });

  it("returns a strategy by ID", async () => {
    const strategy = createStrategy();

    await repository.create(strategy);

    const result = await repository.getById(strategy.id);

    expect(result).toEqual(strategy);
  });

  it("returns null for an unknown ID", async () => {
    const result = await repository.getById("unknown");

    expect(result).toBeNull();
  });

  it("returns all stored strategies", async () => {
    await repository.create(createStrategy());

    await repository.create(
      createStrategy({
        id: "strategy-002",
        name: "EMA Trend",
      }),
    );

    const result = await repository.getAll();

    expect(result).toHaveLength(2);
  });

  it("updates an existing strategy", async () => {
    await repository.create(createStrategy());

    const updated = createStrategy({
      name: "Updated RSI Strategy",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = await repository.update(
      updated.id,
      updated,
    );

    expect(result?.name).toBe("Updated RSI Strategy");
  });

  it("does not update an unknown strategy", async () => {
    const result = await repository.update(
      "unknown",
      createStrategy(),
    );

    expect(result).toBeNull();
  });

  it("prevents changing strategy IDs", async () => {
    await repository.create(createStrategy());

    const updated = createStrategy({
      id: "strategy-002",
    });

    await expect(
      repository.update("strategy-001", updated),
    ).rejects.toThrow("cannot be changed");
  });

  it("deletes an existing strategy", async () => {
    await repository.create(createStrategy());

    const result = await repository.delete("strategy-001");

    expect(result).toBe(true);
    expect(await repository.getById("strategy-001")).toBeNull();
  });

  it("returns false when deleting an unknown strategy", async () => {
    const result = await repository.delete("unknown");

    expect(result).toBe(false);
  });

  it("does not expose internal references", async () => {
    const strategy = createStrategy();

    await repository.create(strategy);

    const retrieved = await repository.getById(strategy.id);

    if (retrieved) {
      retrieved.name = "Modified outside repository";
    }

    const stored = await repository.getById(strategy.id);

    expect(stored?.name).toBe("RSI Reversal");
  });
});
