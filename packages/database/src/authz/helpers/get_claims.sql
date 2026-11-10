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
    -- Your own claims, or those of someone in a company where you may view
    -- Accounts (the permission editor reads them).
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text
       AND NOT EXISTS (
         SELECT 1 FROM "userToCompany" utc
         WHERE utc."userId" = uid
           AND utc."companyId" = ANY (get_companies_with_employee_permission('users.accounts_view'))
       ) THEN
      RAISE EXCEPTION 'Not authorized to read claims for this user'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT role INTO company_role FROM "userToCompany" WHERE "userId" = uid AND "companyId" = company;

    IF company_role = 'employee' THEN
      SELECT e."employeeTypeId" INTO employee_type
      FROM employee e
      WHERE e.id = uid AND e."companyId" = company;
      -- The Admin type: the only level on no page (util.access_level).
      is_admin := util.access_level(uid, NULL, company, NULL) = 'Full';

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

      -- TRANSITIONAL(#1958): the old claims keys, "<module>_<action>": [company],
      -- from the level on the module id as a page (its module grants; Admin is
      -- Full), so app pods from before page permissions keep working on a
      -- migrated database during a rolling deploy. Current code ignores them.
      -- Removal: packages/database/AGENTS.md, "Page permissions transition".
      SELECT COALESCE(jsonb_object_agg(lower(m.module::text) || '_' || a.action, jsonb_build_array(company)), '{}'::jsonb)
      INTO legacy_keys
      FROM unnest(enum_range(NULL::"module")) AS m(module)
      JOIN util.action_levels() AS a ON util.access_level(uid, NULL, company, lower(m.module::text)) >= a.level;
    END IF;

    -- A portal account still holds its keys in userPermission. An employee's old
    -- keys are left out, so a None override is never undone by them.
    IF company_role IN ('customer', 'supplier') THEN
      SELECT COALESCE(jsonb_object_agg(kv.key, jsonb_build_array(company)), '{}'::jsonb)
      INTO portal_keys
      FROM "userPermission" up, jsonb_each(up.permissions) kv
      WHERE up.id = uid AND jsonb_typeof(kv.value) = 'array' AND kv.value ? company;
      legacy_keys := portal_keys; -- TRANSITIONAL(#1958), as above
    END IF;

    RETURN legacy_keys || jsonb_build_object(
      'role', company_role,
      'admin', COALESCE(is_admin, false),
      'grants', grant_rows,
      'portal', portal_keys
    );
  END;
$function$;
