CREATE OR REPLACE FUNCTION util.can_manage_event_subscription(p_company_id text, p_handler_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN TRUE;
  END IF;

  IF p_handler_type = 'WEBHOOK' THEN
    RETURN p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_create'))::text[], ARRAY[]::text[]))
        OR p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_update'))::text[], ARRAY[]::text[]))
        OR p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_permission('settings_delete'))::text[], ARRAY[]::text[]));
  END IF;

  RETURN p_company_id = ANY (COALESCE((SELECT get_companies_with_employee_role())::text[], ARRAY[]::text[]));
END;
$function$;
