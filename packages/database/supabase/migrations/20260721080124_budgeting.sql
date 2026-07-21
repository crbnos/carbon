-- Budgeting Phase 1: budget + budgetLine
-- Amounts are GL-signed (positive = debit), matching journalLine.amount.
-- Spec: .ai/specs/2026-07-02-budgeting.md
-- Ordered after 20260702044133_period-close-lifecycle.sql (fiscalYear/periodNumber).

DO $$ BEGIN
  CREATE TYPE "budgetStatus" AS ENUM ('Draft', 'Approved', 'Archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budget" (
    "id" TEXT NOT NULL DEFAULT id('bud'),
    "companyId" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "description" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "status" "budgetStatus" NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT REFERENCES "user"("id"),
    "approvedAt" TIMESTAMP WITH TIME ZONE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "budget_companyId_idx" ON "budget" ("companyId");
CREATE INDEX IF NOT EXISTS "budget_createdBy_idx" ON "budget" ("createdBy");
CREATE INDEX IF NOT EXISTS "budget_companyId_fiscalYear_idx" ON "budget" ("companyId", "fiscalYear");

DO $$ BEGIN
  ALTER TABLE "budget" ADD CONSTRAINT "budget_companyId_name_key"
      UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budgetLine" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,

    "accountId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "amount" NUMERIC NOT NULL DEFAULT 0,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("budgetId", "companyId") REFERENCES "budget"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE,
    FOREIGN KEY ("accountingPeriodId") REFERENCES "accountingPeriod"("id") ON DELETE CASCADE,
    FOREIGN KEY ("costCenterId") REFERENCES "costCenter"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "budgetLine_companyId_idx" ON "budgetLine" ("companyId");
CREATE INDEX IF NOT EXISTS "budgetLine_budgetId_idx" ON "budgetLine" ("budgetId", "companyId");
CREATE INDEX IF NOT EXISTS "budgetLine_accountId_idx" ON "budgetLine" ("accountId");
CREATE INDEX IF NOT EXISTS "budgetLine_accountingPeriodId_idx" ON "budgetLine" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "budgetLine_costCenterId_idx" ON "budgetLine" ("costCenterId");
CREATE INDEX IF NOT EXISTS "budgetLine_createdBy_idx" ON "budgetLine" ("createdBy");

-- One cell per (budget, account, period, cost center); PG15 NULLS NOT DISTINCT
-- makes two NULL-cost-center rows for the same cell collide, as intended.
DO $$ BEGIN
  ALTER TABLE "budgetLine" ADD CONSTRAINT "budgetLine_cell_key"
      UNIQUE NULLS NOT DISTINCT ("budgetId", "companyId", "accountId", "accountingPeriodId", "costCenterId");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- Hard backstop (period-close trigger pattern): lines writable only in Draft.
CREATE OR REPLACE FUNCTION check_budget_editable() RETURNS TRIGGER AS $$
DECLARE v_status "budgetStatus";
BEGIN
  SELECT "status" INTO v_status FROM "budget"
    WHERE "id" = COALESCE(NEW."budgetId", OLD."budgetId")
      AND "companyId" = COALESCE(NEW."companyId", OLD."companyId");
  IF v_status IS DISTINCT FROM 'Draft' THEN
    RAISE EXCEPTION 'Budget is % — copy it to a new draft to revise', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "budgetLine_check_editable" ON "budgetLine";
CREATE TRIGGER "budgetLine_check_editable"
  BEFORE INSERT OR UPDATE OR DELETE ON "budgetLine"
  FOR EACH ROW EXECUTE FUNCTION check_budget_editable();

-- RLS
ALTER TABLE "public"."budget" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."budget";
CREATE POLICY "SELECT" ON "public"."budget"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."budget";
CREATE POLICY "INSERT" ON "public"."budget"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."budget";
CREATE POLICY "UPDATE" ON "public"."budget"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."budget";
CREATE POLICY "DELETE" ON "public"."budget"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

ALTER TABLE "public"."budgetLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."budgetLine";
CREATE POLICY "SELECT" ON "public"."budgetLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."budgetLine";
CREATE POLICY "INSERT" ON "public"."budgetLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."budgetLine";
CREATE POLICY "UPDATE" ON "public"."budgetLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."budgetLine";
CREATE POLICY "DELETE" ON "public"."budgetLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- Copy another budget's lines into the target, remapping periods by
-- periodNumber across fiscal years and scaling by an adjustment factor.
-- SECURITY INVOKER keeps RLS in force; the Draft-only trigger enforces
-- target-is-Draft per row.
CREATE OR REPLACE FUNCTION "copyBudgetLines"(
  p_company_id TEXT,
  p_source_budget_id TEXT,
  p_target_budget_id TEXT,
  p_adjustment_factor NUMERIC DEFAULT 1,
  p_created_by TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM "budgetLine"
  WHERE "budgetId" = p_target_budget_id AND "companyId" = p_company_id;

  INSERT INTO "budgetLine"
    ("companyId", "budgetId", "accountId", "accountingPeriodId", "costCenterId", "amount", "createdBy")
  SELECT
    p_company_id,
    p_target_budget_id,
    bl."accountId",
    tp."id",
    bl."costCenterId",
    ROUND(bl."amount" * p_adjustment_factor, 2),
    COALESCE(p_created_by, bl."createdBy")
  FROM "budgetLine" bl
  JOIN "budget" sb ON sb."id" = bl."budgetId" AND sb."companyId" = bl."companyId"
  JOIN "budget" tb ON tb."id" = p_target_budget_id AND tb."companyId" = p_company_id
  JOIN "accountingPeriod" sp
    ON sp."id" = bl."accountingPeriodId" AND sp."companyId" = p_company_id
  JOIN "accountingPeriod" tp
    ON tp."companyId" = p_company_id
   AND tp."fiscalYear" = tb."fiscalYear"
   AND tp."periodNumber" = sp."periodNumber"
  WHERE bl."budgetId" = p_source_budget_id
    AND bl."companyId" = p_company_id
    AND bl."amount" != 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Seed a budget from a source fiscal year's posted actuals, aggregated by
-- account x period-number x cost center (via the CostCenter-type dimension),
-- scaled by an adjustment factor. p_spread = 'source' preserves the monthly
-- profile; 'even' flattens the annual total across the periods that had activity.
CREATE OR REPLACE FUNCTION "seedBudgetLinesFromActuals"(
  p_company_id TEXT,
  p_source_fiscal_year INTEGER,
  p_target_budget_id TEXT,
  p_adjustment_factor NUMERIC DEFAULT 1,
  p_spread TEXT DEFAULT 'source',           -- 'source' | 'even'
  p_created_by TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM "budgetLine"
  WHERE "budgetId" = p_target_budget_id AND "companyId" = p_company_id;

  WITH "costCenterDim" AS (
    SELECT d."id"
    FROM "dimension" d
    JOIN "company" c ON c."companyGroupId" = d."companyGroupId"
    WHERE c."id" = p_company_id AND d."entityType" = 'CostCenter'
    LIMIT 1
  ),
  "actuals" AS (
    SELECT
      jl."accountId",
      sp."periodNumber",
      jld."valueId" AS "costCenterId",
      SUM(jl."amount") AS "amount"
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = p_company_id
    JOIN "accountingPeriod" sp
      ON sp."id" = j."accountingPeriodId"
     AND sp."companyId" = p_company_id
     AND sp."fiscalYear" = p_source_fiscal_year
    LEFT JOIN "journalLineDimension" jld
      ON jld."journalLineId" = jl."id"
     AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
    WHERE jl."companyId" = p_company_id
      AND jl."accountId" IS NOT NULL
      -- Seed from posted actuals only (exclude Draft journals).
      AND j."status" != 'Draft'
    GROUP BY jl."accountId", sp."periodNumber", jld."valueId"
  ),
  "shaped" AS (
    SELECT
      a."accountId",
      tp."id" AS "accountingPeriodId",
      a."costCenterId",
      CASE
        WHEN p_spread = 'even' THEN
          ROUND((SUM(a."amount") OVER (PARTITION BY a."accountId", a."costCenterId"))
            * p_adjustment_factor
            / (COUNT(*) OVER (PARTITION BY a."accountId", a."costCenterId")), 2)
        ELSE ROUND(a."amount" * p_adjustment_factor, 2)
      END AS "amount"
    FROM "actuals" a
    JOIN "budget" tb ON tb."id" = p_target_budget_id AND tb."companyId" = p_company_id
    JOIN "accountingPeriod" tp
      ON tp."companyId" = p_company_id
     AND tp."fiscalYear" = tb."fiscalYear"
     AND tp."periodNumber" = a."periodNumber"
  )
  INSERT INTO "budgetLine"
    ("companyId", "budgetId", "accountId", "accountingPeriodId", "costCenterId", "amount", "createdBy")
  SELECT p_company_id, p_target_budget_id, s."accountId", s."accountingPeriodId",
         s."costCenterId", s."amount", p_created_by
  FROM "shaped" s
  WHERE s."amount" != 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Budget vs Actual report. Budget side from budgetLine; actual side from
-- journalLine grouped to the budget's fiscal-year periods by periodNumber.
-- Cost-center filter includes the selected cost center's subtree when p_rollup;
-- NULL-costCenter budget rows are company-level and included only when no cost
-- center is selected. p_untagged returns only actuals with no CostCenter tag.
CREATE OR REPLACE FUNCTION "budgetVsActual"(
  p_company_id TEXT,
  p_budget_id TEXT,
  p_cost_center_id TEXT DEFAULT NULL,
  p_rollup BOOLEAN DEFAULT TRUE,
  p_untagged BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  "accountId" TEXT,
  "number" TEXT,
  "name" TEXT,
  "class" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "periodNumber" INTEGER,
  "budget" NUMERIC,
  "actual" NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH "targetBudget" AS (
    SELECT b."id", b."companyId", b."fiscalYear"
    FROM "budget" b
    WHERE b."id" = p_budget_id AND b."companyId" = p_company_id
  ),
  "periods" AS (
    SELECT ap."id", ap."periodNumber"
    FROM "accountingPeriod" ap
    JOIN "targetBudget" tb ON ap."companyId" = tb."companyId"
     AND ap."fiscalYear" = tb."fiscalYear"
  ),
  "costCenterDim" AS (
    SELECT d."id"
    FROM "dimension" d
    JOIN "company" c ON c."companyGroupId" = d."companyGroupId"
    WHERE c."id" = p_company_id AND d."entityType" = 'CostCenter'
    LIMIT 1
  ),
  "costCenters" AS (
    WITH RECURSIVE "tree" AS (
      SELECT cc."id" FROM "costCenter" cc
      WHERE cc."id" = p_cost_center_id AND cc."companyId" = p_company_id
      UNION ALL
      SELECT child."id" FROM "costCenter" child
      JOIN "tree" t ON child."parentCostCenterId" = t."id"
      WHERE p_rollup
    )
    SELECT "id" FROM "tree"
  ),
  "budgetSide" AS (
    SELECT bl."accountId", p."periodNumber", SUM(bl."amount") AS "amount"
    FROM "budgetLine" bl
    JOIN "periods" p ON p."id" = bl."accountingPeriodId"
    WHERE bl."budgetId" = p_budget_id
      AND bl."companyId" = p_company_id
      AND (
        (p_untagged AND bl."costCenterId" IS NULL)
        OR (NOT p_untagged AND p_cost_center_id IS NULL)
        OR (NOT p_untagged AND bl."costCenterId" IN (SELECT "id" FROM "costCenters"))
      )
    GROUP BY bl."accountId", p."periodNumber"
  ),
  "actualSide" AS (
    SELECT jl."accountId", p."periodNumber", SUM(jl."amount") AS "amount"
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = p_company_id
    JOIN "periods" p ON p."id" = j."accountingPeriodId"
    WHERE jl."companyId" = p_company_id
      AND jl."accountId" IS NOT NULL
      -- Exclude Draft journals so Actual ties to the trial balance / income
      -- statement (repo standard, 20260711011724_exclude-draft-journals.sql).
      AND j."status" != 'Draft'
      AND (
        (p_untagged AND NOT EXISTS (
          SELECT 1 FROM "journalLineDimension" jld
          WHERE jld."journalLineId" = jl."id"
            AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
        ))
        OR (NOT p_untagged AND p_cost_center_id IS NULL)
        OR (NOT p_untagged AND EXISTS (
          SELECT 1 FROM "journalLineDimension" jld
          WHERE jld."journalLineId" = jl."id"
            AND jld."dimensionId" = (SELECT "id" FROM "costCenterDim")
            AND jld."valueId" IN (SELECT "id" FROM "costCenters")
        ))
      )
    GROUP BY jl."accountId", p."periodNumber"
  )
  SELECT
    a."id",
    a."number",
    a."name",
    a."class",
    a."incomeBalance",
    COALESCE(b."periodNumber", act."periodNumber"),
    COALESCE(b."amount", 0),
    COALESCE(act."amount", 0)
  FROM "budgetSide" b
  FULL OUTER JOIN "actualSide" act
    ON act."accountId" = b."accountId" AND act."periodNumber" = b."periodNumber"
  JOIN "account" a ON a."id" = COALESCE(b."accountId", act."accountId")
  ORDER BY a."number", COALESCE(b."periodNumber", act."periodNumber");
END;
$$;
