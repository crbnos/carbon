CREATE OR REPLACE FUNCTION public.get_audit_logs_for_archive(p_company_id text, p_before_date timestamp with time zone)
 RETURNS TABLE(id text, "tableName" text, "entityType" text, "entityId" text, operation text, "actorId" text, diff jsonb, metadata jsonb, "createdAt" timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT "id", "tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "createdAt" < $1
    ORDER BY "createdAt" ASC
  ', tbl_name)
  USING p_before_date;
END;
$function$;
