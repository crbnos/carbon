-- NIST 800-171 3.1.5: remove the "0" global-company permission wildcard.
-- Expand-then-drop: rewrite any residual "0" grant to explicit companies
-- BEFORE the functions stop interpreting "0", so no one is locked out.

-- 1a. userPermission.permissions (JSONB: "<module>_<action>" -> [companyId,...])
--     Replace "0" in any array with the user's userToCompany companies (any role).
DO $$
DECLARE
  r RECORD;
  new_perms jsonb;
  k text;
  arr jsonb;
  companies text[];
BEGIN
  FOR r IN
    SELECT id, permissions FROM public."userPermission"
    WHERE permissions::text LIKE '%"0"%'
  LOOP
    SELECT COALESCE(array_agg("companyId"::text), '{}')
    INTO companies
    FROM public."userToCompany" WHERE "userId" = r.id;

    new_perms := r.permissions;
    FOR k IN SELECT jsonb_object_keys(r.permissions) LOOP
      arr := r.permissions -> k;
      IF jsonb_typeof(arr) = 'array' AND (arr ? '0') THEN
        new_perms := jsonb_set(
          new_perms,
          ARRAY[k],
          (
            SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
            FROM (
              SELECT e AS elem FROM jsonb_array_elements_text(arr) e WHERE e <> '0'
              UNION
              SELECT unnest(companies) AS elem
            ) s
          )
        );
      END IF;
    END LOOP;

    UPDATE public."userPermission" SET permissions = new_perms WHERE id = r.id;
  END LOOP;
END $$;

-- 1b. employeeTypePermission (TEXT[] columns): "0" -> the employee type's company.
UPDATE public."employeeTypePermission" etp
SET
  "create" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."create", '0', et."companyId")) c),
  "update" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."update", '0', et."companyId")) c),
  "view"   = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."view",   '0', et."companyId")) c),
  "delete" = (SELECT array_agg(DISTINCT c) FROM unnest(array_replace(etp."delete", '0', et."companyId")) c)
FROM public."employeeType" et
WHERE et.id = etp."employeeTypeId"
  AND ('0' = ANY(etp."create") OR '0' = ANY(etp."update") OR '0' = ANY(etp."view") OR '0' = ANY(etp."delete"));

-- 2. Redefine has_company_permission WITHOUT the "0" wildcard branch.
--    (fork of 20241210140215; attributes preserved exactly.)
CREATE OR REPLACE FUNCTION has_company_permission(claim text, company text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      permission_value text[];
    BEGIN
      SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]'))
      INTO permission_value
      FROM public."userPermission" WHERE id = (SELECT auth.uid()::text);
      IF permission_value IS NULL THEN
        return false;
      ELSIF company = ANY(permission_value::text[]) THEN
        return true;
      ELSE
        return false;
      END IF;
    END;
$$;

-- 3. Redefine get_companies_with_employee_permission WITHOUT the "0" expand block.
--    (fork of 20260219162954; attributes preserved exactly.)
CREATE OR REPLACE FUNCTION get_companies_with_employee_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
  api_key_scopes JSONB;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    api_key_scopes := get_api_key_scopes();
    IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
      RETURN '{}';
    END IF;
    IF (api_key_scopes ? permission)
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    ELSE
      RETURN '{}';
    END IF;
  END IF;

  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
  INTO permission_companies
  FROM public."userPermission"
  WHERE id::text = auth.uid()::text;

  IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(employee_companies);
  ELSE
    permission_companies := '{}';
  END IF;

  RETURN permission_companies;
END;
$$;

-- 4. Re-sign is_claims_admin per-company (drop the no-arg global-admin version).
DROP FUNCTION IF EXISTS is_claims_admin();
CREATE OR REPLACE FUNCTION is_claims_admin(company text) RETURNS "bool"
  LANGUAGE "plpgsql"
  AS $$
  BEGIN
    IF session_user = 'authenticator' THEN
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF;
      IF has_company_permission('update_users', company) THEN
        return true;
      ELSE
        return false;
      END IF;
    ELSE -- not a user session (trigger etc.)
      return true;
    END IF;
  END;
$$;

-- 5. Reload PostgREST so the new is_claims_admin(text) signature is exposed.
NOTIFY pgrst, 'reload schema';
