CREATE OR REPLACE FUNCTION public.get_claims(uid text, company text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE company_role text;
  DECLARE employee_type text;
  DECLARE is_admin boolean := false;
  DECLARE grant_rows jsonb := '[]'::jsonb;
  DECLARE portal_keys jsonb := '{}'::jsonb;
  BEGIN
    -- Your own claims, or those of someone in a company where you may view or
    -- edit Accounts (the permission editor reads them with Accounts Edit).
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text
       AND NOT EXISTS (
         SELECT 1 FROM "userToCompany" utc
         WHERE utc."userId" = uid
           AND utc."companyId" = ANY (
             get_companies_with_employee_permission('users.accounts_view')
             || get_companies_with_employee_permission('users.accounts_update')
           )
       ) THEN
      RAISE EXCEPTION 'Not authorized to read claims for this user'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT role INTO company_role FROM "userToCompany" WHERE "userId" = uid AND "companyId" = company;

    IF company_role = 'employee' THEN
      SELECT e."employeeTypeId", COALESCE(et."systemType" = 'Admin', false)
      INTO employee_type, is_admin
      FROM employee e
      LEFT JOIN "employeeType" et ON et.id = e."employeeTypeId"
      WHERE e.id = uid AND e."companyId" = company;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'subject', CASE WHEN p."userId" IS NOT NULL THEN 'person' ELSE 'role' END,
          'module', p.module,
          'page', p.page,
          'level', p.level
        ) ORDER BY p."userId" IS NULL, p.module, p.page NULLS FIRST), '[]'::jsonb)
      INTO grant_rows
      FROM permission p
      WHERE p."companyId" = company
        AND (p."userId" = uid OR (employee_type IS NOT NULL AND p."employeeTypeId" = employee_type));
    END IF;

    -- A portal account still holds its keys in userPermission. An employee's old
    -- keys are left out, so a None override is never undone by them.
    IF company_role IN ('customer', 'supplier') THEN
      SELECT COALESCE(jsonb_object_agg(kv.key, jsonb_build_array(company)), '{}'::jsonb)
      INTO portal_keys
      FROM "userPermission" up, jsonb_each(up.permissions) kv
      WHERE up.id = uid AND jsonb_typeof(kv.value) = 'array' AND kv.value ? company;
    END IF;

    RETURN jsonb_build_object(
      'role', company_role,
      'admin', COALESCE(is_admin, false),
      'grants', grant_rows,
      'portal', portal_keys
    );
  END;
$function$;
