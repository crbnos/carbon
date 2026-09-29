CREATE OR REPLACE FUNCTION public.get_supplier_ids_with_supplier_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permission_companies text[];
  supplier_company_ids text[];
  supplier_ids text[];
BEGIN
  -- Get companies where user is a supplier
  SELECT array_agg("companyId"::text)
  INTO supplier_company_ids
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'supplier';

  -- Get companies from user permissions
  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]')) 
  INTO permission_companies 
  FROM public."userPermission" up
  WHERE up.id::text = auth.uid()::text;

  -- Filter permission_companies to only include companies where user is supplier
  IF permission_companies IS NOT NULL AND supplier_company_ids IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(supplier_company_ids);
  ELSE
    permission_companies := '{}';
  END IF;

  -- Get supplier IDs where company matches filtered permissions
  SELECT array_agg(c.id::text)
  INTO supplier_ids
  FROM "supplier" c
  WHERE c."companyId" = ANY(permission_companies);

  -- Get supplier IDs from supplier accounts
  SELECT array_agg(ca."supplierId"::text)
  INTO supplier_ids
  FROM "supplierAccount" ca
  WHERE ca.id::uuid = auth.uid() AND ca."companyId" = ANY(supplier_company_ids);

  RETURN supplier_ids;
END;
$function$;
