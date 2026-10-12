CREATE OR REPLACE FUNCTION public.get_entity_audit_log(p_company_id text, p_entity_type text, p_entity_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_record_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, "tableName" text, "entityType" text, "entityId" text, "recordId" text, operation text, "actorId" text, diff jsonb, metadata jsonb, "createdAt" timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  IF p_record_id IS NULL THEN
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2 AND "recordId" = $3
      ORDER BY "createdAt" DESC
      LIMIT $4 OFFSET $5
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_record_id, p_limit, p_offset;
  END IF;
END;
$function$;
