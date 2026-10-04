-- Contracts, Phase B (.ai/plans/2026-10-04-contracts-wizard-phase-b.md): the per-line
-- revenue plan, the movement ledger behind each line's Deferred Revenue / Contract Assets
-- position, contract provenance on recognition schedule rows, and a ship-to address.
-- RLS comes from the authz manifest (packages/database/src/authz/manifest.ts).

-- 1) Ship-to ----------------------------------------------------------------------------
ALTER TABLE "customerContract"
  ADD COLUMN IF NOT EXISTS "shipToCustomerLocationId" TEXT REFERENCES "customerLocation"("id");
CREATE INDEX IF NOT EXISTS "customerContract_shipToCustomerLocationId_idx"
  ON "customerContract" ("shipToCustomerLocationId");

-- 2) The revenue plan: one row per contract line per calendar month ---------------------
-- Amounts are in the contract currency. An unedited Draft has no rows (planned live);
-- the first revenue edit or Confirm writes them.
CREATE TABLE IF NOT EXISTS "customerContractRevenue" (
  "id" TEXT NOT NULL DEFAULT id('conr'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,                  -- the 1st of the month
  "periodEnd" DATE NOT NULL,                    -- the month's last day
  "amount" NUMERIC NOT NULL,
  "status" "contractRevenueStatus" NOT NULL DEFAULT 'Planned',
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractRevenue_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractRevenue_key" UNIQUE ("companyId", "customerContractLineId", "periodStart"),
  CONSTRAINT "customerContractRevenue_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractRevenue_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRevenue_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRevenue_dates_check" CHECK ("periodEnd" >= "periodStart")
);
CREATE INDEX IF NOT EXISTS "customerContractRevenue_companyId_idx" ON "customerContractRevenue" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractRevenue_customerContractId_idx" ON "customerContractRevenue" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractRevenue_due_idx" ON "customerContractRevenue" ("companyId", "status", "periodStart");
CREATE INDEX IF NOT EXISTS "customerContractRevenue_createdBy_idx" ON "customerContractRevenue" ("createdBy");

-- 3) Contract provenance on recognition schedule rows -----------------------------------
ALTER TABLE "revenueRecognitionSchedule"
  ADD COLUMN IF NOT EXISTS "customerContractLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractRevenueId" TEXT,
  ADD COLUMN IF NOT EXISTS "contractAmount" NUMERIC;     -- the row in contract currency

DO $$ BEGIN
  ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_customerContractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_customerContractRevenue_fkey"
    FOREIGN KEY ("customerContractRevenueId", "companyId") REFERENCES "customerContractRevenue"("id", "companyId")
    ON DELETE SET NULL ("customerContractRevenueId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_contractLine_idx"
  ON "revenueRecognitionSchedule" ("companyId", "customerContractLineId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_customerContractRevenueId_idx"
  ON "revenueRecognitionSchedule" ("customerContractRevenueId");

-- 4) The movement ledger ----------------------------------------------------------------
-- One row per movement of a line's position (invoiced − recognized). Deferred Revenue
-- carries the positive part, Contract Assets the negative part; both pools are kept in
-- contract currency (*Amount) and base (*Base). A line's position is the sum of its rows.
CREATE TABLE IF NOT EXISTS "customerContractLedgerEntry" (
  "id" TEXT NOT NULL DEFAULT id('conle'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "entryType" "contractLedgerEntryType" NOT NULL,
  "postingDate" DATE NOT NULL,
  "salesInvoiceLineId" TEXT,
  "memoId" TEXT,
  "revenueRecognitionScheduleId" TEXT,
  "customerContractRevenueId" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "deferredAmount" NUMERIC NOT NULL DEFAULT 0,
  "deferredBase" NUMERIC NOT NULL DEFAULT 0,
  "assetAmount" NUMERIC NOT NULL DEFAULT 0,
  "assetBase" NUMERIC NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "customerContractLedgerEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLedgerEntry_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLedgerEntry_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  -- A recognition entry lives and dies with its schedule row (a recalculated Draft run).
  CONSTRAINT "customerContractLedgerEntry_schedule_fkey" FOREIGN KEY ("revenueRecognitionScheduleId", "companyId")
    REFERENCES "revenueRecognitionSchedule"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_companyId_idx" ON "customerContractLedgerEntry" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_contractId_idx" ON "customerContractLedgerEntry" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_lineId_idx" ON "customerContractLedgerEntry" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_salesInvoiceLineId_idx" ON "customerContractLedgerEntry" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_memoId_idx" ON "customerContractLedgerEntry" ("memoId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_scheduleId_idx" ON "customerContractLedgerEntry" ("revenueRecognitionScheduleId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_journalId_idx" ON "customerContractLedgerEntry" ("journalId");
CREATE INDEX IF NOT EXISTS "customerContractLedgerEntry_createdBy_idx" ON "customerContractLedgerEntry" ("createdBy");

-- 5) customerContracts view: ship-to and recognized revenue -----------------------------
DROP VIEW IF EXISTS "customerContracts";
CREATE VIEW "customerContracts" WITH(SECURITY_INVOKER=true) AS
SELECT
  c.*,
  cu."name" AS "customerName",
  COALESCE(c."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation",
  (SELECT COUNT(*) FROM "customerContractLine" l
     WHERE l."customerContractId" = c."id" AND l."companyId" = c."companyId") AS "lineCount",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId") AS "contractValue",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     JOIN "customerContractInvoice" ci ON ci."id" = il."customerContractInvoiceId" AND ci."companyId" = il."companyId"
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId" AND ci."status" = 'Invoiced') AS "invoicedToDate",
  (SELECT COALESCE(SUM(r."amount"), 0) FROM "customerContractRevenue" r
     WHERE r."customerContractId" = c."id" AND r."companyId" = c."companyId" AND r."status" = 'Recognized') AS "recognizedToDate",
  (SELECT MIN(ci."invoiceDate") FROM "customerContractInvoice" ci
     WHERE ci."customerContractId" = c."id" AND ci."companyId" = c."companyId" AND ci."status" = 'Planned') AS "nextInvoiceDate"
FROM "customerContract" c
JOIN "customer" cu ON cu."id" = c."customerId"
LEFT JOIN "companySettings" cs ON cs."id" = c."companyId";
