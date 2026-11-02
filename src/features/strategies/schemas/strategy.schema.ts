import { z } from "zod";
import { conditionGroupSchema } from "./condition.schema";
import { riskManagementSchema } from "./risk.schema";

export const strategyIndicatorSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["RSI", "EMA", "SMA", "MACD", "BOLLINGER_BANDS"]),
  parameters: z.record(z.string(), z.number().finite()),
});

export const strategySchema = z.object({
  id: z.string().min(1),

  name: z.string().min(1).max(100),

  description: z.string().max(1000),

  version: z.number().int().positive(),

  status: z.enum(["draft", "validated", "published", "archived"]),

  market: z.object({
    chain: z.literal("robinhood-chain"),
    network: z.enum(["testnet", "mainnet"]),
    symbol: z.string().min(1),
    baseAsset: z.string().min(1),
    quoteAsset: z.string().min(1),
    timeframe: z.enum([
      "1m",
      "5m",
      "15m",
      "30m",
      "1h",
      "4h",
      "1d",
    ]),
  }),

  indicators: z.array(strategyIndicatorSchema),

  entryConditions: conditionGroupSchema,

  exitConditions: conditionGroupSchema,

  positionSizing: z.object({
    method: z.enum(["fixed_quote", "fixed_percent_equity"]),
    value: z.number().positive(),
  }),

  risk: riskManagementSchema,

  execution: z.object({
    mode: z.enum(["practice", "testnet"]),
    orderType: z.enum(["market", "limit"]),
  }),

  createdAt: z.string().datetime(),

  updatedAt: z.string().datetime(),
});

export type StrategySchema = z.infer<typeof strategySchema>;