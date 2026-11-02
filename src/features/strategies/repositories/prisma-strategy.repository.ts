import { Prisma, PrismaClient } from "../../../generated/prisma/client";

import type { Strategy, StrategyId } from "../types/strategy.types";
import type { StrategyRepository } from "./strategy.repository";
import { validateStrategy } from "../validators/validate-strategy";

type PrismaStrategyRecord = Prisma.StrategyGetPayload<object>;

function toDomain(record: NonNullable<PrismaStrategyRecord>): Strategy {
  const candidate = {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    status: record.status,
    market: {
      chain: record.chain,
      network: record.network,
      symbol: record.symbol,
      baseAsset: record.baseAsset,
      quoteAsset: record.quoteAsset,
      timeframe: record.timeframe,
    },
    indicators: record.indicators,
    entryConditions: record.entryConditions,
    exitConditions: record.exitConditions,
    positionSizing: record.positionSizing,
    risk: record.risk,
    execution: {
      mode: record.executionMode,
      orderType: record.orderType,
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };

  const result = validateStrategy(candidate);

  if (!result.success) {
    throw new Error(
      `Persisted strategy "${record.id}" is invalid: ${result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
}

function toPersistence(
  strategy: Strategy,
): Prisma.StrategyUncheckedCreateInput {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    version: strategy.version,
    status: strategy.status,
    chain: strategy.market.chain,
    network: strategy.market.network,
    symbol: strategy.market.symbol,
    baseAsset: strategy.market.baseAsset,
    quoteAsset: strategy.market.quoteAsset,
    timeframe: strategy.market.timeframe,
    indicators: strategy.indicators as Prisma.InputJsonValue,
    entryConditions: strategy.entryConditions as Prisma.InputJsonValue,
    exitConditions: strategy.exitConditions as Prisma.InputJsonValue,
    positionSizing: strategy.positionSizing as Prisma.InputJsonValue,
    risk: strategy.risk as Prisma.InputJsonValue,
    executionMode: strategy.execution.mode,
    orderType: strategy.execution.orderType,
    createdAt: new Date(strategy.createdAt),
    updatedAt: new Date(strategy.updatedAt),
  };
}

export class PrismaStrategyRepository implements StrategyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(strategy: Strategy): Promise<Strategy> {
    try {
      const record = await this.prisma.strategy.create({
        data: toPersistence(strategy),
      });

      return toDomain(record);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error(
          `Strategy with ID "${strategy.id}" already exists.`,
        );
      }

      throw error;
    }
  }

  async getById(id: StrategyId): Promise<Strategy | null> {
    const record = await this.prisma.strategy.findUnique({
      where: { id },
    });

    return record ? toDomain(record) : null;
  }

  async getAll(): Promise<Strategy[]> {
    const records = await this.prisma.strategy.findMany({
      orderBy: {
        updatedAt: "desc",
      },
    });

    return records.map(toDomain);
  }

  async update(
    id: StrategyId,
    strategy: Strategy,
  ): Promise<Strategy | null> {
    if (strategy.id !== id) {
      throw new Error("Strategy ID cannot be changed during update.");
    }

    try {
      const record = await this.prisma.strategy.update({
        where: { id },
        data: toPersistence(strategy),
      });

      return toDomain(record);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return null;
      }

      throw error;
    }
  }

  async delete(id: StrategyId): Promise<boolean> {
    const result = await this.prisma.strategy.deleteMany({
      where: { id },
    });

    return result.count > 0;
  }
}
