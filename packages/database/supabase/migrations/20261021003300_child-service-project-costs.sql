-- Field Service Phase D: the contract project roll-up.
-- Spec: .ai/specs/2026-10-08-field-service.md (Contract project)
--
-- One row per service order whose Service project names p_project_id as its
-- parent (project."parentProjectId", set from the order's coverage contract).
-- The contract project's Costs tab and the contract page read it.
--
-- A separate function, so get_project_cost_summary stays as Projects Phase 1a
-- and Phase 3 define it. The parent index is project_parentProjectId_idx
-- (Phase A). plpgsql, so the ORDER BY reaches PostgREST (LANGUAGE sql functions
-- can be inlined and lose it).
CREATE OR REPLACE FUNCTION get_child_service_project_costs(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE (
  "projectId" TEXT,
  "serviceOrderId" TEXT,
  "serviceOrderReadableId" TEXT,
  "status" "serviceOrderStatus",
  "customerAssetId" TEXT,
  "actual" NUMERIC,
  "actualHours" NUMERIC,
  "billed" NUMERIC,
  "unbilled" NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_access(p_company_id);
  RETURN QUERY
  SELECT p."id", so."id", so."serviceOrderId", so."status", so."customerAssetId",
    COALESCE((SELECT SUM(l."amount") FROM "projectLedger" l
              WHERE l."projectId" = p."id" AND l."companyId" = p."companyId"), 0),
    COALESCE((SELECT SUM(t."hours") FROM "timesheetEntry" t
              WHERE t."projectId" = p."id" AND t."companyId" = p."companyId" AND t."status" = 'Posted'), 0),
    COALESCE((SELECT SUM(b."amount") FROM "projectBillableItem" b
              WHERE b."projectId" = p."id" AND b."companyId" = p."companyId" AND b."status" = 'Billed'), 0),
    COALESCE((SELECT SUM(b."amount") FROM "projectBillableItem" b
              WHERE b."projectId" = p."id" AND b."companyId" = p."companyId" AND b."status" = 'Unbilled'), 0)
  FROM "project" p
  JOIN "serviceOrder" so ON so."projectId" = p."id" AND so."companyId" = p."companyId"
  WHERE p."parentProjectId" = p_project_id AND p."companyId" = p_company_id
    AND p."projectType" = 'Service'
  ORDER BY so."serviceOrderId";
END $$;

NOTIFY pgrst, 'reload schema';
