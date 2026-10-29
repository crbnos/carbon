CREATE OR REPLACE FUNCTION public.get_claims(uid text, company text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE company_role text;
  DECLARE role_object jsonb;
  DECLARE perms jsonb;
  BEGIN
    -- Your own claims, or those of someone in a company where you may view or
    -- update users (the permission editor reads them with users_update alone).
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text
       AND NOT EXISTS (
         SELECT 1 FROM "userToCompany" utc
         WHERE utc."userId" = uid
           AND utc."companyId" = ANY (
             get_companies_with_employee_permission('users_view')
             || get_companies_with_employee_permission('users_update')
           )
       ) THEN
      RAISE EXCEPTION 'Not authorized to read claims for this user'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    select role from "userToCompany" into company_role where "userId" = uid AND "companyId" = company;
    select permissions from "userPermission" into perms where id = uid;
    role_object := jsonb_build_object('role', company_role);


    return (role_object || perms)::jsonb;
  END;
$function$;
