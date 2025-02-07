DROP POLICY IF EXISTS "Employees can view job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_delete can delete job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_update can update job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Employees with production_view can view job operation tools" ON "public"."jobOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access job operation tools" ON "public"."jobOperationTool";

CREATE POLICY "SELECT" ON "public"."jobOperationTool"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationTool"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationTool"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationTool"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('production_delete')
    )::text[]
  )
);



DROP POLICY IF EXISTS "Employees with sales_create can create quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_delete can delete quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_update can update quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Employees with sales_view can view quote operation tools" ON "public"."quoteOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access quote operation tools" ON "public"."quoteOperationTool";


CREATE POLICY "SELECT" ON "public"."quoteOperationTool"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteOperationTool"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteOperationTool"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteOperationTool"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('sales_delete')
    )::text[]
  )
);

DROP POLICY IF EXISTS "Employees with parts_create can create method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_delete can delete method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_update can update method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Employees with parts_view can view method operation tools" ON "public"."methodOperationTool";
DROP POLICY IF EXISTS "Requests with an API key can access method operation tools" ON "public"."methodOperationTool";

CREATE POLICY "SELECT" ON "public"."methodOperationTool"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodOperationTool"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodOperationTool"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodOperationTool"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);

