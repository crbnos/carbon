CREATE
OR REPLACE FUNCTION get_companies_with_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  -- If API key exists for a company, add it to results
  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  -- Get companies from user permissions
  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]')) 
  INTO permission_companies 
  FROM public."userPermission" 
  WHERE id::text = auth.uid()::text;

  -- Handle special case where user has global permission ('0')
  IF permission_companies IS NOT NULL AND '0'::text = ANY(permission_companies) THEN
    SELECT array_agg(id::text) INTO permission_companies FROM company;
  END IF;

  RETURN permission_companies;
END;
$$;