-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chainId" INTEGER,
    "txHash" TEXT,
    "logIndex" INTEGER,
    "provider" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "providerCost" BIGINT,
    "appFee" BIGINT,
    "priceBasis" TEXT,
    "note" TEXT
);

-- CreateIndex
CREATE INDEX "CreditEntry_owner_createdAt_idx" ON "CreditEntry"("owner", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditEntry_chainId_txHash_logIndex_key" ON "CreditEntry"("chainId", "txHash", "logIndex");
