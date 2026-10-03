CREATE OR REPLACE FUNCTION public.insert_audit_log_batch(p_company_id text, p_entries jsonb[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  inserted_count INTEGER := 0;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  PERFORM create_audit_log_table(p_company_id);

  -- createdAt is the entry's own (the original event time) when it has one.
  -- clock_timestamp() is evaluated per row, so the rest still get distinct
  -- values rather than sharing NOW().
  EXECUTE format('
    INSERT INTO %I ("tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt")
    SELECT
      e->>''tableName'',
      e->>''entityType'',
      e->>''entityId'',
      e->>''recordId'',
      e->>''operation'',
      e->>''actorId'',
      NULLIF(e->''diff'', ''null''::jsonb),
      NULLIF(e->''metadata'', ''null''::jsonb),
      COALESCE((e->>''createdAt'')::TIMESTAMPTZ, clock_timestamp())
    FROM unnest($1) AS e
  ', tbl_name)
  USING p_entries;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN inserted_count;
END;
$function$;
