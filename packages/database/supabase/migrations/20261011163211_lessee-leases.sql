-- Lessee leases (ASC 842) in purchasing, and the lease run.
-- Spec: .ai/specs/2026-10-11-lessee-leases.md
-- Plan: .ai/plans/2026-10-11-lessee-leases.md (Task 2)

-- 1) Lease policy ---------------------------------------------------------------------
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "leaseIncrementalBorrowingRate" NUMERIC NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "leaseShortTermExpedient" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "leaseReminderDays" INTEGER NOT NULL DEFAULT 90;

-- 2) Account defaults ------------------------------------------------------------------
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "rightOfUseAssetAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "accumulatedRightOfUseAmortizationAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseLiabilityAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "operatingLeaseExpenseAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "variableLeaseExpenseAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "rightOfUseAmortizationExpenseAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseInterestExpenseAccount" TEXT;

DO $leasefk$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'rightOfUseAssetAccount', 'accumulatedRightOfUseAmortizationAccount', 'leaseLiabilityAccount',
    'operatingLeaseExpenseAccount', 'variableLeaseExpenseAccount',
    'rightOfUseAmortizationExpenseAccount', 'leaseInterestExpenseAccount'
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
END $leasefk$;

-- 3) Accounts, one per company group that has a chart ---------------------------------
-- Same rules as 20261006220201: a group that already holds the number OR the name keeps
-- its account; the parent is the seeded group by NAME, else the group of a seeded
-- sibling, else the chart root with a NOTICE.
DO $leaseaccounts$
DECLARE
  spec RECORD;
  grp TEXT;
  parent_id TEXT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('1450', 'Right-of-Use Assets', 'Asset', 'Other Asset', 'Balance Sheet', 'Current', 'Other Assets', ARRAY['1410', '1420']),
      ('1460', 'Accumulated Amortization – Right-of-Use Assets', 'Asset', 'Other Asset', 'Balance Sheet', 'Current', 'Other Assets', ARRAY['1410', '1420']),
      ('2440', 'Lease Liabilities', 'Liability', 'Long Term Liability', 'Balance Sheet', 'Current', 'Long-Term Liabilities', ARRAY['2410', '2420']),
      ('6140', 'Operating Lease Expense', 'Expense', 'Expense', 'Income Statement', 'Average', 'Operating Expenses', ARRAY['6100', '6110']),
      ('6130', 'Variable Lease Expense', 'Expense', 'Expense', 'Income Statement', 'Average', 'Operating Expenses', ARRAY['6100', '6110']),
      ('6330', 'Amortization – Right-of-Use Assets', 'Expense', 'Other Expense', 'Income Statement', 'Average', 'Depreciation & Amortization', ARRAY['6310', '6320']),
      ('7020', 'Interest Expense – Leases', 'Expense', 'Other Expense', 'Income Statement', 'Average', 'Other Expenses', ARRAY['7010'])
    ) AS s(number, name, class, account_type, income_balance, consolidated_rate, parent_name, sibling_numbers)
  LOOP
    FOR grp IN SELECT DISTINCT a."companyGroupId" FROM "account" a LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM "account" a
        WHERE a."companyGroupId" = grp AND (a.number = spec.number OR a.name = spec.name)
      );

      SELECT g.id INTO parent_id
      FROM "account" g
      WHERE g."companyGroupId" = grp AND g."isGroup" = TRUE AND g.name = spec.parent_name
      LIMIT 1;

      IF parent_id IS NULL THEN
        SELECT p.id INTO parent_id
        FROM "account" a
        JOIN "account" p ON p.id = a."parentId" AND p."isGroup" = TRUE
        WHERE a."companyGroupId" = grp AND a.number = ANY (spec.sibling_numbers)
        ORDER BY array_position(spec.sibling_numbers, a.number)
        LIMIT 1;
      END IF;

      IF parent_id IS NULL THEN
        RAISE NOTICE 'lessee-leases: company group % has no "%" group; account % % is at the chart root',
          grp, spec.parent_name, spec.number, spec.name;
      END IF;

      INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
      VALUES (
        id('acct'), spec.number, spec.name, spec.class::"glAccountClass", spec.account_type::"accountType",
        spec.income_balance::"glIncomeBalance", spec.consolidated_rate::"glConsolidatedRate",
        parent_id, false, true, false, grp, 'system'
      );
    END LOOP;
  END LOOP;
END $leaseaccounts$;

-- 4) Backfill the seven defaults by id: by number, then by leaf name -------------------
DO $leasedefaults$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('rightOfUseAssetAccount', '1450', 'Right-of-Use Assets'),
      ('accumulatedRightOfUseAmortizationAccount', '1460', 'Accumulated Amortization – Right-of-Use Assets'),
      ('leaseLiabilityAccount', '2440', 'Lease Liabilities'),
      ('operatingLeaseExpenseAccount', '6140', 'Operating Lease Expense'),
      ('variableLeaseExpenseAccount', '6130', 'Variable Lease Expense'),
      ('rightOfUseAmortizationExpenseAccount', '6330', 'Amortization – Right-of-Use Assets'),
      ('leaseInterestExpenseAccount', '7020', 'Interest Expense – Leases')
    ) AS s(col, number, name)
  LOOP
    EXECUTE format(
      'UPDATE "accountDefault" ad SET %1$I = a.id, "updatedBy" = ''system''
       FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = %2$L
         AND a.name = %3$L AND a."isGroup" = FALSE
       WHERE ad."companyId" = c.id AND ad.%1$I IS NULL',
      spec.col, spec.number, spec.name
    );
    EXECUTE format(
      'UPDATE "accountDefault" ad SET %1$I = a.id, "updatedBy" = ''system''
       FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
         AND a.name = %2$L AND a."isGroup" = FALSE
       WHERE ad."companyId" = c.id AND ad.%1$I IS NULL',
      spec.col, spec.name
    );
  END LOOP;
END $leasedefaults$;

-- 5) Sequences per company ----------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'lease', 'Lease', 'LSE', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'lease');

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'leaseRun', 'Lease Run', 'LR', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'leaseRun');

-- 6) Close-checklist task (its evaluator ships in the same change set) ------------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Post lease journals', 'Auto', 'unposted-lease-schedules', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Post lease journals'
  );

-- 7) Tables ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lease" (
  "id" TEXT NOT NULL DEFAULT id('lse'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "status" "leaseStatus" NOT NULL DEFAULT 'Draft',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "supplierId" TEXT NOT NULL REFERENCES "supplier"("id"),
  "supplierLocationId" TEXT REFERENCES "supplierLocation"("id"),
  "supplierContactId" TEXT REFERENCES "supplierContact"("id"),
  "locationId" TEXT REFERENCES "location"("id"),
  "assignee" TEXT REFERENCES "user"("id"),
  "commencementDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "noticeDate" DATE,
  "invoiceFromDate" DATE NOT NULL,
  "paymentAmount" NUMERIC NOT NULL,
  "paymentFrequency" "leasePaymentFrequency" NOT NULL DEFAULT 'Monthly',
  "paymentTiming" "rentalBillingTiming" NOT NULL DEFAULT 'Advance',
  "annualEscalationPercent" NUMERIC NOT NULL DEFAULT 0,
  "discountRate" NUMERIC NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "fairValue" NUMERIC,
  "economicLifeMonths" INTEGER,
  "ownershipTransfers" BOOLEAN NOT NULL DEFAULT FALSE,
  "specializedAsset" BOOLEAN NOT NULL DEFAULT FALSE,
  "purchaseOptionAmount" NUMERIC,
  "purchaseOptionReasonablyCertain" BOOLEAN NOT NULL DEFAULT FALSE,
  "lesseeClassification" "lesseeClassification",
  "classificationInputs" JSONB,
  "classificationOverride" "lesseeClassification",
  "classificationOverrideReason" TEXT,
  "initialLiability" NUMERIC,
  "initialRouAsset" NUMERIC,
  "rouAssetCost" NUMERIC,
  "commencementJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "fixedAssetId" TEXT,
  "noticeRemindedFor" DATE,
  "endRemindedFor" DATE,
  "activatedAt" TIMESTAMP WITH TIME ZONE,
  "closedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "lease_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "lease_leaseId_companyId_key" UNIQUE ("leaseId", "companyId"),
  CONSTRAINT "lease_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_dates_check" CHECK ("endDate" >= "commencementDate"),
  CONSTRAINT "lease_paymentAmount_check" CHECK ("paymentAmount" >= 0),
  CONSTRAINT "lease_override_reason_check"
    CHECK ("classificationOverride" IS NULL OR "classificationOverrideReason" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "lease_companyId_idx" ON "lease" ("companyId");
CREATE INDEX IF NOT EXISTS "lease_companyId_status_idx" ON "lease" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "lease_supplierId_idx" ON "lease" ("supplierId");
CREATE INDEX IF NOT EXISTS "lease_supplierLocationId_idx" ON "lease" ("supplierLocationId");
CREATE INDEX IF NOT EXISTS "lease_supplierContactId_idx" ON "lease" ("supplierContactId");
CREATE INDEX IF NOT EXISTS "lease_locationId_idx" ON "lease" ("locationId");
CREATE INDEX IF NOT EXISTS "lease_assignee_idx" ON "lease" ("assignee");
CREATE INDEX IF NOT EXISTS "lease_commencementJournalId_idx" ON "lease" ("commencementJournalId");
CREATE INDEX IF NOT EXISTS "lease_createdBy_idx" ON "lease" ("createdBy");

-- Payment rows: cut from the terms, editable while Draft; read by the PV, the schedule
-- and the daily invoice job.
CREATE TABLE IF NOT EXISTS "leasePayment" (
  "id" TEXT NOT NULL DEFAULT id('lpay'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "paymentType" "leasePaymentType" NOT NULL DEFAULT 'Rent',
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "amount" NUMERIC NOT NULL,
  "status" "leasePaymentStatus" NOT NULL DEFAULT 'Pending',
  "purchaseInvoiceLineId" TEXT,
  "voidedPurchaseInvoiceId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leasePayment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leasePayment_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leasePayment_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leasePayment_period_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "leasePayment_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "leasePayment_unique"
  ON "leasePayment" ("companyId", "leaseId", "dueDate", "paymentType");
CREATE INDEX IF NOT EXISTS "leasePayment_companyId_idx" ON "leasePayment" ("companyId");
CREATE INDEX IF NOT EXISTS "leasePayment_lease_idx" ON "leasePayment" ("leaseId", "companyId");
CREATE INDEX IF NOT EXISTS "leasePayment_due_idx" ON "leasePayment" ("companyId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "leasePayment_purchaseInvoiceLineId_idx" ON "leasePayment" ("purchaseInvoiceLineId");
CREATE INDEX IF NOT EXISTS "leasePayment_createdBy_idx" ON "leasePayment" ("createdBy");

-- The effective-interest schedule: one row per lease month.
CREATE TABLE IF NOT EXISTS "leaseScheduleLine" (
  "id" TEXT NOT NULL DEFAULT id('lssl'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "periodDate" DATE NOT NULL,
  "openingLiability" NUMERIC NOT NULL,
  "paymentAmount" NUMERIC NOT NULL,
  "interestAmount" NUMERIC NOT NULL,
  "principalAmount" NUMERIC NOT NULL,
  "closingLiability" NUMERIC NOT NULL,
  "leaseCost" NUMERIC NOT NULL,
  "rouAmortization" NUMERIC NOT NULL,
  "closingRouAsset" NUMERIC NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseScheduleLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseScheduleLine_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leaseScheduleLine_unique" UNIQUE ("companyId", "leaseId", "periodDate"),
  CONSTRAINT "leaseScheduleLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "leaseScheduleLine_companyId_idx" ON "leaseScheduleLine" ("companyId");
CREATE INDEX IF NOT EXISTS "leaseScheduleLine_lease_idx" ON "leaseScheduleLine" ("leaseId", "companyId");
CREATE INDEX IF NOT EXISTS "leaseScheduleLine_journalId_idx" ON "leaseScheduleLine" ("journalId");
CREATE INDEX IF NOT EXISTS "leaseScheduleLine_createdBy_idx" ON "leaseScheduleLine" ("createdBy");

-- Modify / Terminate / Purchase: the lease's audit trail.
CREATE TABLE IF NOT EXISTS "leaseEvent" (
  "id" TEXT NOT NULL DEFAULT id('lev'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "eventType" "leaseEventType" NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "liabilityBefore" NUMERIC NOT NULL,
  "liabilityAfter" NUMERIC NOT NULL,
  "rouAssetBefore" NUMERIC NOT NULL,
  "rouAssetAfter" NUMERIC NOT NULL,
  "gainLoss" NUMERIC NOT NULL DEFAULT 0,
  "classificationBefore" "lesseeClassification" NOT NULL,
  "classificationAfter" "lesseeClassification" NOT NULL,
  "fixedAssetId" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseEvent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseEvent_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leaseEvent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "leaseEvent_companyId_idx" ON "leaseEvent" ("companyId");
CREATE INDEX IF NOT EXISTS "leaseEvent_lease_idx" ON "leaseEvent" ("leaseId", "companyId");
CREATE INDEX IF NOT EXISTS "leaseEvent_journalId_idx" ON "leaseEvent" ("journalId");
CREATE INDEX IF NOT EXISTS "leaseEvent_createdBy_idx" ON "leaseEvent" ("createdBy");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.

-- 8) Links ---------------------------------------------------------------------------------
ALTER TABLE "purchaseInvoiceLine"
  ADD COLUMN IF NOT EXISTS "leaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "leasePaymentId" TEXT;

ALTER TABLE "revenueRecognitionSchedule"
  ADD COLUMN IF NOT EXISTS "leaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseScheduleLineId" TEXT;

ALTER TABLE "revenueRecognitionRun"
  ADD COLUMN IF NOT EXISTS "type" "runType" NOT NULL DEFAULT 'Revenue Recognition';

DO $leaselinks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchaseInvoiceLine_lease_fkey') THEN
    ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_lease_fkey"
      FOREIGN KEY ("leaseId", "companyId") REFERENCES "lease"("id", "companyId") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchaseInvoiceLine_leasePayment_fkey') THEN
    ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_leasePayment_fkey"
      FOREIGN KEY ("leasePaymentId", "companyId") REFERENCES "leasePayment"("id", "companyId")
      ON DELETE SET NULL ("leasePaymentId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchaseInvoiceLine_lease_check') THEN
    ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_lease_check" CHECK (
      ("invoiceLineType" = 'Lease') = ("leaseId" IS NOT NULL)
      AND ("leasePaymentId" IS NULL OR "leaseId" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revenueRecognitionSchedule_lease_fkey') THEN
    ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_lease_fkey"
      FOREIGN KEY ("leaseId", "companyId") REFERENCES "lease"("id", "companyId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revenueRecognitionSchedule_leaseScheduleLine_fkey') THEN
    ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_leaseScheduleLine_fkey"
      FOREIGN KEY ("leaseScheduleLineId", "companyId") REFERENCES "leaseScheduleLine"("id", "companyId")
      ON DELETE CASCADE;
  END IF;
END $leaselinks$;
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_leaseId_idx" ON "purchaseInvoiceLine" ("leaseId", "companyId");
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_leasePaymentId_idx" ON "purchaseInvoiceLine" ("leasePaymentId", "companyId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_lease_idx" ON "revenueRecognitionSchedule" ("companyId", "leaseId");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_leaseScheduleLine_idx"
  ON "revenueRecognitionSchedule" ("leaseScheduleLineId", "companyId");

-- One Draft per period per run type.
DROP INDEX IF EXISTS "revenueRecognitionRun_one_draft_per_period";
CREATE UNIQUE INDEX IF NOT EXISTS "revenueRecognitionRun_one_draft_per_period"
  ON "revenueRecognitionRun" ("companyId", "type", "periodEnd")
  WHERE "status" = 'Draft';

-- 9) Rental rows move to lease runs: release them from Draft revenue runs ---------------
-- Posted runs keep their rows (history is immutable). A Draft run this release
-- leaves empty is deleted; a Draft run that was already empty is not ours to
-- remove.
CREATE TEMP TABLE "leaseReleasedRun" ("runId" TEXT, "companyId" TEXT) ON COMMIT DROP;

WITH released AS (
  DELETE FROM "revenueRecognitionRunLine" l
  USING "revenueRecognitionRun" r, "revenueRecognitionSchedule" s
  WHERE l."runId" = r."id" AND l."companyId" = r."companyId"
    AND r."status" = 'Draft' AND r."type" = 'Revenue Recognition'
    AND s."id" = l."scheduleId" AND s."companyId" = l."companyId"
    AND s."rentalAgreementLineId" IS NOT NULL
  RETURNING l."scheduleId", l."companyId", l."runId"
),
cleared AS (
  UPDATE "revenueRecognitionSchedule" s SET "runLineId" = NULL
  FROM released
  WHERE s."id" = released."scheduleId" AND s."companyId" = released."companyId"
)
INSERT INTO "leaseReleasedRun" ("runId", "companyId")
SELECT DISTINCT released."runId", released."companyId" FROM released;

DELETE FROM "revenueRecognitionRun" r
USING "leaseReleasedRun" rr
WHERE r."id" = rr."runId" AND r."companyId" = rr."companyId"
  AND r."status" = 'Draft'
  AND NOT EXISTS (
    SELECT 1 FROM "revenueRecognitionRunLine" l
    WHERE l."runId" = r."id" AND l."companyId" = r."companyId"
  );

DROP TABLE "leaseReleasedRun";

-- 10) purchaseInvoiceLines gains the lease (forked from 20260811123616) ----------------
DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName",
    ls."leaseId" as "leaseReadableId",
    ls."name" as "leaseName"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "lease" ls ON ls."id" = pl."leaseId" AND ls."companyId" = pl."companyId"
);

-- 11) The lease list -------------------------------------------------------------------
CREATE OR REPLACE VIEW "leases" WITH(SECURITY_INVOKER=true) AS
SELECT
  l.*,
  s."name" AS "supplierName",
  (
    SELECT p."dueDate" FROM "leasePayment" p
    WHERE p."leaseId" = l."id" AND p."companyId" = l."companyId" AND p."status" = 'Pending'
    ORDER BY p."dueDate"
    LIMIT 1
  ) AS "nextDueDate",
  COALESCE(
    (
      SELECT sl."closingLiability" FROM "leaseScheduleLine" sl
      WHERE sl."leaseId" = l."id" AND sl."companyId" = l."companyId"
        AND EXISTS (
          SELECT 1 FROM "revenueRecognitionSchedule" rs
          WHERE rs."leaseScheduleLineId" = sl."id" AND rs."companyId" = sl."companyId"
            AND rs."status" = 'Posted'
        )
      ORDER BY sl."periodDate" DESC
      LIMIT 1
    ),
    l."initialLiability"
  ) AS "currentLiability"
FROM "lease" l
JOIN "supplier" s ON s."id" = l."supplierId";

NOTIFY pgrst, 'reload schema';
