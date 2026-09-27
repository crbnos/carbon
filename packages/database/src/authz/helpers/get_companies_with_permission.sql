CREATE OR REPLACE FUNCTION public.get_companies_with_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permission_companies text[];
  api_key_company text;
  api_key_scopes jsonb;
BEGIN
  -- Deprecated: prefer get_companies_with_employee_permission. Unlike it, this also admits
  -- customer and supplier (portal) members, which the portal's document access relies on.

  -- An API key holds only the permissions its scopes grant, in its own company.
  api_key_company := get_company_id_from_api_key();
  IF api_key_company IS NOT NULL THEN
    api_key_scopes := get_api_key_scopes();
    IF api_key_scopes ? permission
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    END IF;
    RETURN '{}';
  END IF;

  -- A user holds a permission only in companies they belong to. There is no '0' wildcard:
  -- it used to expand to every company on the instance.
  SELECT array_agg(company)
  INTO permission_companies
  FROM public."userPermission" up,
       unnest(jsonb_to_text_array(COALESCE(up.permissions->permission, '[]'))) company
  WHERE up.id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM "userToCompany" utc
      WHERE utc."userId" = auth.uid()::text AND utc."companyId" = company
    );

  RETURN COALESCE(permission_companies, '{}');
END;
$function$;
