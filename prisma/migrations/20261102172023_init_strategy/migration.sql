-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('draft', 'validated', 'published', 'archived');

-- CreateEnum
CREATE TYPE "StrategyNetwork" AS ENUM ('testnet', 'mainnet');

-- CreateEnum
CREATE TYPE "StrategyTimeframe" AS ENUM ('1m', '5m', '15m', '30m', '1h', '4h', '1d');

-- CreateEnum
CREATE TYPE "StrategyExecutionMode" AS ENUM ('practice', 'testnet');

-- CreateEnum
CREATE TYPE "StrategyOrderType" AS ENUM ('market', 'limit');

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StrategyStatus" NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'robinhood-chain',
    "network" "StrategyNetwork" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "baseAsset" VARCHAR(32) NOT NULL,
    "quoteAsset" VARCHAR(32) NOT NULL,
    "timeframe" VARCHAR(3) NOT NULL,
    "indicators" JSONB NOT NULL,
    "entryConditions" JSONB NOT NULL,
    "exitConditions" JSONB NOT NULL,
    "positionSizing" JSONB NOT NULL,
    "risk" JSONB NOT NULL,
    "executionMode" "StrategyExecutionMode" NOT NULL,
    "orderType" "StrategyOrderType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategies_status_updatedAt_idx" ON "strategies"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "strategies_network_symbol_idx" ON "strategies"("network", "symbol");
