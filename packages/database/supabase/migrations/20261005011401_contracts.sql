-- Contracts (.ai/specs/2026-10-02-contracts.md): header, amendments, lines, the invoice
-- schedule, the per-line revenue plan, and the movement ledger behind each line's
-- Deferred Revenue / Contract Assets position, plus contract provenance on sales
-- invoices, memos and recognition schedule rows. The salesInvoiceLines view picks up
-- the new line columns in 20261005011501_sales-invoice-discount-and-ship-to.sql.
-- RLS comes from the authz manifest (packages/database/src/authz/manifest.ts).

-- 1) Header -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContract" (
  "id" TEXT NOT NULL DEFAULT id('con'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "customerContractStatus" NOT NULL DEFAULT 'Draft',
  "contractType" "customerContractType" NOT NULL DEFAULT 'New Sales',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "shipToCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "customerReference" TEXT,
  "closeDate" DATE NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "contractRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),
  "billingFrequency" "contractBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "contractBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "contractBillingTiming" NOT NULL DEFAULT 'Advance',
  "firstInvoiceDate" DATE,
  "billedThrough" DATE,
  "recognizeRevenueFrom" DATE,
  "invoiceAutomation" "invoiceAutomation",
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "notes" JSONB,
  "confirmedAt" TIMESTAMP WITH TIME ZONE,
  "confirmedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE,
  "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContract_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContract_customerContractId_companyId_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContract_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContract_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  -- endDate = startDate - 1 is a contract cancelled back to nothing
  CONSTRAINT "customerContract_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContract_companyId_idx" ON "customerContract" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContract_companyId_status_idx" ON "customerContract" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "customerContract_customerId_idx" ON "customerContract" ("customerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerId_idx" ON "customerContract" ("invoiceCustomerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerContactId_idx" ON "customerContract" ("invoiceCustomerContactId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerLocationId_idx" ON "customerContract" ("invoiceCustomerLocationId");
CREATE INDEX IF NOT EXISTS "customerContract_shipToCustomerLocationId_idx" ON "customerContract" ("shipToCustomerLocationId");
CREATE INDEX IF NOT EXISTS "customerContract_salesPersonId_idx" ON "customerContract" ("salesPersonId");
CREATE INDEX IF NOT EXISTS "customerContract_salesOrderId_idx" ON "customerContract" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "customerContract_projectId_idx" ON "customerContract" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContract_paymentTermId_idx" ON "customerContract" ("paymentTermId");
CREATE INDEX IF NOT EXISTS "customerContract_confirmedBy_idx" ON "customerContract" ("confirmedBy");
CREATE INDEX IF NOT EXISTS "customerContract_createdBy_idx" ON "customerContract" ("createdBy");

-- 2) Amendments -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractAmendment" (
  "id" TEXT NOT NULL DEFAULT id('cona'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "amendmentDate" DATE NOT NULL,                -- the effective date, after snapping
  "effect" "contractAmendmentEffect" NOT NULL DEFAULT 'Change Date',
  "contractType" "customerContractType" NOT NULL,
  "reason" TEXT NOT NULL,
  -- What a cancellation changed, so it can be reverted:
  -- { contractEndDate, renewal, lineEndDates: { [lineId]: date | null } }. NULL otherwise.
  "previousState" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractAmendment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractAmendment_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractAmendment_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractAmendment_companyId_idx" ON "customerContractAmendment" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_customerContractId_idx" ON "customerContractAmendment" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_createdBy_idx" ON "customerContractAmendment" ("createdBy");

-- 3) Lines ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractLine" (
  "id" TEXT NOT NULL DEFAULT id('conl'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "revenueType" "contractRevenueType" NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "description" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),
  "rateUnit" "contractRateUnit",
  "discountPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1),
  "discountEndsOn" DATE,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,                               -- NULL = runs to the contract's end
  "goLiveDate" DATE,
  "revenueMethod" "contractRevenueMethod" NOT NULL DEFAULT 'Daily',
  "revenueStartDate" DATE,
  "revenueEndDate" DATE,
  "amendmentId" TEXT,
  "amendsLineId" TEXT,
  "salesOrderLineId" TEXT REFERENCES "salesOrderLine"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContractLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLine_amendment_fkey" FOREIGN KEY ("amendmentId", "companyId")
    REFERENCES "customerContractAmendment"("id", "companyId") ON DELETE SET NULL ("amendmentId"),
  CONSTRAINT "customerContractLine_amendsLine_fkey" FOREIGN KEY ("amendsLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("amendsLineId"),
  CONSTRAINT "customerContractLine_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  CONSTRAINT "customerContractLine_rateUnit_check" CHECK (("revenueType" = 'Recurring') = ("rateUnit" IS NOT NULL)),
  CONSTRAINT "customerContractLine_amends_check" CHECK ("amendsLineId" IS NULL OR "amendmentId" IS NOT NULL),
  CONSTRAINT "customerContractLine_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContractLine_companyId_idx" ON "customerContractLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_customerContractId_idx" ON "customerContractLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_itemId_idx" ON "customerContractLine" ("itemId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendmentId_idx" ON "customerContractLine" ("amendmentId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendsLineId_idx" ON "customerContractLine" ("amendsLineId");
CREATE INDEX IF NOT EXISTS "customerContractLine_projectId_idx" ON "customerContractLine" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContractLine_createdBy_idx" ON "customerContractLine" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "customerContractLine_salesOrderLine_key"
  ON "customerContractLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

-- 4) The invoice schedule: planned invoices and their lines -----------------------------
CREATE TABLE IF NOT EXISTS "customerContractInvoice" (
  "id" TEXT NOT NULL DEFAULT id('coni'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "status" "contractInvoiceStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceId" TEXT,                        -- stamp when drafted (no FK, rental precedent)
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoice_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractInvoice_companyId_idx" ON "customerContractInvoice" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_due_idx" ON "customerContractInvoice" ("companyId", "status", "invoiceDate");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_customerContractId_idx" ON "customerContractInvoice" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_salesInvoiceId_idx" ON "customerContractInvoice" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_createdBy_idx" ON "customerContractInvoice" ("createdBy");

CREATE TABLE IF NOT EXISTS "customerContractInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT id('conil'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "customerContractInvoiceId" TEXT,             -- NULL only for a cancellation credit (memoId set)
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "units" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,                 -- per contract-line unit, net of discount
  "amount" NUMERIC NOT NULL,                    -- negative for an adjustment
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "salesInvoiceLineId" TEXT,                    -- stamp (no FK, rental precedent)
  "voidedSalesInvoiceId" TEXT,                  -- re-bill hold (rental D26)
  "memoId" TEXT,                                -- cancellation credit
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoiceLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoiceLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_invoice_fkey" FOREIGN KEY ("customerContractInvoiceId", "companyId")
    REFERENCES "customerContractInvoice"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_dates_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "customerContractInvoiceLine_parent_check" CHECK ("customerContractInvoiceId" IS NOT NULL OR "memoId" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_companyId_idx" ON "customerContractInvoiceLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_customerContractId_idx" ON "customerContractInvoiceLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_invoiceId_idx" ON "customerContractInvoiceLine" ("customerContractInvoiceId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_lineId_idx" ON "customerContractInvoiceLine" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_salesInvoiceLineId_idx" ON "customerContractInvoiceLine" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_memoId_idx" ON "customerContractInvoiceLine" ("memoId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_createdBy_idx" ON "customerContractInvoiceLine" ("createdBy");

-- 5) Provenance on existing tables ------------------------------------------------------
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "customerContractId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractInvoiceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salesInvoice" ADD CONSTRAINT "salesInvoice_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractInvoiceLine_fkey"
    FOREIGN KEY ("customerContractInvoiceLineId", "companyId") REFERENCES "customerContractInvoiceLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractInvoiceLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_project_fkey"
    FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId")
    ON DELETE SET NULL ("projectId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "memo" ADD CONSTRAINT "memo_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesInvoice_customerContractId_idx" ON "salesInvoice" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractId_idx" ON "salesInvoiceLine" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractLineId_idx" ON "salesInvoiceLine" ("customerContractLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractInvoiceLineId_idx" ON "salesInvoiceLine" ("customerContractInvoiceLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_projectId_idx" ON "salesInvoiceLine" ("projectId");
CREATE INDEX IF NOT EXISTS "memo_customerContractId_idx" ON "memo" ("customerContractId");

-- 6) Readable-id sequence for existing companies (new companies: seed-data.ts) ----------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'customerContract', 'Contract', 'CON', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'customerContract'
);

-- 7) The revenue plan: one row per contract line per calendar month ---------------------
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

-- 8) Contract provenance on recognition schedule rows -----------------------------------
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

-- 9) The movement ledger ----------------------------------------------------------------
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
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
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

-- 10) customerContracts view -----------------------------
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
