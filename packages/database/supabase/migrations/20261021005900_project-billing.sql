-- Project billing Phase 4a (.ai/specs/2026-10-09-project-billing.md,
-- .ai/plans/2026-10-09-project-billing-phase-4a.md): billing terms on the contract
-- line, bill rates, the billable item re-bill hold, and the subtree and funding
-- functions. RLS for the new table is rendered from the authz manifest.

-- 1) Billing terms on the contract line --------------------------------------------
ALTER TABLE "customerContractLine"
  ADD COLUMN IF NOT EXISTS "billingMethod" "contractBillingMethod" NOT NULL DEFAULT 'Fixed',
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "materialHandlingPercent" NUMERIC,
  ADD COLUMN IF NOT EXISTS "feePercent" NUMERIC,
  ADD COLUMN IF NOT EXISTS "fundedAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "fundedCost" NUMERIC,
  ADD COLUMN IF NOT EXISTS "noticePercent" NUMERIC NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS "noticeWindowDays" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "ceilingAmount" NUMERIC,
  ADD COLUMN IF NOT EXISTS "thresholdNoticeFundedCost" NUMERIC,
  ADD COLUMN IF NOT EXISTS "runOutNoticeFundedCost" NUMERIC;

DO $$ BEGIN
  ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_projectElement_fkey"
    FOREIGN KEY ("projectElementId", "projectId", "companyId")
    REFERENCES "projectElement"("id", "projectId", "companyId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_billing_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_billing_check" CHECK (
  "billingMethod" = 'Fixed'
  OR ("projectId" IS NOT NULL AND "projectElementId" IS NOT NULL AND "quantity" = 1 AND "rate" = 0
      AND "revenueType" = 'One-time')
);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_fee_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_fee_check"
  CHECK ("billingMethod" <> 'Cost Plus' OR "feePercent" IS NOT NULL);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_revenueMethod_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_revenueMethod_check" CHECK (
  ("billingMethod" = 'Fixed' AND "revenueMethod" IN ('Daily', 'Even Period', 'Percent Complete'))
  OR ("billingMethod" = 'Time & Materials' AND "revenueMethod" = 'Right to Invoice')
  OR ("billingMethod" = 'Cost Plus' AND "revenueMethod" IN ('Right to Invoice', 'Percent Complete'))
);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_progress_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_progress_check"
  CHECK ("revenueMethod" <> 'Percent Complete' OR "projectElementId" IS NOT NULL);
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_funding_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_funding_check" CHECK (
  ("materialHandlingPercent" IS NULL OR "materialHandlingPercent" BETWEEN 0 AND 1)
  AND ("feePercent" IS NULL OR "feePercent" BETWEEN 0 AND 1)
  AND ("fundedAmount" IS NULL OR "fundedAmount" >= 0)
  AND ("fundedCost" IS NULL OR "fundedCost" >= 0)
  AND ("ceilingAmount" IS NULL OR "ceilingAmount" >= 0)
  AND "noticePercent" BETWEEN 0.75 AND 0.85
  AND "noticeWindowDays" BETWEEN 30 AND 90
);
CREATE INDEX IF NOT EXISTS "customerContractLine_projectElementId_idx"
  ON "customerContractLine" ("projectElementId", "companyId") WHERE "projectElementId" IS NOT NULL;

-- 2) Bill rates -------------------------------------------------------------------
ALTER TABLE "laborCategoryRate" ADD COLUMN IF NOT EXISTS "billRate" NUMERIC CHECK ("billRate" IS NULL OR "billRate" >= 0);

CREATE TABLE IF NOT EXISTS "customerContractLaborRate" (
  "id" TEXT NOT NULL DEFAULT id('conlr'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "laborCategoryId" TEXT,
  "employeeId" TEXT REFERENCES "user"("id"),
  "billRate" NUMERIC NOT NULL CHECK ("billRate" >= 0),
  "effectiveFrom" DATE NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractLaborRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLaborRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLaborRate_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLaborRate_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId")
    REFERENCES "laborCategory"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLaborRate_subject_check" CHECK (num_nonnulls("laborCategoryId", "employeeId") = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "customerContractLaborRate_key" ON "customerContractLaborRate"
  ("customerContractLineId", COALESCE("laborCategoryId", ''), COALESCE("employeeId", ''), "effectiveFrom", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_companyId_idx" ON "customerContractLaborRate" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_customerContractLineId_idx"
  ON "customerContractLaborRate" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_laborCategoryId_idx"
  ON "customerContractLaborRate" ("laborCategoryId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_employeeId_idx" ON "customerContractLaborRate" ("employeeId");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_createdBy_idx" ON "customerContractLaborRate" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerContractLaborRate_updatedBy_idx" ON "customerContractLaborRate" ("updatedBy");

-- 3) Billable items ---------------------------------------------------------------
ALTER TABLE "projectBillableItem" ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;  -- re-bill hold (P4), no FK
DO $$ BEGIN
  ALTER TABLE "projectBillableItem" ADD CONSTRAINT "projectBillableItem_contractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "projectBillableItem_contractLine_idx"
  ON "projectBillableItem" ("companyId", "customerContractLineId", "status") WHERE "customerContractLineId" IS NOT NULL;

-- 4) Functions ---------------------------------------------------------------------
-- Both take the date as an argument: never CURRENT_DATE (the session day is UTC).

-- One billing element subtree per line: the line's element and every descendant.
CREATE OR REPLACE FUNCTION get_contract_line_subtree(p_company_id TEXT, p_line_ids TEXT[])
RETURNS TABLE ("customerContractLineId" TEXT, "projectElementId" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH RECURSIVE tree AS (
    SELECT l."id" AS line_id, e."id" AS element_id
    FROM "customerContractLine" l
    JOIN "projectElement" e ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
    WHERE l."companyId" = p_company_id AND l."id" = ANY (p_line_ids)
    UNION ALL
    SELECT t.line_id, c."id"
    FROM tree t
    JOIN "projectElement" c ON c."parentId" = t.element_id AND c."companyId" = p_company_id
  )
  SELECT line_id, element_id FROM tree;
$$;

-- The funding position of each line on p_as_of (spec *Funding*).
CREATE OR REPLACE FUNCTION get_contract_line_funding(p_company_id TEXT, p_line_ids TEXT[], p_as_of DATE)
RETURNS TABLE (
  "customerContractLineId" TEXT, "billed" NUMERIC, "unbilled" NUMERIC,
  "incurred" NUMERIC, "recentCost" NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH lines AS (SELECT unnest(p_line_ids) AS line_id),
  items AS (
    SELECT b."customerContractLineId" AS line_id,
      SUM(b."amount") FILTER (WHERE b."status" = 'Billed') AS billed,
      SUM(b."amount") FILTER (WHERE b."status" IN ('Unbilled', 'On Hold')) AS unbilled
    FROM "projectBillableItem" b
    WHERE b."companyId" = p_company_id AND b."customerContractLineId" = ANY (p_line_ids)
    GROUP BY b."customerContractLineId"
  ),
  costs AS (
    SELECT s."customerContractLineId" AS line_id,
      SUM(pl."amount") FILTER (WHERE pl."postingDate" <= p_as_of) AS incurred,
      SUM(pl."amount") FILTER (WHERE pl."postingDate" > p_as_of - 90 AND pl."postingDate" <= p_as_of) AS recent
    FROM get_contract_line_subtree(p_company_id, p_line_ids) s
    JOIN "projectLedger" pl ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = p_company_id
    GROUP BY s."customerContractLineId"
  )
  SELECT l.line_id, COALESCE(i.billed, 0), COALESCE(i.unbilled, 0),
         COALESCE(c.incurred, 0), COALESCE(c.recent, 0)
  FROM lines l
  LEFT JOIN items i ON i.line_id = l.line_id
  LEFT JOIN costs c ON c.line_id = l.line_id;
$$;

NOTIFY pgrst, 'reload schema';
