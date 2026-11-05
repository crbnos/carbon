-- Government Contracting Phase 5b: indirect pools, rates and burden.
-- Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5b)
-- Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 2, decisions B1–B15)
--
-- RLS for every new table is in the authz manifest (Task 3), not here.
-- The close task "Compute burden for the period" ships its evaluator in Task 13.

-- 1) Pools ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "indirectPool" (
  "id" TEXT NOT NULL DEFAULT id('ipl'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "poolType" "indirectPoolType" NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "baseType" "indirectBaseType" NOT NULL,
  "appliedAccountId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  "appliesToProjects" BOOLEAN NOT NULL DEFAULT TRUE,
  "offsetAbsorbedOverhead" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectPool_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectPool_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "indirectPool_sequence_key" UNIQUE ("sequence", "companyId"),
  CONSTRAINT "indirectPool_serviceCenter_check" CHECK ("poolType" <> 'Service Center' OR NOT "appliesToProjects"),
  CONSTRAINT "indirectPool_offset_check" CHECK (NOT "offsetAbsorbedOverhead" OR "poolType" = 'Overhead'),
  CONSTRAINT "indirectPool_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "indirectPool_companyId_idx" ON "indirectPool" ("companyId");
CREATE INDEX IF NOT EXISTS "indirectPool_appliedAccountId_idx" ON "indirectPool" ("appliedAccountId");
CREATE INDEX IF NOT EXISTS "indirectPool_createdBy_idx" ON "indirectPool" ("createdBy");

-- 2) Pool accounts: a GL account (optionally narrowed by one dimension value) as Cost or Base
CREATE TABLE IF NOT EXISTS "indirectPoolAccount" (
  "id" TEXT NOT NULL DEFAULT id('ipa'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT,
  "dimensionId" TEXT REFERENCES "dimension"("id") ON DELETE CASCADE,
  "dimensionValueId" TEXT,                 -- polymorphic, like journalLineDimension.valueId
  "role" "indirectPoolAccountRole" NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectPoolAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectPoolAccount_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectPoolAccount_dimension_check" CHECK (("dimensionId" IS NULL) = ("dimensionValueId" IS NULL)),
  CONSTRAINT "indirectPoolAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "indirectPoolAccount_cell_key"
  ON "indirectPoolAccount" ("indirectPoolId", "accountId", COALESCE("dimensionValueId", ''), "role", "companyId");
-- B4: one cell is Cost in at most one pool
CREATE UNIQUE INDEX IF NOT EXISTS "indirectPoolAccount_cost_key"
  ON "indirectPoolAccount" ("companyId", "accountId", COALESCE("dimensionValueId", '')) WHERE "role" = 'Cost';
CREATE INDEX IF NOT EXISTS "indirectPoolAccount_companyId_idx" ON "indirectPoolAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "indirectPoolAccount_accountId_idx" ON "indirectPoolAccount" ("accountId");
CREATE INDEX IF NOT EXISTS "indirectPoolAccount_dimensionId_idx" ON "indirectPoolAccount" ("dimensionId");
CREATE INDEX IF NOT EXISTS "indirectPoolAccount_createdBy_idx" ON "indirectPoolAccount" ("createdBy");

-- 3) Rates: one per pool × fiscal year × period × rate type
CREATE TABLE IF NOT EXISTS "indirectRate" (
  "id" TEXT NOT NULL DEFAULT id('irt'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL CHECK ("periodNumber" BETWEEN 1 AND 12),
  "rateType" "indirectRateType" NOT NULL,
  "periodRate" NUMERIC,
  "ytdRate" NUMERIC NOT NULL,
  "poolCost" NUMERIC,              -- Actual only: YTD allowable pool cost
  "unallowableCost" NUMERIC,       -- Actual only
  "baseAmount" NUMERIC,            -- Actual only: YTD base
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectRate_period_key" UNIQUE ("indirectPoolId", "fiscalYear", "periodNumber", "rateType", "companyId"),
  CONSTRAINT "indirectRate_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectRate_actual_check" CHECK ("rateType" <> 'Actual' OR "baseAmount" IS NOT NULL),
  CONSTRAINT "indirectRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "indirectRate_companyId_idx" ON "indirectRate" ("companyId");
CREATE INDEX IF NOT EXISTS "indirectRate_createdBy_idx" ON "indirectRate" ("createdBy");

-- 4) Statement of Indirect Expenses: pool cost by account, YTD through the period
CREATE TABLE IF NOT EXISTS "indirectExpenseStatement" (
  "id" TEXT NOT NULL DEFAULT id('ies'),
  "companyId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "lineType" TEXT NOT NULL CHECK ("lineType" IN ('Account', 'Carried Burden', 'Absorbed Overhead')),
  "accountId" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  "dimensionValueId" TEXT,
  "sourcePoolId" TEXT,
  "amount" NUMERIC NOT NULL,                       -- YTD through the period
  "unallowableAmount" NUMERIC NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "indirectExpenseStatement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectExpenseStatement_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectExpenseStatement_source_fkey" FOREIGN KEY ("sourcePoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "indirectExpenseStatement_source_check" CHECK (("lineType" = 'Carried Burden') = ("sourcePoolId" IS NOT NULL)),
  CONSTRAINT "indirectExpenseStatement_account_check" CHECK ("lineType" = 'Carried Burden' OR "accountId" IS NOT NULL),
  CONSTRAINT "indirectExpenseStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- Leads with companyId, so it also serves the companyId and pool FK lookups.
CREATE INDEX IF NOT EXISTS "indirectExpenseStatement_period_idx"
  ON "indirectExpenseStatement" ("companyId", "indirectPoolId", "fiscalYear", "periodNumber");
CREATE INDEX IF NOT EXISTS "indirectExpenseStatement_accountId_idx" ON "indirectExpenseStatement" ("accountId");
CREATE INDEX IF NOT EXISTS "indirectExpenseStatement_sourcePoolId_idx" ON "indirectExpenseStatement" ("sourcePoolId", "companyId");
CREATE INDEX IF NOT EXISTS "indirectExpenseStatement_createdBy_idx" ON "indirectExpenseStatement" ("createdBy");

-- 5) Rate ceilings on a contract line
CREATE TABLE IF NOT EXISTS "customerContractRateCeiling" (
  "id" TEXT NOT NULL DEFAULT id('crc'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "indirectPoolId" TEXT NOT NULL,
  "ceilingRate" NUMERIC NOT NULL CHECK ("ceilingRate" >= 0),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractRateCeiling_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractRateCeiling_key" UNIQUE ("customerContractLineId", "indirectPoolId", "companyId"),
  CONSTRAINT "customerContractRateCeiling_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRateCeiling_pool_fkey" FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractRateCeiling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractRateCeiling_companyId_idx" ON "customerContractRateCeiling" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractRateCeiling_indirectPoolId_idx" ON "customerContractRateCeiling" ("indirectPoolId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractRateCeiling_createdBy_idx" ON "customerContractRateCeiling" ("createdBy");

-- 6) Period runs (B11)
CREATE TABLE IF NOT EXISTS "indirectRateRun" (
  "id" TEXT NOT NULL DEFAULT id('irr'),
  "companyId" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id") ON DELETE CASCADE,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "burdenRateType" "indirectRateType",
  "ratesComputedAt" TIMESTAMP WITH TIME ZONE,
  "burdenComputedAt" TIMESTAMP WITH TIME ZONE,
  "billingComputedAt" TIMESTAMP WITH TIME ZONE,
  "burdenRowCount" INTEGER NOT NULL DEFAULT 0,
  "billableItemCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "indirectRateRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "indirectRateRun_period_key" UNIQUE ("accountingPeriodId", "companyId"),
  CONSTRAINT "indirectRateRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "indirectRateRun_companyId_idx" ON "indirectRateRun" ("companyId");
CREATE INDEX IF NOT EXISTS "indirectRateRun_createdBy_idx" ON "indirectRateRun" ("createdBy");

-- 7) Burden rows in the project ledger (B8)
ALTER TABLE "projectLedger"
  ADD COLUMN IF NOT EXISTS "indirectPoolId" TEXT,
  ADD COLUMN IF NOT EXISTS "indirectRateType" "indirectRateType",
  ADD COLUMN IF NOT EXISTS "burdenFiscalYear" INTEGER;

DO $burden$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectLedger"'::regclass AND conname = 'projectLedger_pool_fkey') THEN
    ALTER TABLE "projectLedger" ADD CONSTRAINT "projectLedger_pool_fkey"
      FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectLedger"'::regclass AND conname = 'projectLedger_burden_check') THEN
    ALTER TABLE "projectLedger" ADD CONSTRAINT "projectLedger_burden_check"
      CHECK (("costType" = 'Burden') = ("indirectPoolId" IS NOT NULL AND "indirectRateType" IS NOT NULL AND "burdenFiscalYear" IS NOT NULL));
  END IF;
END $burden$;

CREATE INDEX IF NOT EXISTS "projectLedger_burden_idx"
  ON "projectLedger" ("companyId", "projectId", "indirectPoolId", "burdenFiscalYear") WHERE "costType" = 'Burden';
-- Serves the pool FK check when a pool is deleted.
CREATE INDEX IF NOT EXISTS "projectLedger_indirectPoolId_idx"
  ON "projectLedger" ("indirectPoolId", "companyId") WHERE "indirectPoolId" IS NOT NULL;

-- 8) Burden billable items (B5, B6)
ALTER TABLE "projectBillableItem"
  ALTER COLUMN "projectLedgerId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "indirectPoolId" TEXT,
  ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "burdenRate" NUMERIC,
  ADD COLUMN IF NOT EXISTS "burdenBase" NUMERIC,
  ADD COLUMN IF NOT EXISTS "postingDate" DATE;

DO $burdenitem$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectBillableItem"'::regclass AND conname = 'projectBillableItem_pool_fkey') THEN
    ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_pool_fkey"
      FOREIGN KEY ("indirectPoolId", "companyId") REFERENCES "indirectPool"("id", "companyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectBillableItem"'::regclass AND conname = 'projectBillableItem_source_check') THEN
    ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_source_check"
      CHECK ("projectLedgerId" IS NOT NULL OR ("indirectPoolId" IS NOT NULL AND "customerContractLineId" IS NOT NULL
        AND "fiscalYear" IS NOT NULL AND "postingDate" IS NOT NULL));
  END IF;
END $burdenitem$;

CREATE INDEX IF NOT EXISTS "projectBillableItem_burden_idx"
  ON "projectBillableItem" ("companyId", "customerContractLineId", "indirectPoolId", "fiscalYear") WHERE "indirectPoolId" IS NOT NULL;
-- Serves the pool FK check when a pool is deleted.
CREATE INDEX IF NOT EXISTS "projectBillableItem_indirectPoolId_idx"
  ON "projectBillableItem" ("indirectPoolId", "companyId") WHERE "indirectPoolId" IS NOT NULL;

-- 9) Company burden settings (B9)
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "burdenRateType" "indirectRateType" NOT NULL DEFAULT 'Provisional',
  ADD COLUMN IF NOT EXISTS "postAppliedBurden" BOOLEAN NOT NULL DEFAULT FALSE;

DO $burdensettings$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"companySettings"'::regclass AND conname = 'companySettings_burdenRateType_check') THEN
    ALTER TABLE "companySettings" ADD CONSTRAINT "companySettings_burdenRateType_check"
      CHECK ("burdenRateType" IN ('Provisional', 'Actual'));
  END IF;
END $burdensettings$;

-- 10) The project Costs tab reads burden by pool (Task 18).
CREATE OR REPLACE FUNCTION get_project_burden_summary(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE ("projectElementId" TEXT, "indirectPoolId" TEXT, "poolName" TEXT, "amount" NUMERIC, "unallowableAmount" NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT pl."projectElementId", pl."indirectPoolId", p."name",
         SUM(pl."amount"), SUM(CASE WHEN pl."unallowable" THEN pl."amount" ELSE 0 END)
  FROM "projectLedger" pl
  JOIN "indirectPool" p ON p."id" = pl."indirectPoolId" AND p."companyId" = pl."companyId"
  WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id AND pl."costType" = 'Burden'
  GROUP BY pl."projectElementId", pl."indirectPoolId", p."name";
$$;

-- 11) Close-checklist task (its evaluator ships in Task 13) -------------------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Compute burden for the period', 'Auto', 'burden-computed', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Compute burden for the period'
  );
