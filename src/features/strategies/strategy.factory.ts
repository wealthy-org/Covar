import "server-only";

import { prisma } from "../../lib/prisma";

import { StrategyService } from "./application/strategy.service";
import { PrismaStrategyRepository } from "./repositories/prisma-strategy.repository";

const strategyRepository = new PrismaStrategyRepository(prisma);

export const strategyService = new StrategyService(
  strategyRepository,
);