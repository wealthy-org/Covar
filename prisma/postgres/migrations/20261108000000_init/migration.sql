-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChainId" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "SessionState" (
    "id" TEXT NOT NULL DEFAULT 'local',
    "savedAt" TIMESTAMP(3) NOT NULL,
    "stateJson" TEXT NOT NULL,

    CONSTRAINT "SessionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("sessionId","id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "agentId" TEXT,
    "label" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "state" TEXT NOT NULL,
    "txHash" TEXT,
    "note" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("sessionId","id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("sessionId","id")
);

-- CreateTable
CREATE TABLE "PracticeRun" (
    "agentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "capitalUsd" DOUBLE PRECISION NOT NULL,
    "pnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ticks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "priceMode" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "lastPrice" DOUBLE PRECISION,
    "priceSource" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    CONSTRAINT "PracticeRun_pkey" PRIMARY KEY ("sessionId","agentId")
);

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_address_idx" ON "AuthSession"("address");

-- CreateIndex
CREATE INDEX "Notification_sessionId_ts_idx" ON "Notification"("sessionId", "ts");

-- CreateIndex
CREATE INDEX "LedgerEntry_sessionId_ts_idx" ON "LedgerEntry"("sessionId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_agentId_version_sessionId_key" ON "StrategyVersion"("agentId", "version", "sessionId");

