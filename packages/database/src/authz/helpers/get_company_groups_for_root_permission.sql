CREATE OR REPLACE FUNCTION public.get_company_groups_for_root_permission(permission text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permitted_companies text[];
  group_ids text[];
BEGIN
  permitted_companies := get_companies_with_employee_permission(permission);

  IF permitted_companies IS NULL OR array_length(permitted_companies, 1) IS NULL THEN
    RETURN '{}';
  END IF;

  -- Only consider root companies (no parent)
  SELECT array_agg(DISTINCT "companyGroupId"::text)
  INTO group_ids
  FROM "company"
  WHERE "id" = ANY(permitted_companies)
    AND "parentCompanyId" IS NULL
    AND "companyGroupId" IS NOT NULL;

  RETURN COALESCE(group_ids, '{}');
END;
$function$;
