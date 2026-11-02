import { z } from "zod";

export const riskManagementSchema = z.object({
  maxLeverage: z.number().min(1).max(5),

  stopLossPercent: z.number().positive().max(100).nullable(),

  takeProfitPercent: z.number().positive().max(1000).nullable(),

  maxPositionPercent: z.number().positive().max(100),

  dailyLossLimitPercent: z.number().positive().max(100),

  maxDrawdownPercent: z.number().positive().max(100),

  pauseAfterDailyLossLimit: z.boolean(),

  emergencyStopEnabled: z.boolean(),
});