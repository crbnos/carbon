CREATE OR REPLACE FUNCTION public.assert_audit_log_access(p_company_id text, p_permission text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;

  IF p_permission IS NOT NULL AND p_company_id = ANY (
    COALESCE(get_companies_with_employee_permission(p_permission), '{}')::text[]
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized to access the audit log for this company'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;
