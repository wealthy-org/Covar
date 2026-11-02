
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../../lib/prisma";
import type { Strategy } from "../types/strategy.types";
import { PrismaStrategyRepository } from "../repositories/prisma-strategy.repository";

const repository = new PrismaStrategyRepository(prisma);

function createTestStrategy(): Strategy {
  const now = Date.now();

  return {
    id: randomUUID(),
    name: "Neon Integration Test",
    description: "Temporary strategy for PostgreSQL integration testing.",
    version: 1,
    status: "draft",
    market: {
      chain: "robinhood-chain",
      network: "testnet",
      symbol: "ETH-USD",
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
      operator: "AND",
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
      method: "fixed_quote",
      value: 100,
    },
    risk: {
      maxLeverage: 2,
      stopLossPercent: 2,
      takeProfitPercent: 4,
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
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now + 1000).toISOString(),
  };
}

describe("PrismaStrategyRepository integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("performs create, read, update, and delete against PostgreSQL", async () => {
    const strategy = createTestStrategy();

    try {
      // CREATE
      const created = await repository.create(strategy);

      expect(created.id).toBe(strategy.id);
      expect(created.name).toBe(strategy.name);
      expect(created.market.symbol).toBe("ETH-USD");

      // READ BY ID
      const found = await repository.getById(strategy.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(strategy.id);
      expect(found?.indicators).toHaveLength(1);

      // READ ALL
      const allStrategies = await repository.getAll();

      expect(
        allStrategies.some((item) => item.id === strategy.id),
      ).toBe(true);

      // UPDATE
      const updatedInput: Strategy = {
        ...created,
        name: "Neon Integration Test Updated",
        updatedAt: new Date(
          Date.parse(created.updatedAt) + 2000,
        ).toISOString(),
      };

      const updated = await repository.update(
        strategy.id,
        updatedInput,
      );

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe("Neon Integration Test Updated");

      // DELETE
      const deleted = await repository.delete(strategy.id);

      expect(deleted).toBe(true);

      const deletedStrategy = await repository.getById(strategy.id);

      expect(deletedStrategy).toBeNull();

      // DELETE NON-EXISTENT RECORD
      const deletedAgain = await repository.delete(strategy.id);

      expect(deletedAgain).toBe(false);
    } finally {
      // Cleanup if an assertion or operation fails.
      await repository.delete(strategy.id);
    }
  });
});
