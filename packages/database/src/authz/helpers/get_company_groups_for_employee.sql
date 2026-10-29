CREATE OR REPLACE FUNCTION public.get_company_groups_for_employee()
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  employee_companies text[];
  group_ids text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    SELECT ARRAY["companyGroupId"::text]
    INTO group_ids
    FROM "company"
    WHERE "id" = api_key_company
      AND "companyGroupId" IS NOT NULL;
    RETURN COALESCE(group_ids, '{}');
  END IF;

  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  IF employee_companies IS NULL THEN
    RETURN '{}';
  END IF;

  SELECT array_agg(DISTINCT "companyGroupId"::text)
  INTO group_ids
  FROM "company"
  WHERE "id" = ANY(employee_companies)
    AND "companyGroupId" IS NOT NULL;

  RETURN COALESCE(group_ids, '{}');
END;
$function$;
