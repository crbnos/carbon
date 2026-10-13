-- Government Contracting Phase 5c: budget control, earned value and stop-work orders.
-- Spec: .ai/specs/2026-10-09-government-contracting.md (Phase 5c)
-- Plan: .ai/plans/2026-10-09-government-contracting-phase-5c.md (Task 2, decisions C6–C16)
-- The RLS for "earnedValuePeriod" ships in the generated `project-control-rls` migration.

-- 1) Project control settings -------------------------------------------------------
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "budgetControl" "budgetControl" NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS "budgetTolerancePercent" NUMERIC,          -- a fraction; null reads as 0
  ADD COLUMN IF NOT EXISTS "stopWorkDate" DATE,
  ADD COLUMN IF NOT EXISTS "materialMeasurementPoint" TEXT NOT NULL DEFAULT 'Receipt';

DO $projectcontrol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"project"'::regclass AND conname = 'project_budgetTolerance_check') THEN
    ALTER TABLE "project" ADD CONSTRAINT "project_budgetTolerance_check"
      CHECK ("budgetTolerancePercent" IS NULL OR "budgetTolerancePercent" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"project"'::regclass AND conname = 'project_materialMeasurementPoint_check') THEN
    ALTER TABLE "project" ADD CONSTRAINT "project_materialMeasurementPoint_check"
      CHECK ("materialMeasurementPoint" IN ('Receipt', 'Issue'));
  END IF;
  -- C16: an open stop-work order exists only on an On Hold project.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"project"'::regclass AND conname = 'project_stopWork_check') THEN
    ALTER TABLE "project" ADD CONSTRAINT "project_stopWork_check"
      CHECK ("stopWorkDate" IS NULL OR "status" = 'On Hold');
  END IF;
END $projectcontrol$;

-- 2) Earned value fields on the element --------------------------------------------
ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isControlAccount" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "controlAccountManagerId" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "earnedValueTechnique" "earnedValueTechnique",
  ADD COLUMN IF NOT EXISTS "earnedValuePercent" NUMERIC,             -- C8: a fraction, 0–1
  ADD COLUMN IF NOT EXISTS "apportionedToElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "apportionedFactor" NUMERIC;

DO $elementcontrol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectElement"'::regclass AND conname = 'projectElement_apportioned_fkey') THEN
    ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_apportioned_fkey"
      FOREIGN KEY ("apportionedToElementId", "projectId", "companyId")
      REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE SET NULL ("apportionedToElementId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectElement"'::regclass AND conname = 'projectElement_apportioned_check') THEN
    ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_apportioned_check"
      CHECK ("earnedValueTechnique" IS DISTINCT FROM 'Apportioned'
             OR ("apportionedToElementId" IS NOT NULL AND "apportionedFactor" > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectElement"'::regclass AND conname = 'projectElement_earnedValuePercent_check') THEN
    ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_earnedValuePercent_check"
      CHECK ("earnedValuePercent" IS NULL OR "earnedValuePercent" BETWEEN 0 AND 1);
  END IF;
  -- C7: a control account has no technique.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"projectElement"'::regclass AND conname = 'projectElement_controlAccount_check') THEN
    ALTER TABLE "projectElement" ADD CONSTRAINT "projectElement_controlAccount_check"
      CHECK (NOT ("isControlAccount" AND "earnedValueTechnique" IS NOT NULL));
  END IF;
END $elementcontrol$;

CREATE INDEX IF NOT EXISTS "projectElement_controlAccountManagerId_idx"
  ON "projectElement" ("controlAccountManagerId") WHERE "controlAccountManagerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "projectElement_apportionedToElementId_idx"
  ON "projectElement" ("apportionedToElementId", "projectId", "companyId") WHERE "apportionedToElementId" IS NOT NULL;

-- 3) The earned value period snapshot (C13) ----------------------------------------
CREATE TABLE IF NOT EXISTS "earnedValuePeriod" (
  "id" TEXT NOT NULL DEFAULT id('evp'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,          -- the work package
  "controlAccountId" TEXT NOT NULL,          -- its control account element
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id") ON DELETE RESTRICT,
  "fiscalYear" INTEGER NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "technique" "earnedValueTechnique" NOT NULL,
  "baselineId" TEXT,
  "bac" NUMERIC NOT NULL,
  "bcws" NUMERIC NOT NULL,                   -- cumulative to the period end
  "bcwp" NUMERIC NOT NULL,
  "acwp" NUMERIC NOT NULL,
  "acwpHours" NUMERIC NOT NULL,
  "acwpByElement" JSONB NOT NULL,            -- { "Labor": n, "Material": n, "Subcontract": n, "Other Direct": n, "Overhead": n, "G&A": n }
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "earnedValuePeriod_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "earnedValuePeriod_period_key" UNIQUE ("projectElementId", "accountingPeriodId", "companyId"),
  CONSTRAINT "earnedValuePeriod_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "earnedValuePeriod_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "earnedValuePeriod_controlAccount_fkey" FOREIGN KEY ("controlAccountId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "earnedValuePeriod_baseline_fkey" FOREIGN KEY ("baselineId", "companyId") REFERENCES "projectBaseline"("id", "companyId") ON DELETE SET NULL ("baselineId"),
  CONSTRAINT "earnedValuePeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "earnedValuePeriod_companyId_idx" ON "earnedValuePeriod" ("companyId");
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_project_idx" ON "earnedValuePeriod" ("companyId", "projectId", "accountingPeriodId");
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_controlAccount_idx" ON "earnedValuePeriod" ("controlAccountId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_accountingPeriodId_idx" ON "earnedValuePeriod" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_baselineId_idx" ON "earnedValuePeriod" ("baselineId", "companyId") WHERE "baselineId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "earnedValuePeriod_createdBy_idx" ON "earnedValuePeriod" ("createdBy");

-- C13: freeze at close. FOR SHARE waits behind an in-flight close.
CREATE OR REPLACE FUNCTION public.check_earned_value_period_open()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status "periodCloseStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = OLD."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = NEW."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "earnedValuePeriod_check_period_open" ON "earnedValuePeriod";
CREATE TRIGGER "earnedValuePeriod_check_period_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "earnedValuePeriod"
  FOR EACH ROW EXECUTE FUNCTION public.check_earned_value_period_open();

-- 4) Close-checklist task (C14; its evaluator ships in Task 14) ---------------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Close earned value for the period', 'Auto', 'earned-value-closed', 5, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Close earned value for the period'
  );
