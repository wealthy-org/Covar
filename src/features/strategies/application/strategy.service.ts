
import type {
  Strategy,
  StrategyId,
  StrategyStatus,
} from "../types/strategy.types";

import {
  validateStrategy,
} from "../validators/validate-strategy";

import {
  normalizeStrategy,
} from "../utils/normalize-strategy";

import {
  transitionStrategyStatus,
} from "../utils/strategy-lifecycle";

import type {
  StrategyRepository,
} from "../repositories/strategy.repository";

export type StrategyServiceError =
  | {
      code: "VALIDATION_ERROR";
      message: string;
      details: {
        path: string;
        message: string;
      }[];
    }
  | {
      code: "NOT_FOUND";
      message: string;
    }
  | {
      code: "DUPLICATE_ID";
      message: string;
    }
  | {
      code: "ID_MISMATCH";
      message: string;
    }
  | {
      code: "STATUS_CHANGE_NOT_ALLOWED";
      message: string;
    }
  | {
      code: "INVALID_TRANSITION";
      message: string;
    }
  | {
      code: "INVALID_TIMESTAMP";
      message: string;
    };

export type StrategyServiceResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: StrategyServiceError;
    };

export class StrategyService {
  constructor(
    private readonly repository: StrategyRepository,
  ) {}

  async create(
    input: unknown,
  ): Promise<StrategyServiceResult<Strategy>> {
    const validation = validateStrategy(input);

    if (!validation.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Strategy validation failed.",
          details: validation.errors,
        },
      };
    }

    const normalized = normalizeStrategy(validation.data);
    const normalizedValidation = validateStrategy(normalized);

    if (!normalizedValidation.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Strategy is invalid after normalization.",
          details: normalizedValidation.errors,
        },
      };
    }

    try {
      const created = await this.repository.create(
        normalizedValidation.data,
      );

      return {
        success: true,
        data: created,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("already exists")
      ) {
        return {
          success: false,
          error: {
            code: "DUPLICATE_ID",
            message: "A strategy with this ID already exists.",
          },
        };
      }

      throw error;
    }
  }

  async getById(
    id: StrategyId,
  ): Promise<Strategy | null> {
    return this.repository.getById(id);
  }

  async getAll(): Promise<Strategy[]> {
    return this.repository.getAll();
  }

  async update(
    id: StrategyId,
    input: unknown,
  ): Promise<StrategyServiceResult<Strategy>> {
    const existing = await this.repository.getById(id);

    if (!existing) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Strategy not found.",
        },
      };
    }

    const validation = validateStrategy(input);

    if (!validation.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Strategy validation failed.",
          details: validation.errors,
        },
      };
    }

    if (validation.data.id !== id) {
      return {
        success: false,
        error: {
          code: "ID_MISMATCH",
          message: "Strategy ID cannot be changed.",
        },
      };
    }

    if (validation.data.status !== existing.status) {
      return {
        success: false,
        error: {
          code: "STATUS_CHANGE_NOT_ALLOWED",
          message: "Use transitionStatus to change strategy status.",
        },
      };
    }

    const normalized = normalizeStrategy(validation.data);
    const normalizedValidation = validateStrategy(normalized);

    if (!normalizedValidation.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Strategy is invalid after normalization.",
          details: normalizedValidation.errors,
        },
      };
    }

    const updated = await this.repository.update(
      id,
      normalizedValidation.data,
    );

    if (!updated) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Strategy no longer exists.",
        },
      };
    }

    return {
      success: true,
      data: updated,
    };
  }

  async transitionStatus(
    id: StrategyId,
    nextStatus: StrategyStatus,
    updatedAt: string,
  ): Promise<StrategyServiceResult<Strategy>> {
    const existing = await this.repository.getById(id);

    if (!existing) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Strategy not found.",
        },
      };
    }

    const transition = transitionStrategyStatus(
      existing,
      nextStatus,
      updatedAt,
    );

    if (!transition.success) {
      return {
        success: false,
        error: {
          code: transition.reason,
          message: transition.message,
        },
      };
    }

    const updated = await this.repository.update(
      id,
      transition.strategy,
    );

    if (!updated) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Strategy no longer exists.",
        },
      };
    }

    return {
      success: true,
      data: updated,
    };
  }

  async delete(
    id: StrategyId,
  ): Promise<boolean> {
    return this.repository.delete(id);
  }
}
