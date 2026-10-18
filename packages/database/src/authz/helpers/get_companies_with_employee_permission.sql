CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  parts text[];
  target_page text;
  needed_level "permissionLevel";
  raw_key text;
  api_key_id text;
  api_key_company text;
  companies text[];
BEGIN
  -- '<page>_<action>': the page's level must reach the action's level.
  parts := regexp_match(permission, '^(.*)_(view|create|update|delete)$');
  IF parts IS NULL THEN
    RETURN '{}';
  END IF;
  target_page := parts[1];
  needed_level := CASE parts[2]
    WHEN 'view' THEN 'View'
    WHEN 'create' THEN 'Create'
    WHEN 'update' THEN 'Edit'
    ELSE 'Full'
  END::"permissionLevel";

  raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
  IF raw_key IS NOT NULL THEN
    SELECT id, "companyId" INTO api_key_id, api_key_company
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    IF api_key_company IS NOT NULL THEN
      IF util.access_level(NULL, api_key_id, api_key_company, target_page) >= needed_level THEN
        RETURN ARRAY[api_key_company];
      END IF;
      RETURN '{}';
    END IF;
  END IF;

  SELECT array_agg(utc."companyId"::text)
  INTO companies
  FROM "userToCompany" utc
  WHERE utc."userId" = auth.uid()::text
    AND utc."role" = 'employee'
    AND util.access_level(utc."userId", NULL, utc."companyId", target_page) >= needed_level;

  RETURN COALESCE(companies, '{}');
END;
$function$;
