
import { z } from "zod";

import { conditionGroupSchema } from "./condition.schema";
import { riskManagementSchema } from "./risk.schema";

export const strategyIndicatorSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "RSI",
    "EMA",
    "SMA",
    "MACD",
    "BOLLINGER_BANDS",
  ]),
  parameters: z.record(z.string(), z.number().finite()),
});

const strategyBaseSchema = z.object({
  id: z.string().min(1),

  name: z.string().min(1).max(100),

  description: z.string().max(1000),

  version: z.number().int().positive(),

  status: z.enum([
    "draft",
    "validated",
    "published",
    "archived",
  ]),

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
    method: z.enum([
      "fixed_quote",
      "fixed_percent_equity",
    ]),
    value: z.number().positive().finite(),
  }),

  risk: riskManagementSchema,

  execution: z.object({
    mode: z.enum(["practice", "testnet"]),
    orderType: z.enum(["market", "limit"]),
  }),

  createdAt: z.string().datetime(),

  updatedAt: z.string().datetime(),
});

export const strategySchema = strategyBaseSchema.superRefine(
  (strategy, ctx) => {
    // Validate duplicate indicator IDs.
    const indicatorIds = strategy.indicators.map(
      (indicator) => indicator.id,
    );

    if (new Set(indicatorIds).size !== indicatorIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["indicators"],
        message: "Indicator IDs must be unique.",
      });
    }

    // Validate indicator references in conditions.
    const registeredIndicators = new Set(indicatorIds);

    const groups = [
      {
        name: "entryConditions",
        group: strategy.entryConditions,
      },
      {
        name: "exitConditions",
        group: strategy.exitConditions,
      },
    ] as const;

    for (const { name, group } of groups) {
      const conditionIds = group.conditions.map(
        (condition) => condition.id,
      );

      if (new Set(conditionIds).size !== conditionIds.length) {
        ctx.addIssue({
          code: "custom",
          path: [name, "conditions"],
          message: "Condition IDs must be unique within a group.",
        });
      }

      group.conditions.forEach((condition, index) => {
        for (const [side, operand] of [
          ["left", condition.left],
          ["right", condition.right],
        ] as const) {
          if (
            operand.type === "indicator" &&
            !registeredIndicators.has(operand.indicatorId)
          ) {
            ctx.addIssue({
              code: "custom",
              path: [
                name,
                "conditions",
                index,
                side,
                "indicatorId",
              ],
              message: `Indicator "${operand.indicatorId}" is not registered.`,
            });
          }
        }
      });
    }

    // Validate timestamps.
    const createdAt = Date.parse(strategy.createdAt);
    const updatedAt = Date.parse(strategy.updatedAt);

    if (updatedAt < createdAt) {
      ctx.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot be earlier than createdAt.",
      });
    }
  },
);

export type StrategySchema = z.infer<typeof strategySchema>;
