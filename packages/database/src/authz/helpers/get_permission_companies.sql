CREATE OR REPLACE FUNCTION public.get_permission_companies(claim text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      retval text[];
    BEGIN
      -- Deprecated: prefer get_companies_with_employee_permission. A permission counts only in
      -- a company the caller belongs to; no API key path (keys get nothing, as before).
      SELECT array_agg(company)
      INTO retval
      FROM public."userPermission" up,
           unnest(jsonb_to_text_array(COALESCE(up.permissions->claim, '[]'))) company
      WHERE up.id = auth.uid()::text
        AND EXISTS (
          SELECT 1 FROM "userToCompany" utc
          WHERE utc."userId" = auth.uid()::text AND utc."companyId" = company
        );
      RETURN retval;
    END;
$function$;
