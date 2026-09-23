-- Harden the Slice 0 relationship boundary without changing ordinary task
-- source authorization. taskOrigin is a lifecycle marker, so direct user-scoped
-- PostgREST writes must not be able to designate or convert a task. Trusted
-- server/Kysely paths remain able to set it for later lifecycle work.

CREATE OR REPLACE FUNCTION prevent_change_order_action_task_origin_direct_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW."taskOrigin" <> 'Manual' THEN
      RAISE EXCEPTION 'taskOrigin can only be assigned by the Change Notice application service';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."taskOrigin" IS DISTINCT FROM OLD."taskOrigin" THEN
      RAISE EXCEPTION 'taskOrigin can only be changed by the Change Notice application service';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "changeOrderActionTask_taskOrigin_guard"
  ON "changeOrderActionTask";
CREATE TRIGGER "changeOrderActionTask_taskOrigin_guard"
  BEFORE INSERT OR UPDATE OF "taskOrigin" ON "changeOrderActionTask"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_change_order_action_task_origin_direct_mutation();

-- The link table's current task FK protects task existence. Its relationship
-- metadata is server-owned; the application service checks company and Change
-- Notice ownership inside its later transaction.
DROP POLICY IF EXISTS "SELECT" ON "public"."changeOrderImpactDecisionActionTask";
DROP POLICY IF EXISTS "INSERT" ON "public"."changeOrderImpactDecisionActionTask";
DROP POLICY IF EXISTS "UPDATE" ON "public"."changeOrderImpactDecisionActionTask";
DROP POLICY IF EXISTS "DELETE" ON "public"."changeOrderImpactDecisionActionTask";

CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionActionTask"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    JOIN "changeOrderActionTask" t
      ON t."changeOrderId" = d."changeNoticeId"
     AND t."companyId" = d."companyId"
    WHERE d."id" = "changeOrderImpactDecisionActionTask"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionActionTask"."companyId"
      AND t."id" = "changeOrderImpactDecisionActionTask"."actionTaskId"
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

CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionActionTask"
FOR INSERT WITH CHECK (false);

CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionActionTask"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionActionTask"
FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
