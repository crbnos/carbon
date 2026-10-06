-- Reassert composite tenant correlation for child Impact SELECT policies in the
-- already-applied development migration state. The parent decision identity is
-- (id, companyId), so source authorization must use both columns.

DROP POLICY IF EXISTS "SELECT" ON "public"."changeOrderImpactDecisionAffectedItem";
CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    WHERE d."id" = "changeOrderImpactDecisionAffectedItem"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionAffectedItem"."companyId"
      AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
      AND (
        (d."targetType" = 'purchaseOrderLine'
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
        OR
        (d."targetType" IN ('job', 'jobMaterial')
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
      )
  )
);

DROP POLICY IF EXISTS "SELECT" ON "public"."changeOrderImpactDecisionHistory";
CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionHistory"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    WHERE d."id" = "changeOrderImpactDecisionHistory"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionHistory"."companyId"
      AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
      AND (
        (d."targetType" = 'purchaseOrderLine'
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
        OR
        (d."targetType" IN ('job', 'jobMaterial')
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
      )
  )
);

NOTIFY pgrst, 'reload schema';
