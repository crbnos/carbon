CREATE OR REPLACE FUNCTION public.assert_company_access(p_company_id text, p_permission text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role, and direct connections (jobs, Kysely, edge functions) are already trusted.
  IF current_setting('role', true) NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;

  IF p_company_id = ANY (
    CASE WHEN p_permission IS NULL
      THEN get_companies_with_employee_role()
      ELSE get_companies_with_employee_permission(p_permission)
    END
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized for this company'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;
