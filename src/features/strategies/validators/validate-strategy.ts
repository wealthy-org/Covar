
import { strategySchema } from "../schemas/strategy.schema";
import type { StrategySchema } from "../schemas/strategy.schema";

export type StrategyValidationResult =
  | {
      success: true;
      data: StrategySchema;
      errors: [];
    }
  | {
      success: false;
      data: null;
      errors: {
        path: string;
        message: string;
      }[];
    };

export function validateStrategy(
  input: unknown,
): StrategyValidationResult {
  const result = strategySchema.safeParse(input);

  if (!result.success) {
    return {
      success: false,
      data: null,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return {
    success: true,
    data: result.data,
    errors: [],
  };
}
