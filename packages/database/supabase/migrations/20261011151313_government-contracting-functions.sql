-- Government contracting Phase 5a: SQL functions.
--
-- 1. get_project_cost_summary gains "actualUnallowable": the project ledger
--    cost with unallowable = true, per element. Forked from
--    20261010161720_project-commitments-pegs.sql, the newest definition. The
--    return type changes, so the function is dropped first.
-- 2. get_missing_timesheet_days lists the scheduled work days that have no
--    timesheet entry. The daily missing-time check and the missing-time report
--    read it.
--
-- CURRENT_DATE below is the database's UTC day. It only picks a labor rate for a
-- plan estimate, never a posting, so the UTC day is acceptable here. Do not copy
-- it into a posting path.

DROP FUNCTION IF EXISTS get_project_cost_summary(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_project_cost_summary(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE (
  "projectElementId" TEXT,
  "planMaterial" NUMERIC,
  "planLabor" NUMERIC,
  "planOther" NUMERIC,
  "committed" NUMERIC,
  "actual" NUMERIC,
  "actualHours" NUMERIC,
  "actualUnallowable" NUMERIC
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
  -- Projects Phase 3: the project's share of open grouped supply. Each current
  -- Soft or Manual peg on a PO line made for a planning group commits the
  -- pegged quantity at the line's unit price. The peg is in inventory units
  -- and the price is per purchase unit, so the quantity is divided by the
  -- line's conversion factor. A peg with no element goes to the project root.
  peg_commitments AS (
    SELECT pp."projectElementId",
      SUM(pp."quantity" / COALESCE(NULLIF(pol."conversionFactor", 0), 1) * COALESCE(pol."unitPrice", 0)) AS v
    FROM "projectPeg" pp
    JOIN "purchaseOrderLine" pol
      ON pol."id" = pp."supplyId" AND pol."companyId" = pp."companyId"
    JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId"
    WHERE pp."projectId" = p_project_id AND pp."companyId" = p_company_id
      AND pp."supplyType" = 'Purchase Order Line'
      AND pp."state" IN ('Soft', 'Manual')
      AND pp."supersededAt" IS NULL
      AND po."status" IN ('To Receive', 'To Receive and Invoice', 'To Invoice', 'Planned')
    GROUP BY pp."projectElementId"
  ),
  actuals AS (
    SELECT pl."projectElementId", SUM(pl."amount") AS v
    FROM "projectLedger" pl
    WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id
    GROUP BY pl."projectElementId"
  ),
  -- Government contracting Phase 5a: the cost a posting function flagged
  -- unallowable (FAR 31.201-6), shown in its own column.
  unallowable_actuals AS (
    SELECT pl."projectElementId", SUM(pl."amount") AS v
    FROM "projectLedger" pl
    WHERE pl."projectId" = p_project_id AND pl."companyId" = p_company_id AND pl."unallowable"
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
    COALESCE(c.v, 0) + COALESCE(pc.v, 0), COALESCE(a.v, 0), COALESCE(h.v, 0),
    COALESCE(ua.v, 0)
  FROM elements e
  LEFT JOIN plan_material pm ON pm."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_labor pl ON pl."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN plan_other po ON po."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN commitments c ON c."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN peg_commitments pc ON pc."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN actuals a ON a."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN hours h ON h."projectElementId" IS NOT DISTINCT FROM e."id"
  LEFT JOIN unallowable_actuals ua ON ua."projectElementId" IS NOT DISTINCT FROM e."id";
$$;

CREATE OR REPLACE FUNCTION get_missing_timesheet_days(p_company_id TEXT, p_from DATE, p_to DATE)
RETURNS TABLE ("employeeId" TEXT, "date" DATE, "managerId" TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT es."employeeId", d::date, ej."managerId"
  FROM generate_series(p_from, p_to, interval '1 day') AS d
  JOIN "employeeShift" es ON es."companyId" = p_company_id
  JOIN "shift" s ON s."id" = es."shiftId" AND s."active"
  JOIN "employee" e ON e."id" = es."employeeId" AND e."companyId" = p_company_id AND e."active"
  LEFT JOIN "employeeJob" ej ON ej."id" = es."employeeId" AND ej."companyId" = p_company_id
  WHERE CASE EXTRACT(ISODOW FROM d)
          WHEN 1 THEN s."monday" WHEN 2 THEN s."tuesday" WHEN 3 THEN s."wednesday"
          WHEN 4 THEN s."thursday" WHEN 5 THEN s."friday" WHEN 6 THEN s."saturday"
          ELSE s."sunday" END
    AND NOT EXISTS (SELECT 1 FROM "holiday" h WHERE h."companyId" = p_company_id AND h."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "peopleAbsence" a
                    WHERE a."companyId" = p_company_id AND a."employeeId" = es."employeeId" AND a."date" = d::date)
    AND NOT EXISTS (SELECT 1 FROM "timesheetEntry" t
                    WHERE t."companyId" = p_company_id AND t."employeeId" = es."employeeId" AND t."entryDate" = d::date)
$$;

NOTIFY pgrst, 'reload schema';
