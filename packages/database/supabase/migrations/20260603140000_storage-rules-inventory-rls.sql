-- Storage Rules admin lives in the Inventory module. Move the `storageRule`
-- RLS off settings_* onto inventory_*.
--
-- SELECT is widened to any company employee (mirrors the assignment tables) so
-- the per-item / per-work-center assignment drawers in other modules can still
-- read rule metadata regardless of the reader's module permissions. Mutations
-- require inventory_*, matching the relocated admin pages.

DROP POLICY IF EXISTS "SELECT" ON "public"."storageRule";
DROP POLICY IF EXISTS "INSERT" ON "public"."storageRule";
DROP POLICY IF EXISTS "UPDATE" ON "public"."storageRule";
DROP POLICY IF EXISTS "DELETE" ON "public"."storageRule";

CREATE POLICY "SELECT" ON "public"."storageRule"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."storageRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."storageRule"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."storageRule"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);
