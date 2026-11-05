-- CreateTable
CREATE TABLE "SessionState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "savedAt" DATETIME NOT NULL,
    "stateJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL DEFAULT 'local'
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "agentId" TEXT,
    "label" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "state" TEXT NOT NULL,
    "txHash" TEXT,
    "note" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local'
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL DEFAULT 'local'
);

-- CreateTable
CREATE TABLE "PracticeRun" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "capitalUsd" REAL NOT NULL,
    "pnlUsd" REAL NOT NULL DEFAULT 0,
    "ticks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "priceMode" TEXT NOT NULL,
    "entryPrice" REAL,
    "lastPrice" REAL,
    "priceSource" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local'
);

-- CreateIndex
CREATE INDEX "Notification_sessionId_ts_idx" ON "Notification"("sessionId", "ts");

-- CreateIndex
CREATE INDEX "LedgerEntry_sessionId_ts_idx" ON "LedgerEntry"("sessionId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_agentId_version_sessionId_key" ON "StrategyVersion"("agentId", "version", "sessionId");

-- CreateIndex
CREATE INDEX "PracticeRun_sessionId_idx" ON "PracticeRun"("sessionId");
