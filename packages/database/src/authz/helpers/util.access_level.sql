CREATE OR REPLACE FUNCTION util.access_level(p_user text, p_api_key text, p_company text, p_page text)
 RETURNS "permissionLevel"
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The level of one user or one API key on one page in one company. In util, not
  -- public, so the API cannot ask about anyone else; the TS twin is resolveLevel
  -- (packages/database/src/access/resolve.ts), and both pass access/cases.json.
  -- Callers check that the user is an employee of the company.
  SELECT CASE
    WHEN p_user IS NOT NULL AND EXISTS (
      SELECT 1
      FROM employee e
      JOIN "employeeType" et ON et.id = e."employeeTypeId"
      WHERE e.id = p_user AND e."companyId" = p_company AND et."systemType" = 'Admin'
    ) THEN 'Full'::"permissionLevel"
    ELSE COALESCE((
      SELECT p.level
      FROM permission p
      WHERE p."companyId" = p_company
        AND lower(p.module::text) = split_part(p_page, '.', 1)
        AND (p.page IS NULL OR p.page = p_page)
        AND (
          (p_user IS NOT NULL AND p."userId" = p_user)
          OR (p_user IS NOT NULL AND p."employeeTypeId" = (
            SELECT e."employeeTypeId" FROM employee e
            WHERE e.id = p_user AND e."companyId" = p_company
          ))
          OR (p_api_key IS NOT NULL AND p."apiKeyId" = p_api_key)
        )
      -- person page, person module, role page, role module, key page, key module
      ORDER BY
        CASE WHEN p."userId" IS NOT NULL THEN 0 WHEN p."employeeTypeId" IS NOT NULL THEN 1 ELSE 2 END,
        p.page IS NULL
      LIMIT 1
    ), 'None'::"permissionLevel")
  END
$function$;
