import { z } from "zod";

export const conditionOperatorSchema = z.enum([
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "equal",
  "not_equal",
  "crosses_above",
  "crosses_below",
]);

export const conditionOperandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("price"),
    field: z.enum(["open", "high", "low", "close", "volume"]),
  }),
  z.object({
    type: z.literal("indicator"),
    indicatorId: z.string().min(1),
  }),
  z.object({
    type: z.literal("constant"),
    value: z.number().finite(),
  }),
]);

export const strategyConditionSchema = z.object({
  id: z.string().min(1),
  left: conditionOperandSchema,
  operator: conditionOperatorSchema,
  right: conditionOperandSchema,
});

export const conditionGroupSchema = z.object({
  operator: z.enum(["AND", "OR"]),
  conditions: z.array(strategyConditionSchema).min(1),
});

export type StrategyCondition = z.infer<
  typeof strategyConditionSchema
>;

export type ConditionGroup = z.infer<
  typeof conditionGroupSchema
>;