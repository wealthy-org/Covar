/*
  Warnings:

  - The primary key for the `LedgerEntry` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Notification` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `PracticeRun` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `StrategyVersion` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateTable
CREATE TABLE "User" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChainId" INTEGER
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LedgerEntry" (
    "id" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "agentId" TEXT,
    "label" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "state" TEXT NOT NULL,
    "txHash" TEXT,
    "note" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    PRIMARY KEY ("sessionId", "id")
);
INSERT INTO "new_LedgerEntry" ("agentId", "amountUsd", "id", "kind", "label", "note", "sessionId", "state", "ts", "txHash") SELECT "agentId", "amountUsd", "id", "kind", "label", "note", "sessionId", "state", "ts", "txHash" FROM "LedgerEntry";
DROP TABLE "LedgerEntry";
ALTER TABLE "new_LedgerEntry" RENAME TO "LedgerEntry";
CREATE INDEX "LedgerEntry_sessionId_ts_idx" ON "LedgerEntry"("sessionId", "ts");
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    PRIMARY KEY ("sessionId", "id")
);
INSERT INTO "new_Notification" ("body", "href", "id", "kind", "read", "sessionId", "title", "ts") SELECT "body", "href", "id", "kind", "read", "sessionId", "title", "ts" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_sessionId_ts_idx" ON "Notification"("sessionId", "ts");
CREATE TABLE "new_PracticeRun" (
    "agentId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "capitalUsd" REAL NOT NULL,
    "pnlUsd" REAL NOT NULL DEFAULT 0,
    "ticks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "priceMode" TEXT NOT NULL,
    "entryPrice" REAL,
    "lastPrice" REAL,
    "priceSource" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    PRIMARY KEY ("sessionId", "agentId")
);
INSERT INTO "new_PracticeRun" ("agentId", "capitalUsd", "entryPrice", "lastPrice", "pnlUsd", "priceMode", "priceSource", "sessionId", "startedAt", "status", "ticks") SELECT "agentId", "capitalUsd", "entryPrice", "lastPrice", "pnlUsd", "priceMode", "priceSource", "sessionId", "startedAt", "status", "ticks" FROM "PracticeRun";
DROP TABLE "PracticeRun";
ALTER TABLE "new_PracticeRun" RENAME TO "PracticeRun";
CREATE TABLE "new_StrategyVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL DEFAULT 'local',

    PRIMARY KEY ("sessionId", "id")
);
INSERT INTO "new_StrategyVersion" ("agentId", "createdAt", "id", "name", "publishedAt", "rulesJson", "sessionId", "version") SELECT "agentId", "createdAt", "id", "name", "publishedAt", "rulesJson", "sessionId", "version" FROM "StrategyVersion";
DROP TABLE "StrategyVersion";
ALTER TABLE "new_StrategyVersion" RENAME TO "StrategyVersion";
CREATE UNIQUE INDEX "StrategyVersion_agentId_version_sessionId_key" ON "StrategyVersion"("agentId", "version", "sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_address_idx" ON "AuthSession"("address");
