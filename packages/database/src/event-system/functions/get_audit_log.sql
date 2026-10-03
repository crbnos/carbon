CREATE OR REPLACE FUNCTION public.get_audit_log(p_company_id text, p_entity_type text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text, p_actor_id text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id text, "tableName" text, "entityType" text, "entityId" text, operation text, "actorId" text, diff jsonb, metadata jsonb, "createdAt" timestamp with time zone, "totalCount" bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
  where_clause TEXT := '';
  query_text TEXT;
  count_query TEXT;
  total BIGINT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  IF p_entity_type IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityType" = %L', p_entity_type));
  END IF;

  IF p_entity_id IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityId" = %L', p_entity_id));
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

  count_query := format('SELECT COUNT(*) FROM %I %s', tbl_name, where_clause);
  EXECUTE count_query INTO total;

  query_text := format('
    SELECT "id", "tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt", %s::BIGINT as "totalCount"
    FROM %I
    %s
    ORDER BY "createdAt" DESC
    LIMIT %s OFFSET %s
  ', total, tbl_name, where_clause, p_limit, p_offset);

  RETURN QUERY EXECUTE query_text;
END;
$function$;
