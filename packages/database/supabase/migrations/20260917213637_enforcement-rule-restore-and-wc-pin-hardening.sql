-- Two hardenings from the sales-rules self-review.

-- 1. Old backups must keep restoring. The storageRule* tables were dropped and
--    their rows moved into "enforcementRule" (20260817143512); TABLE_RENAMES in
--    @carbon/jobs maps the old backup table names onto the new ones. A backup
--    row from before the merge has no "family" column, so the merged table
--    needs a default for the restore load to fill — and 'storage' is by
--    definition what every pre-merge row was. App code always sets the column
--    explicitly; the default exists only for this load path.
ALTER TABLE "enforcementRule" ALTER COLUMN "family" SET DEFAULT 'storage';

-- 2. Work-center pins may only point at a workCenter-target storage rule.
--    The item-pin policies already resolve the pinned rule's family through an
--    EXISTS; the work-center policies did not, so a resources_create holder
--    could pin a sales rule (or an item-target storage rule) to a work center
--    through PostgREST — an orphan row the evaluator ignores, but a lie in the
--    admin UI's counts. The correlation is qualified by table name on purpose:
--    an unqualified "companyId" binds to the inner rule table and turns the
--    tenant check into a tautology.
DROP POLICY "INSERT" ON "public"."enforcementRuleWorkCenterAssignment";
CREATE POLICY "INSERT" ON "public"."enforcementRuleWorkCenterAssignment"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "enforcementRule" r
    WHERE r."id" = "ruleId"
      AND r."companyId" = "enforcementRuleWorkCenterAssignment"."companyId"
      AND r."family" = 'storage'
      AND r."targetType" = 'workCenter'
      AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
  )
);

DROP POLICY "UPDATE" ON "public"."enforcementRuleWorkCenterAssignment";
CREATE POLICY "UPDATE" ON "public"."enforcementRuleWorkCenterAssignment"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "enforcementRule" r
    WHERE r."id" = "ruleId"
      AND r."companyId" = "enforcementRuleWorkCenterAssignment"."companyId"
      AND r."family" = 'storage'
      AND r."targetType" = 'workCenter'
      AND r."companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
  )
);
