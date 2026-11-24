CREATE OR REPLACE FUNCTION public.check_user_to_company_admin(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Removing an Admin from the company is an Admin's call, as making one is.
  IF p_operation <> 'DELETE'
     OR current_setting('role', true) IN ('anon', 'authenticated') IS NOT TRUE THEN
    RETURN;
  END IF;

  -- With no page, access_level is Full only for the company's Admin type.
  IF util.access_level(p_old->>'userId', NULL, p_old->>'companyId', NULL) = 'Full'
     AND util.access_level(auth.uid()::text, NULL, p_old->>'companyId', NULL) IS DISTINCT FROM 'Full' THEN
    RAISE EXCEPTION 'Only an Admin can remove an Admin from the company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
