-- SQL functions for Projects Phase 1a: the cost summary behind the Costs tab, and the
-- project posting account resolver for SQL posting paths.
-- Spec: .ai/specs/2026-10-03-projects.md (Plan, budget, actuals; Cost treatment → posting account)

-- One row per element of the project, plus one row with "projectElementId" NULL for
-- project-level charges. The roll-up to ancestors happens in the app, where the tree
-- is already loaded.
-- CURRENT_DATE below is the database's UTC day. It only picks a labor rate for a plan
-- estimate, never a posting, so the UTC day is acceptable here. Do not copy it into
-- a posting path.
CREATE OR REPLACE FUNCTION get_project_cost_summary(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE (
  "projectElementId" TEXT,
  "planMaterial" NUMERIC,
  "planLabor" NUMERIC,
  "planOther" NUMERIC,
  "committed" NUMERIC,
  "actual" NUMERIC,
  "actualHours" NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH elements AS (
    SELECT e."id" FROM "projectElement" e
    WHERE e."projectId" = p_project_id AND e."companyId" = p_company_id
    UNION ALL SELECT NULL
  ),
  plan_material AS (
    SELECT m."projectElementId", SUM(m."quantity" * COALESCE(m."unitCost", ic."unitCost", 0)) AS v
    FROM "projectElementMaterial" m
    LEFT JOIN "itemCost" ic ON ic."itemId" = m."itemId" AND ic."companyId" = m."companyId"
    WHERE m."projectId" = p_project_id AND m."companyId" = p_company_id
    GROUP BY m."projectElementId"
  ),
  plan_labor AS (
    SELECT l."projectElementId", SUM(l."hours" * COALESCE((
      SELECT r."costRate" FROM "laborCategoryRate" r
      WHERE r."laborCategoryId" = l."laborCategoryId" AND r."companyId" = l."companyId"
        AND r."effectiveFrom" <= CURRENT_DATE
      ORDER BY r."effectiveFrom" DESC LIMIT 1), 0)) AS v
    FROM "projectElementLabor" l
    WHERE l."projectId" = p_project_id AND l."companyId" = p_company_id
    GROUP BY l."projectElementId"
  ),
  plan_other AS (
    SELECT c."projectElementId", SUM(c."amount") AS v
    FROM "projectElementCost" c
    WHERE c."projectId" = p_project_id AND c."companyId" = p_company_id
    GROUP BY c."projectElementId"
  ),
  commitments AS (
    SELECT pol."projectElementId",
      SUM(GREATEST(pol."purchaseQuantity" - COALESCE(pol."quantityReceived", 0), 0) * COALESCE(pol."unitPrice", 0)) AS v
    FROM "purchaseOrderLine" pol
    JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId"
    WHERE pol."projectId" = p_project_id AND pol."companyId" = p_company_id
      AND po."status" IN ('To Receive', 'To Receive and Invoice', 'To Invoice', 'Planned')
    GROUP BY pol."projectElementId"
  ),
  actuals AS (
    SELECT pl."projectElementId", SUM(pl."amount") AS v
    FROM "projectLedger" pl
    WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id
    GROUP BY pl."projectElementId"
  ),
  hours AS (
    SELECT t."projectElementId", SUM(t."hours") AS v
    FROM "timesheetEntry" t
    WHERE t."projectId" = p_project_id AND t."companyId" = p_company_id AND t."status" = 'Posted'
    GROUP BY t."projectElementId"
  )
  SELECT e."id",
    COALESCE(pm.v, 0), COALESCE(pl.v, 0), COALESCE(po.v, 0),
    COALESCE(c.v, 0), COALESCE(a.v, 0), COALESCE(h.v, 0)
  FROM elements e
  LEFT JOIN plan_material pm ON pm."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_labor pl ON pl."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_other po ON po."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN commitments c ON c."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN actuals a ON a."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN hours h ON h."projectElementId" IS NOT DISTINCT FROM e."id";
$$;

-- Mirror of resolveProjectPostingAccount in packages/server-functions/src/lib/project-posting.ts.
-- Returns NULL for a Statistical project (the caller keeps its natural account).
CREATE OR REPLACE FUNCTION project_posting_account(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
  v_account TEXT;
  v_project RECORD;
  v_defaults RECORD;
BEGIN
  SELECT "costTreatment", "costAccountId" INTO v_project
  FROM "project" WHERE "id" = p_project_id AND "companyId" = p_company_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- nearest element (self, then ancestors) with a treatment effective on the date
  WITH RECURSIVE chain AS (
    SELECT e."id", e."parentId", e."costTreatment", e."costTreatmentEffectiveFrom", e."costAccountId", 0 AS depth
    FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
    UNION ALL
    SELECT p."id", p."parentId", p."costTreatment", p."costTreatmentEffectiveFrom", p."costAccountId", c.depth + 1
    FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
  )
  SELECT c."costTreatment", c."costAccountId" INTO v_treatment, v_account
  FROM chain c
  WHERE c."costTreatment" IS NOT NULL
    AND (c."costTreatmentEffectiveFrom" IS NULL OR c."costTreatmentEffectiveFrom" <= p_posting_date)
  ORDER BY c.depth LIMIT 1;

  IF v_treatment IS NULL THEN
    v_treatment := v_project."costTreatment";
    v_account := v_project."costAccountId";
  END IF;

  IF v_treatment = 'Statistical' THEN RETURN NULL; END IF;
  IF v_account IS NOT NULL THEN RETURN v_account; END IF;

  SELECT "projectExpenseAccount", "projectWorkInProgressAccount" INTO v_defaults
  FROM "accountDefault" WHERE "companyId" = p_company_id;
  IF v_treatment = 'Expense' THEN RETURN v_defaults."projectExpenseAccount"; END IF;
  IF v_treatment = 'Contract' THEN RETURN v_defaults."projectWorkInProgressAccount"; END IF;
  RAISE EXCEPTION 'Cost treatment % is not available yet', v_treatment;
END;
$$;

NOTIFY pgrst, 'reload schema';
