-- Service jobs (.ai/specs/2026-10-22-service-jobs-and-returns.md, Data Model Changes).
-- A service job is the work on one customer unit: diagnosis, estimate, time, parts and
-- assignments. Its sibling is maintenanceDispatch. The enum values it posts with were added
-- in 20261023070940_service-job-enum-values.sql.
--
-- RLS, event triggers and the document-number interceptor are not here: they come from the
-- authz manifest and attachments.ts (generated migration).

-- 1) Enums.
DO $$ BEGIN
  CREATE TYPE "serviceJobStatus" AS ENUM (
    'Open', 'Awaiting Approval', 'In Progress', 'On Hold',
    'Completed', 'Invoiced', 'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceCoverage" AS ENUM ('Billable', 'Warranty', 'Contract');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceWorkSite" AS ENUM ('Depot', 'Customer Site');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceBillingMethod" AS ENUM ('Time and Materials', 'Fixed Price');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceJobPriority" AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceEstimateStatus" AS ENUM ('Draft', 'Sent', 'Accepted', 'Declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "serviceJobItemLineType" AS ENUM ('Part', 'Charge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "returnType" AS ENUM (
    'Return to Stock', 'Return for Service', 'Return for Warranty'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) The job.
CREATE TABLE IF NOT EXISTS "serviceJob" (
  "id" TEXT NOT NULL DEFAULT id('sj'),
  "companyId" TEXT NOT NULL,
  "serviceJobId" TEXT NOT NULL,
  "status" "serviceJobStatus" NOT NULL DEFAULT 'Open',
  "coverage" "serviceCoverage" NOT NULL DEFAULT 'Billable',
  "workSite" "serviceWorkSite" NOT NULL DEFAULT 'Depot',
  "billingMethod" "serviceBillingMethod" NOT NULL DEFAULT 'Time and Materials',
  "priority" "serviceJobPriority" NOT NULL DEFAULT 'Medium',
  "customerId" TEXT NOT NULL,
  "customerLocationId" TEXT,
  "customerContactId" TEXT,
  "customerAssetId" TEXT,
  "itemId" TEXT,
  "trackedEntityId" TEXT,
  "locationId" TEXT NOT NULL,
  "salesReturnOrderLineId" TEXT,
  "serviceItemId" TEXT,
  "assignee" TEXT,
  "dueDate" DATE,
  "problem" TEXT,
  "findings" JSONB,
  "resolution" JSONB,
  "repairable" BOOLEAN,
  "estimateStatus" "serviceEstimateStatus",
  "estimateSentAt" TIMESTAMP WITH TIME ZONE,
  "estimateRespondedAt" TIMESTAMP WITH TIME ZONE,
  "estimateRespondedBy" TEXT,
  "fixedPrice" NUMERIC,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "completionJournalId" TEXT,
  "salesInvoiceId" TEXT,
  "signaturePath" TEXT,
  "signedByName" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "serviceJob_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceJob_serviceJobId_key" UNIQUE ("serviceJobId", "companyId"),
  CONSTRAINT "serviceJob_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJob_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT,
  CONSTRAINT "serviceJob_customerLocationId_fkey"
    FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_customerContactId_fkey"
    FOREIGN KEY ("customerContactId") REFERENCES "customerContact"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_customerAssetId_fkey"
    FOREIGN KEY ("customerAssetId", "companyId")
    REFERENCES "customerAsset"("id", "companyId") ON DELETE SET NULL ("customerAssetId"),
  CONSTRAINT "serviceJob_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_trackedEntityId_fkey"
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "serviceJob_salesReturnOrderLineId_fkey"
    FOREIGN KEY ("salesReturnOrderLineId", "companyId")
    REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE SET NULL ("salesReturnOrderLineId"),
  CONSTRAINT "serviceJob_serviceItemId_fkey"
    FOREIGN KEY ("serviceItemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_assignee_fkey"
    FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_completionJournalId_fkey"
    FOREIGN KEY ("completionJournalId") REFERENCES "journal"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJob_salesInvoiceId_fkey"
    FOREIGN KEY ("salesInvoiceId") REFERENCES "salesInvoice"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "serviceJob_companyId_idx" ON "serviceJob" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceJob_status_idx" ON "serviceJob" ("status", "companyId");
CREATE INDEX IF NOT EXISTS "serviceJob_customerId_idx" ON "serviceJob" ("customerId");
CREATE INDEX IF NOT EXISTS "serviceJob_customerLocationId_idx" ON "serviceJob" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "serviceJob_customerContactId_idx" ON "serviceJob" ("customerContactId");
CREATE INDEX IF NOT EXISTS "serviceJob_customerAssetId_idx" ON "serviceJob" ("customerAssetId");
CREATE INDEX IF NOT EXISTS "serviceJob_itemId_idx" ON "serviceJob" ("itemId");
CREATE INDEX IF NOT EXISTS "serviceJob_trackedEntityId_idx" ON "serviceJob" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "serviceJob_locationId_idx" ON "serviceJob" ("locationId");
CREATE INDEX IF NOT EXISTS "serviceJob_serviceItemId_idx" ON "serviceJob" ("serviceItemId");
CREATE INDEX IF NOT EXISTS "serviceJob_assignee_idx" ON "serviceJob" ("assignee");
CREATE INDEX IF NOT EXISTS "serviceJob_completionJournalId_idx" ON "serviceJob" ("completionJournalId");
CREATE INDEX IF NOT EXISTS "serviceJob_salesInvoiceId_idx" ON "serviceJob" ("salesInvoiceId");

-- One live job per RMA line (also serves the salesReturnOrderLineId foreign key).
CREATE UNIQUE INDEX IF NOT EXISTS "serviceJob_salesReturnOrderLineId_key"
  ON "serviceJob" ("salesReturnOrderLineId", "companyId")
  WHERE "salesReturnOrderLineId" IS NOT NULL AND "status" <> 'Cancelled';
CREATE INDEX IF NOT EXISTS "serviceJob_salesReturnOrderLineId_idx"
  ON "serviceJob" ("salesReturnOrderLineId");

-- 3) The estimate.
CREATE TABLE IF NOT EXISTS "serviceJobEstimateLine" (
  "id" TEXT NOT NULL DEFAULT id('sjel'),
  "companyId" TEXT NOT NULL,
  "serviceJobId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "serviceJobEstimateLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceJobEstimateLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJobEstimateLine_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId")
    REFERENCES "serviceJob"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceJobEstimateLine_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
);

CREATE INDEX IF NOT EXISTS "serviceJobEstimateLine_companyId_idx" ON "serviceJobEstimateLine" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceJobEstimateLine_serviceJobId_idx" ON "serviceJobEstimateLine" ("serviceJobId");
CREATE INDEX IF NOT EXISTS "serviceJobEstimateLine_itemId_idx" ON "serviceJobEstimateLine" ("itemId");

-- 4) Time. The employee FK copies maintenanceDispatchEvent.
CREATE TABLE IF NOT EXISTS "serviceJobTime" (
  "id" TEXT NOT NULL DEFAULT id('sjt'),
  "companyId" TEXT NOT NULL,
  "serviceJobId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "laborItemId" TEXT NOT NULL,
  "entryDate" DATE NOT NULL,
  "startTime" TIMESTAMP WITH TIME ZONE,
  "endTime" TIMESTAMP WITH TIME ZONE,
  "hours" NUMERIC NOT NULL DEFAULT 0,
  "billable" BOOLEAN NOT NULL DEFAULT TRUE,
  "unitCost" NUMERIC,
  "note" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "serviceJobTime_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceJobTime_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJobTime_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId")
    REFERENCES "serviceJob"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceJobTime_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJobTime_laborItemId_fkey"
    FOREIGN KEY ("laborItemId") REFERENCES "item"("id")
);

CREATE INDEX IF NOT EXISTS "serviceJobTime_companyId_idx" ON "serviceJobTime" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceJobTime_serviceJobId_idx" ON "serviceJobTime" ("serviceJobId");
CREATE INDEX IF NOT EXISTS "serviceJobTime_employeeId_idx" ON "serviceJobTime" ("employeeId", "entryDate");
CREATE INDEX IF NOT EXISTS "serviceJobTime_laborItemId_idx" ON "serviceJobTime" ("laborItemId");

-- One running clock per employee.
CREATE UNIQUE INDEX IF NOT EXISTS "serviceJobTime_open_clock_key"
  ON "serviceJobTime" ("employeeId", "companyId")
  WHERE "startTime" IS NOT NULL AND "endTime" IS NULL;

-- 5) Parts and charges. reimbursementLineId / purchaseInvoiceLineId link a charge to the
-- document that paid its cost (phase 2).
CREATE TABLE IF NOT EXISTS "serviceJobItem" (
  "id" TEXT NOT NULL DEFAULT id('sji'),
  "companyId" TEXT NOT NULL,
  "serviceJobId" TEXT NOT NULL,
  "lineType" "serviceJobItemLineType" NOT NULL,
  "itemId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" NUMERIC NOT NULL,
  "unitOfMeasureCode" TEXT,
  "storageUnitId" TEXT,
  "unitCost" NUMERIC NOT NULL DEFAULT 0,
  "unitPrice" NUMERIC NOT NULL DEFAULT 0,
  "billable" BOOLEAN NOT NULL DEFAULT TRUE,
  "reimbursementLineId" TEXT,
  "purchaseInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "serviceJobItem_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceJobItem_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJobItem_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId")
    REFERENCES "serviceJob"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceJobItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id"),
  CONSTRAINT "serviceJobItem_storageUnitId_fkey"
    FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "serviceJobItem_reimbursementLineId_fkey"
    FOREIGN KEY ("reimbursementLineId", "companyId")
    REFERENCES "reimbursementLine"("id", "companyId") ON DELETE SET NULL ("reimbursementLineId"),
  CONSTRAINT "serviceJobItem_purchaseInvoiceLineId_fkey"
    FOREIGN KEY ("purchaseInvoiceLineId") REFERENCES "purchaseInvoiceLine"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "serviceJobItem_companyId_idx" ON "serviceJobItem" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceJobItem_serviceJobId_idx" ON "serviceJobItem" ("serviceJobId");
CREATE INDEX IF NOT EXISTS "serviceJobItem_itemId_idx" ON "serviceJobItem" ("itemId");
CREATE INDEX IF NOT EXISTS "serviceJobItem_storageUnitId_idx" ON "serviceJobItem" ("storageUnitId");
CREATE INDEX IF NOT EXISTS "serviceJobItem_reimbursementLineId_idx" ON "serviceJobItem" ("reimbursementLineId");
CREATE INDEX IF NOT EXISTS "serviceJobItem_purchaseInvoiceLineId_idx" ON "serviceJobItem" ("purchaseInvoiceLineId");

-- 6) Assignments: a technician on a day. The employee FK copies maintenanceDispatchEvent.
CREATE TABLE IF NOT EXISTS "serviceJobAssignment" (
  "id" TEXT NOT NULL DEFAULT id('sja'),
  "companyId" TEXT NOT NULL,
  "serviceJobId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "plannedHours" NUMERIC,
  "note" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "serviceJobAssignment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceJobAssignment_unique"
    UNIQUE ("serviceJobId", "employeeId", "scheduledDate", "companyId"),
  CONSTRAINT "serviceJobAssignment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "serviceJobAssignment_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId")
    REFERENCES "serviceJob"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceJobAssignment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "serviceJobAssignment_companyId_idx" ON "serviceJobAssignment" ("companyId");
CREATE INDEX IF NOT EXISTS "serviceJobAssignment_employeeId_idx"
  ON "serviceJobAssignment" ("employeeId", "scheduledDate");

-- 7) The RMA line: what the customer sent it back for.
ALTER TABLE "salesReturnOrderLine"
  ADD COLUMN IF NOT EXISTS "returnType" "returnType" NOT NULL DEFAULT 'Return to Stock',
  ADD COLUMN IF NOT EXISTS "customerAssetId" TEXT,
  ADD COLUMN IF NOT EXISTS "problem" TEXT,
  ADD COLUMN IF NOT EXISTS "quantityShipped" NUMERIC NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "salesReturnOrderLine" ADD CONSTRAINT "salesReturnOrderLine_customerAssetId_fkey"
    FOREIGN KEY ("customerAssetId", "companyId")
    REFERENCES "customerAsset"("id", "companyId") ON DELETE SET NULL ("customerAssetId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A Service or Warranty line is one unit.
DO $$ BEGIN
  ALTER TABLE "salesReturnOrderLine" ADD CONSTRAINT "salesReturnOrderLine_service_quantity_check"
    CHECK ("returnType" = 'Return to Stock' OR "quantity" = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_customerAssetId_idx"
  ON "salesReturnOrderLine" ("customerAssetId");

-- 8) A warranty replacement's sales order line points at the RMA line it replaces.
ALTER TABLE "salesOrderLine" ADD COLUMN IF NOT EXISTS "salesReturnOrderLineId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_salesReturnOrderLineId_fkey"
    FOREIGN KEY ("salesReturnOrderLineId", "companyId")
    REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE SET NULL ("salesReturnOrderLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesOrderLine_salesReturnOrderLineId_idx"
  ON "salesOrderLine" ("salesReturnOrderLineId");

-- 9) A service invoice line bills a job: no shipment, no item ledger, no COGS.
ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "serviceJobId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_serviceJobId_fkey"
    FOREIGN KEY ("serviceJobId", "companyId")
    REFERENCES "serviceJob"("id", "companyId") ON DELETE SET NULL ("serviceJobId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesInvoiceLine_serviceJobId_idx"
  ON "salesInvoiceLine" ("serviceJobId");

-- 10) Account default: Cost of Service. Nullable; posting falls back to Cost of Goods Sold.
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "costOfServiceAccount" TEXT;
DO $sjfk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"accountDefault"'::regclass AND conname = 'accountDefault_costOfServiceAccount_fkey'
  ) THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_costOfServiceAccount_fkey"
      FOREIGN KEY ("costOfServiceAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $sjfk$;
CREATE INDEX IF NOT EXISTS "accountDefault_costOfServiceAccount_idx" ON "accountDefault" ("costOfServiceAccount");

-- 11) Readable-id sequence for existing companies (new companies: seed-data.ts).
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'serviceJob', 'Service Job', 'SJ', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'serviceJob'
);
