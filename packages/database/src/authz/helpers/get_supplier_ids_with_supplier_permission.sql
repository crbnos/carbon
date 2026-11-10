CREATE OR REPLACE FUNCTION public.get_supplier_ids_with_supplier_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  supplier_company_ids text[];
  supplier_ids text[];
BEGIN
  SELECT array_agg("companyId"::text)
  INTO supplier_company_ids
  FROM "userToCompany" 
  WHERE "userId" = auth.uid()::text AND "role" = 'supplier';

  SELECT array_agg(ca."supplierId"::text)
  INTO supplier_ids
  FROM "supplierAccount" ca
  WHERE ca.id::uuid = auth.uid() AND ca."companyId" = ANY(supplier_company_ids);

  RETURN supplier_ids;
END;
$function$;
