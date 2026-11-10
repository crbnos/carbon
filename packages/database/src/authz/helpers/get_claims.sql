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
  DECLARE legacy_keys jsonb := '{}'::jsonb;
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
      -- Only the company's own type: another company's Admin type is not Admin here.
      LEFT JOIN "employeeType" et ON et.id = e."employeeTypeId" AND et."companyId" = e."companyId"
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

      -- TRANSITIONAL: the old claims keys, "<module>_<action>": [company], from
      -- the effective MODULE grants (person beats role; Admin holds every
      -- action), so app pods from before page permissions keep working on a
      -- migrated database during a rolling deploy. Current code reads only
      -- role/admin/grants/portal and ignores these. Remove once no deployed app
      -- version predates page permissions (PR #1958).
      SELECT COALESCE(jsonb_object_agg(lower(m.module::text) || '_' || a.action, jsonb_build_array(company)), '{}'::jsonb)
      INTO legacy_keys
      FROM unnest(enum_range(NULL::"module")) AS m(module)
      CROSS JOIN LATERAL (
        SELECT CASE WHEN COALESCE(is_admin, false) THEN 'Full'::"permissionLevel" ELSE (
          SELECT p.level FROM permission p
          WHERE p."companyId" = company AND p.module = m.module AND p.page IS NULL
            AND (p."userId" = uid OR (employee_type IS NOT NULL AND p."employeeTypeId" = employee_type))
          ORDER BY p."userId" IS NULL
          LIMIT 1
        ) END AS level
      ) l
      JOIN (VALUES ('view', 'View'::"permissionLevel"), ('create', 'Create'), ('update', 'Edit'), ('delete', 'Full'))
        AS a(action, needs) ON l.level >= a.needs;
    END IF;

    -- A portal account still holds its keys in userPermission. An employee's old
    -- keys are left out, so a None override is never undone by them.
    IF company_role IN ('customer', 'supplier') THEN
      SELECT COALESCE(jsonb_object_agg(kv.key, jsonb_build_array(company)), '{}'::jsonb)
      INTO portal_keys
      FROM "userPermission" up, jsonb_each(up.permissions) kv
      WHERE up.id = uid AND jsonb_typeof(kv.value) = 'array' AND kv.value ? company;
      legacy_keys := portal_keys; -- TRANSITIONAL, as above
    END IF;

    RETURN legacy_keys || jsonb_build_object(
      'role', company_role,
      'admin', COALESCE(is_admin, false),
      'grants', grant_rows,
      'portal', portal_keys
    );
  END;
$function$;
