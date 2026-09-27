CREATE OR REPLACE FUNCTION public.has_company_permission(claim text, company text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    BEGIN
      -- Deprecated (still used by storage policies). True only when the caller holds the
      -- permission in that company AND belongs to it.
      RETURN EXISTS (
        SELECT 1
        FROM public."userPermission" up
        WHERE up.id = (SELECT auth.uid()::text)
          AND company = ANY(jsonb_to_text_array(COALESCE(up.permissions->claim, '[]')))
      ) AND EXISTS (
        SELECT 1 FROM "userToCompany" utc
        WHERE utc."userId" = (SELECT auth.uid()::text) AND utc."companyId" = company
      );
    END;
$function$;
