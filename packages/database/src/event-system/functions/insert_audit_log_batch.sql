CREATE OR REPLACE FUNCTION public.insert_audit_log_batch(p_company_id text, p_entries jsonb[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  entry JSONB;
  inserted_count INTEGER := 0;
  v_created_at TIMESTAMPTZ;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  PERFORM create_audit_log_table(p_company_id);

  FOREACH entry IN ARRAY p_entries
  LOOP
    -- Use the entry's createdAt if provided (the original event time);
    -- otherwise fall back to clock_timestamp() so rows in the same
    -- transaction still get unique values rather than sharing NOW().
    v_created_at := COALESCE(
      (entry->>'createdAt')::TIMESTAMPTZ,
      clock_timestamp()
    );

    EXECUTE format('
      INSERT INTO %I ("tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ', tbl_name)
    USING
      entry->>'tableName',
      entry->>'entityType',
      entry->>'entityId',
      entry->>'recordId',
      entry->>'operation',
      entry->>'actorId',
      CASE WHEN entry->'diff' = 'null'::jsonb THEN NULL ELSE entry->'diff' END,
      CASE WHEN entry->'metadata' = 'null'::jsonb THEN NULL ELSE entry->'metadata' END,
      v_created_at;

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;
