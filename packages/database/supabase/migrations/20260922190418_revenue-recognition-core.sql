-- Revenue recognition core: account defaults, seeded accounts, sequence,
-- close task, service dates on sales lines, schedule + run tables. Idempotent.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §1

-- 1) Account defaults ----------------------------------------------------------
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "deferredRevenueAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "contractAssetAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalIncomeAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseRevenueAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseInterestIncomeAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "netInvestmentInLeasesAccount" TEXT;

DO $rrfk$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'deferredRevenueAccount', 'contractAssetAccount', 'rentalIncomeAccount',
    'leaseRevenueAccount', 'leaseInterestIncomeAccount', 'netInvestmentInLeasesAccount'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = '"accountDefault"'::regclass AND conname = 'accountDefault_' || col || '_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE "accountDefault" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "account"(id) ON DELETE RESTRICT ON UPDATE CASCADE',
        'accountDefault_' || col || '_fkey', col
      );
    END IF;
  END LOOP;
END $rrfk$;

-- 2) Accounts, one per company group, parents resolved by group NAME (never number) -----
-- 2160 Deferred Revenue ships with the seeded chart. A group that renumbered it keeps
-- its account (matched by name below); only a group with neither gets a new one, since
-- posting a dated invoice line refuses without the default mapped.
INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '2160', 'Deferred Revenue', 'Liability', 'Other Current Liability', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Current Liabilities'
  AND NOT EXISTS (
    SELECT 1 FROM "account" a
    WHERE a."companyGroupId" = g."companyGroupId"
      AND (a.number = '2160' OR (a.name = 'Deferred Revenue' AND a."isGroup" = FALSE))
  );

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '1145', 'Contract Assets', 'Asset', 'Other Current Asset', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Receivables'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1145');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '1160', 'Net Investment in Leases', 'Asset', 'Other Current Asset', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Receivables'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1160');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '4060', 'Rental Income', 'Revenue', 'Income', 'Income Statement', 'Average', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Revenue'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '4060');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '4070', 'Lease Revenue', 'Revenue', 'Income', 'Income Statement', 'Average', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Revenue'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '4070');

INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
SELECT id('acct'), '4150', 'Interest Income – Leases', 'Revenue', 'Other Income', 'Income Statement', 'Average', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = 'Other Income'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '4150');

-- Every group that has a chart must now have all five leaves; a missing parent group
-- would have silently produced nothing above (lesson: never insert orphaned accounts).
DO $rrguard$
DECLARE
  n TEXT;
BEGIN
  FOREACH n IN ARRAY ARRAY['1145', '1160', '4060', '4070', '4150'] LOOP
    IF EXISTS (
      SELECT 1 FROM "account" a
      GROUP BY a."companyGroupId"
      HAVING COALESCE(bool_or(a.number = n), false) = false
    ) THEN
      RAISE EXCEPTION 'revenue-recognition-core: a company group is missing account % (parent group not found)', n;
    END IF;
  END LOOP;
END $rrguard$;

-- 3) Backfill the six defaults by id -----------------------------------------------
-- Deferred Revenue by number, then by name for a group that renumbered 2160.
UPDATE "accountDefault" ad SET "deferredRevenueAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '2160'
WHERE ad."companyId" = c.id AND ad."deferredRevenueAccount" IS NULL;

UPDATE "accountDefault" ad SET "deferredRevenueAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
  AND a.name = 'Deferred Revenue' AND a."isGroup" = FALSE
WHERE ad."companyId" = c.id AND ad."deferredRevenueAccount" IS NULL;

UPDATE "accountDefault" ad SET "contractAssetAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '1145'
WHERE ad."companyId" = c.id AND ad."contractAssetAccount" IS NULL;

UPDATE "accountDefault" ad SET "rentalIncomeAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '4060'
WHERE ad."companyId" = c.id AND ad."rentalIncomeAccount" IS NULL;

UPDATE "accountDefault" ad SET "leaseRevenueAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '4070'
WHERE ad."companyId" = c.id AND ad."leaseRevenueAccount" IS NULL;

UPDATE "accountDefault" ad SET "leaseInterestIncomeAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '4150'
WHERE ad."companyId" = c.id AND ad."leaseInterestIncomeAccount" IS NULL;

UPDATE "accountDefault" ad SET "netInvestmentInLeasesAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '1160'
WHERE ad."companyId" = c.id AND ad."netInvestmentInLeasesAccount" IS NULL;

-- Revenue recognition follows accountingEnabled, so every company must leave with a
-- usable Deferred Revenue default: an unmapped or non-Liability-leaf account would make
-- every dated invoice line refuse to post.
DO $rrdeferred$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accountDefault" ad
    LEFT JOIN "account" a ON a.id = ad."deferredRevenueAccount"
    WHERE a.id IS NULL OR a.class <> 'Liability' OR a."isGroup"
  ) THEN
    RAISE EXCEPTION 'revenue-recognition-core: a company has no Deferred Revenue default, or it is not a Liability leaf account';
  END IF;
END $rrdeferred$;

-- 4) Sequence per company ---------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'revenueRecognitionRun', 'Revenue Recognition Run', 'RR', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'revenueRecognitionRun');

-- 5) Close-checklist task (its evaluator ships in the same change set) --------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Recognize revenue for the period', 'Auto', 'unposted-revenue-schedules', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Recognize revenue for the period'
  );

-- 6) Service dates on sales order + sales invoice lines -----------------------------
ALTER TABLE "salesOrderLine" ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE;
ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE;

DO $svcdates$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"salesOrderLine"'::regclass AND conname = 'salesOrderLine_serviceDates_check') THEN
    ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_serviceDates_check"
      CHECK (("serviceStartDate" IS NULL) = ("serviceEndDate" IS NULL) AND ("serviceEndDate" IS NULL OR "serviceEndDate" >= "serviceStartDate"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"salesInvoiceLine"'::regclass AND conname = 'salesInvoiceLine_serviceDates_check') THEN
    ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_serviceDates_check"
      CHECK (("serviceStartDate" IS NULL) = ("serviceEndDate" IS NULL) AND ("serviceEndDate" IS NULL OR "serviceEndDate" >= "serviceStartDate"));
  END IF;
END $svcdates$;

-- 7) The two "t.*" views gain columns in the middle: DROP + CREATE (never CREATE OR REPLACE).
--    Bodies copied verbatim from their newest definitions
--    (salesInvoiceLines: 20260524143827_fixed-assets.sql; salesOrderLines: 20260811123619_widen-sales-production-scale.sql).
DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId"
     FROM "customerPartToItem" cp
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id
     LIMIT 1) as "customerPartId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

DROP VIEW IF EXISTS "salesOrderLines";
CREATE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

-- 8) Schedule + run tables ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "revenueRecognitionSchedule" (
  "id" TEXT NOT NULL DEFAULT id('rvsc'),
  "companyId" TEXT NOT NULL,
  "type" "revenueScheduleType" NOT NULL,
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceLineId" TEXT,
  "rentalAgreementLineId" TEXT,
  "rentalLeaseScheduleLineId" TEXT,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "accountingPeriodId" TEXT REFERENCES "accountingPeriod"("id"),
  "amount" NUMERIC NOT NULL,
  "debitAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "creditAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "runLineId" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "billedBySalesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_companyId_idx" ON "revenueRecognitionSchedule" ("companyId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_due_idx" ON "revenueRecognitionSchedule" ("companyId", "status", "scheduledDate");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_invoiceLine_idx" ON "revenueRecognitionSchedule" ("companyId", "salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_rentalLine_idx" ON "revenueRecognitionSchedule" ("companyId", "rentalAgreementLineId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_accountingPeriodId_idx" ON "revenueRecognitionSchedule" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_debitAccountId_idx" ON "revenueRecognitionSchedule" ("debitAccountId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_creditAccountId_idx" ON "revenueRecognitionSchedule" ("creditAccountId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_journalId_idx" ON "revenueRecognitionSchedule" ("journalId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_createdBy_idx" ON "revenueRecognitionSchedule" ("createdBy");

ALTER TABLE "public"."revenueRecognitionSchedule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."revenueRecognitionSchedule";
CREATE POLICY "SELECT" ON "public"."revenueRecognitionSchedule" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."revenueRecognitionSchedule";
CREATE POLICY "INSERT" ON "public"."revenueRecognitionSchedule" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."revenueRecognitionSchedule";
CREATE POLICY "UPDATE" ON "public"."revenueRecognitionSchedule" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."revenueRecognitionSchedule";
CREATE POLICY "DELETE" ON "public"."revenueRecognitionSchedule" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

CREATE TABLE IF NOT EXISTS "revenueRecognitionRun" (
  "id" TEXT NOT NULL DEFAULT id('rvrn'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRun_runId_companyId_key" UNIQUE ("runId", "companyId"),
  CONSTRAINT "revenueRecognitionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "revenueRecognitionRun_companyId_idx" ON "revenueRecognitionRun" ("companyId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionRun_journalId_idx" ON "revenueRecognitionRun" ("journalId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionRun_postedBy_idx" ON "revenueRecognitionRun" ("postedBy");
CREATE INDEX IF NOT EXISTS "revenueRecognitionRun_createdBy_idx" ON "revenueRecognitionRun" ("createdBy");

ALTER TABLE "public"."revenueRecognitionRun" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."revenueRecognitionRun";
CREATE POLICY "SELECT" ON "public"."revenueRecognitionRun" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."revenueRecognitionRun";
CREATE POLICY "INSERT" ON "public"."revenueRecognitionRun" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."revenueRecognitionRun";
CREATE POLICY "UPDATE" ON "public"."revenueRecognitionRun" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."revenueRecognitionRun";
CREATE POLICY "DELETE" ON "public"."revenueRecognitionRun" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

CREATE TABLE IF NOT EXISTS "revenueRecognitionRunLine" (
  "id" TEXT NOT NULL DEFAULT id('rvrl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionRunLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRunLine_run_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "revenueRecognitionRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "revenueRecognitionRunLine_schedule_fkey" FOREIGN KEY ("scheduleId", "companyId") REFERENCES "revenueRecognitionSchedule"("id", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "revenueRecognitionRunLine_schedule_key" UNIQUE ("companyId", "scheduleId"),
  CONSTRAINT "revenueRecognitionRunLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "revenueRecognitionRunLine_companyId_idx" ON "revenueRecognitionRunLine" ("companyId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionRunLine_runId_idx" ON "revenueRecognitionRunLine" ("runId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionRunLine_createdBy_idx" ON "revenueRecognitionRunLine" ("createdBy");

ALTER TABLE "public"."revenueRecognitionRunLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."revenueRecognitionRunLine";
CREATE POLICY "SELECT" ON "public"."revenueRecognitionRunLine" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."revenueRecognitionRunLine";
CREATE POLICY "INSERT" ON "public"."revenueRecognitionRunLine" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."revenueRecognitionRunLine";
CREATE POLICY "UPDATE" ON "public"."revenueRecognitionRunLine" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."revenueRecognitionRunLine";
CREATE POLICY "DELETE" ON "public"."revenueRecognitionRunLine" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

NOTIFY pgrst, 'reload schema';
