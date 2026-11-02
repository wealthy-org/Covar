
import type { StrategySchema } from "../schemas/strategy.schema";

// Core strategy domain model.
export type Strategy = StrategySchema;

// Strategy identity.
export type StrategyId = Strategy["id"];

// Supported lifecycle states.
export type StrategyStatus = Strategy["status"];

// Supported execution environments.
export type StrategyExecutionMode = Strategy["execution"]["mode"];

// Supported market networks.
export type StrategyNetwork = Strategy["market"]["network"];

// Lifecycle transition result.
export type StrategyTransitionResult =
  | {
      success: true;
      strategy: Strategy;
    }
  | {
      success: false;
      reason: "INVALID_TRANSITION" | "INVALID_TIMESTAMP";
      message: string;
    };
