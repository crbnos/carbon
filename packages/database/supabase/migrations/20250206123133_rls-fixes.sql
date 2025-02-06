DROP POLICY IF EXISTS "Employees can view no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_create can insert no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_delete can delete no quote reasons" ON "public"."noQuoteReason";
DROP POLICY IF EXISTS "Employees with sales_update can update no quote reasons" ON "public"."noQuoteReason";

CREATE POLICY "SELECT" ON "public"."noQuoteReason"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."noQuoteReason"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."noQuoteReason"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."noQuoteReason"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_delete')
    )::text[]
  )
);