CREATE OR REPLACE FUNCTION public.delete_old_audit_logs(p_company_id text, p_cutoff_date timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  deleted_count INTEGER;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN 0;
  END IF;

  -- Authorize the append-only trigger to permit these retention deletes.
  PERFORM set_config('app.audit_archiving', 'on', true);

  EXECUTE format('
    WITH deleted AS (
      DELETE FROM %I
      WHERE "createdAt" < $1
      RETURNING *
    )
    SELECT COUNT(*) FROM deleted
  ', tbl_name)
  USING p_cutoff_date
  INTO deleted_count;

  RETURN deleted_count;
END;
$function$;
