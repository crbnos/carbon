DROP POLICY IF EXISTS "Certain employees can insert into the parts ledger" ON "public"."itemLedger";
DROP POLICY IF EXISTS "Certain employees can view the parts ledger" ON "public"."itemLedger";
DROP POLICY IF EXISTS "Requests with an API key can insert into item ledger" ON "public"."itemLedger";
DROP POLICY IF EXISTS "Requests with an API key can view item ledger" ON "public"."itemLedger";

CREATE POLICY "INSERT" ON "public"."itemLedger"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_create'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('accounting_create'))
      ))
    )
);

CREATE POLICY "SELECT" ON "public"."itemLedger"
FOR SELECT USING (
  "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_view'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('accounting_view'))
      ))
    )
);


DROP POLICY IF EXISTS "Employees with parts can insert part planning" ON "public"."itemPlanning";
DROP POLICY IF EXISTS "Employees with parts can view part planning" ON "public"."itemPlanning";
DROP POLICY IF EXISTS "Employees with parts_update can update part planning" ON "public"."itemPlanning";
DROP POLICY IF EXISTS "Requests with an API key can access item planning" ON "public"."itemPlanning";

CREATE POLICY "INSERT" ON "public"."itemPlanning"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_create'))
    ))
  )
);

CREATE POLICY "SELECT" ON "public"."itemPlanning"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_view'))
    ))
  )
);

CREATE POLICY "UPDATE" ON "public"."itemPlanning"
FOR UPDATE USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_employee_permission('parts_update'))
    ))
  )
);

