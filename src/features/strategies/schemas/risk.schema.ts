
import { z } from "zod";

export const riskManagementSchema = z.object({
  // Actual leverage ceiling is enforced by the risk policy,
  // not hard-coded into the strategy schema.
  maxLeverage: z.number().positive().finite(),

  stopLossPercent: z.number().positive().max(100).nullable(),

  takeProfitPercent: z.number().positive().max(1000).nullable(),

  maxPositionPercent: z.number().positive().max(100),

  dailyLossLimitPercent: z.number().positive().max(100),

  maxDrawdownPercent: z.number().positive().max(100),

  pauseAfterDailyLossLimit: z.boolean(),

  emergencyStopEnabled: z.boolean(),
});

export type RiskManagement = z.infer<
  typeof riskManagementSchema
>;
