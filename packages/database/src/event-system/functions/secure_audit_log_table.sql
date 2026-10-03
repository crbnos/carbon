CREATE OR REPLACE FUNCTION public.secure_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  tbl_name TEXT := 'auditLog_' || p_company_id;
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS "audit_log_access" ON %I', tbl_name);
  EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON %I', tbl_name);
  EXECUTE format(
    'CREATE POLICY "SELECT" ON %I FOR SELECT USING (
       %L = ANY ((SELECT get_companies_with_employee_permission(''settings_view''))::text[])
     )',
    tbl_name, p_company_id
  );
  EXECUTE format(
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM anon, authenticated',
    tbl_name
  );
END;
$function$;
