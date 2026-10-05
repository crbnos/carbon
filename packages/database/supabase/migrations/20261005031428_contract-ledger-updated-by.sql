-- Every table with createdBy carries updatedBy / updatedAt: the shared audit-injection
-- path (API dispatch, MCP, service writes) stamps updatedBy on every write.
ALTER TABLE "customerContractLedgerEntry"
  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE;
