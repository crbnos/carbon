CREATE OR REPLACE FUNCTION public.get_companies_with_employee_role()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  RETURN COALESCE(user_companies, '{}');
END;
$function$;
