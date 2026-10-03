CREATE OR REPLACE FUNCTION public.get_audit_log_count(p_company_id text, p_entity_type text DEFAULT NULL::text, p_actor_id text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
  where_clause TEXT := '';
  count_val INTEGER;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN 0;
  END IF;

  IF p_entity_type IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityType" = %L', p_entity_type));
  END IF;

  IF p_actor_id IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"actorId" = %L', p_actor_id));
  END IF;

  IF p_operation IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"operation" = %L', p_operation));
  END IF;

  IF p_start_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" >= %L', p_start_date));
  END IF;

  IF p_end_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" <= %L', p_end_date));
  END IF;

  IF p_search IS NOT NULL AND p_search != '' THEN
    where_clauses := array_append(where_clauses,
      format('"entityId" ILIKE %L', '%' || p_search || '%'));
  END IF;

  IF array_length(where_clauses, 1) > 0 THEN
    where_clause := 'WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;

  EXECUTE format('SELECT COUNT(*)::INTEGER FROM %I %s', tbl_name, where_clause) INTO count_val;
  RETURN count_val;
END;
$function$;
