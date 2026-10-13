CREATE OR REPLACE FUNCTION public.drop_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', tbl_name);
END;
$function$;
