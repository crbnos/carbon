CREATE OR REPLACE FUNCTION public.get_customer_ids_with_customer_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  customer_company_ids text[];
  customer_ids text[];
BEGIN
  SELECT array_agg("companyId"::text)
  INTO customer_company_ids
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'customer';

  SELECT array_agg(ca."customerId"::text)
  INTO customer_ids
  FROM "customerAccount" ca
  WHERE ca.id::uuid = auth.uid() AND ca."companyId" = ANY(customer_company_ids);

  RETURN customer_ids;
END;
$function$;
