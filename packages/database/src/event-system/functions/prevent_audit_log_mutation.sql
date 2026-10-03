CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit log records are immutable (append-only)';
  END IF;
  -- DELETE: permitted only during retention/archival, which sets this flag.
  IF current_setting('app.audit_archiving', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Audit log records cannot be deleted (retention/archival only)';
  END IF;
  RETURN OLD;
END;
$function$;
