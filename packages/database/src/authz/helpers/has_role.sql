CREATE OR REPLACE FUNCTION public.has_role(required_role text, company text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      user_role text;
    BEGIN
      SELECT role INTO user_role FROM public."userToCompany" WHERE "userId" = (SELECT auth.uid()::text) AND "companyId" = company;
      RETURN COALESCE(user_role = required_role, false);
    END;
$function$;
