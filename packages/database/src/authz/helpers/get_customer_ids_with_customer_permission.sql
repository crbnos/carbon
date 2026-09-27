CREATE OR REPLACE FUNCTION public.get_customer_ids_with_customer_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permission_companies text[];
  customer_company_ids text[];
  customer_ids text[];
BEGIN
  -- Get companies where user is a customer
  SELECT array_agg("companyId"::text)
  INTO customer_company_ids
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'customer';

  -- Get companies from user permissions
  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]')) 
  INTO permission_companies 
  FROM public."userPermission" up
  WHERE up.id::text = auth.uid()::text;

  -- Filter permission_companies to only include companies where user is customer
  IF permission_companies IS NOT NULL AND customer_company_ids IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(customer_company_ids);
  ELSE
    permission_companies := '{}';
  END IF;

  -- Get customer IDs where company matches filtered permissions
  SELECT array_agg(c.id::text)
  INTO customer_ids
  FROM "customer" c
  WHERE c."companyId" = ANY(permission_companies);

  -- Get customer IDs from customer accounts
  SELECT array_agg(ca."customerId"::text)
  INTO customer_ids
  FROM "customerAccount" ca
  WHERE ca.id::uuid = auth.uid() AND ca."companyId" = ANY(customer_company_ids);

  RETURN customer_ids;
END;
$function$;
