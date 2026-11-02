
import type {
  Strategy,
  StrategyId,
} from "../types/strategy.types";

import type {
  StrategyRepository,
} from "./strategy.repository";

export class InMemoryStrategyRepository
  implements StrategyRepository
{
  private readonly strategies = new Map<StrategyId, Strategy>();

  async create(strategy: Strategy): Promise<Strategy> {
    if (this.strategies.has(strategy.id)) {
      throw new Error(
        `Strategy with ID "${strategy.id}" already exists.`,
      );
    }

    const storedStrategy = structuredClone(strategy);

    this.strategies.set(strategy.id, storedStrategy);

    return structuredClone(storedStrategy);
  }

  async getById(id: StrategyId): Promise<Strategy | null> {
    const strategy = this.strategies.get(id);

    return strategy ? structuredClone(strategy) : null;
  }

  async getAll(): Promise<Strategy[]> {
    return Array.from(this.strategies.values()).map(
      (strategy) => structuredClone(strategy),
    );
  }

  async update(
    id: StrategyId,
    strategy: Strategy,
  ): Promise<Strategy | null> {
    if (!this.strategies.has(id)) {
      return null;
    }

    if (strategy.id !== id) {
      throw new Error(
        "Strategy ID cannot be changed during update.",
      );
    }

    const updatedStrategy = structuredClone(strategy);

    this.strategies.set(id, updatedStrategy);

    return structuredClone(updatedStrategy);
  }

  async delete(id: StrategyId): Promise<boolean> {
    return this.strategies.delete(id);
  }
}
