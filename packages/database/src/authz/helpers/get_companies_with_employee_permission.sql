CREATE OR REPLACE FUNCTION public.get_companies_with_employee_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  RETURN COALESCE(permission_companies, '{}');
END;
$function$;
