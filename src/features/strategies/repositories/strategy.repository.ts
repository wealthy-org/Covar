
import type { Strategy, StrategyId } from "../types/strategy.types";

export interface StrategyRepository {
  create(strategy: Strategy): Promise<Strategy>;

  getById(id: StrategyId): Promise<Strategy | null>;

  getAll(): Promise<Strategy[]>;

  update(
    id: StrategyId,
    strategy: Strategy,
  ): Promise<Strategy | null>;

  delete(id: StrategyId): Promise<boolean>;
}
