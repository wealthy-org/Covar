
import type { StrategySchema } from "../schemas/strategy.schema";

export function normalizeStrategy(
  strategy: StrategySchema,
): StrategySchema {
  return {
    ...strategy,
    name: strategy.name.trim(),
    description: strategy.description.trim(),
    market: {
      ...strategy.market,
      symbol: strategy.market.symbol.trim().toUpperCase(),
      baseAsset: strategy.market.baseAsset.trim().toUpperCase(),
      quoteAsset: strategy.market.quoteAsset.trim().toUpperCase(),
    },
    indicators: strategy.indicators.map((indicator) => ({
      ...indicator,
      id: indicator.id.trim(),
    })),
  };
}
