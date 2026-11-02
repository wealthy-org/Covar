
import type {
  Strategy,
  StrategyStatus,
  StrategyTransitionResult,
} from "../types/strategy.types";

// Define permitted lifecycle transitions.
const ALLOWED_TRANSITIONS: Record<
  StrategyStatus,
  readonly StrategyStatus[]
> = {
  draft: ["validated"],
  validated: ["draft", "published"],
  published: ["archived"],
  archived: [],
};

export function canTransitionStrategyStatus(
  currentStatus: StrategyStatus,
  nextStatus: StrategyStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function transitionStrategyStatus(
  strategy: Strategy,
  nextStatus: StrategyStatus,
  updatedAt: string,
): StrategyTransitionResult {
  if (!Number.isFinite(Date.parse(updatedAt))) {
    return {
      success: false,
      reason: "INVALID_TIMESTAMP",
      message: "The provided update timestamp is invalid.",
    };
  }

  if (Date.parse(updatedAt) < Date.parse(strategy.createdAt)) {
    return {
      success: false,
      reason: "INVALID_TIMESTAMP",
      message: "Update timestamp cannot precede strategy creation.",
    };
  }

  if (
    !canTransitionStrategyStatus(strategy.status, nextStatus)
  ) {
    return {
      success: false,
      reason: "INVALID_TRANSITION",
      message: `Cannot transition strategy from ${strategy.status} to ${nextStatus}.`,
    };
  }

  return {
    success: true,
    strategy: {
      ...strategy,
      status: nextStatus,
      updatedAt,
    },
  };
}
