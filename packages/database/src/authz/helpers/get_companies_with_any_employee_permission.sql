CREATE OR REPLACE FUNCTION public.get_companies_with_any_employee_permission(permissions text[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  api_key_id text;
  api_key_company text;
  companies text[];
BEGIN
  -- The companies where the caller holds at least one of the '<page>_<action>'
  -- keys: an API key in its own company, by the key's grants; a user in each
  -- company where they are an employee, by theirs.
  SELECT k.id, k.company_id INTO api_key_id, api_key_company FROM util.request_api_key() k;

  WITH wanted AS (
    SELECT
      m[1] AS page,
      (CASE m[2]
        WHEN 'view' THEN 'View'
        WHEN 'create' THEN 'Create'
        WHEN 'update' THEN 'Edit'
        ELSE 'Full'
      END)::"permissionLevel" AS needed
    FROM unnest(permissions) AS k(key),
      LATERAL regexp_match(k.key, '^(.*)_(view|create|update|delete)$') AS m
    WHERE m IS NOT NULL
  )
  SELECT array_agg(c.id)
  INTO companies
  FROM (
    SELECT api_key_company AS id, NULL::text AS "user"
    WHERE api_key_company IS NOT NULL
    UNION ALL
    SELECT utc."companyId", utc."userId"
    FROM "userToCompany" utc
    WHERE api_key_company IS NULL
      AND utc."userId" = auth.uid()::text
      AND utc."role" = 'employee'
  ) c
  WHERE EXISTS (
    SELECT 1 FROM wanted w
    WHERE util.access_level(
      c."user",
      CASE WHEN c."user" IS NULL THEN api_key_id END,
      c.id,
      w.page
    ) >= w.needed
  );

  RETURN COALESCE(companies, '{}');
END;
$function$;
