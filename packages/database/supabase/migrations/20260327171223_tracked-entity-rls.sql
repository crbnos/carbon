CREATE POLICY "UPDATE" ON "public"."trackedEntity"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."trackedEntity"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."trackedActivity"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."trackedActivity"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."trackedActivityInput"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."trackedActivityInput"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."trackedActivityOutput"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."trackedActivityOutput"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);
