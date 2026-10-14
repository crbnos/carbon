CREATE OR REPLACE FUNCTION public.attach_audit_log_append_only(p_table_name text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS "append_only" ON %I', p_table_name);
  EXECUTE format(
    'CREATE TRIGGER "append_only" BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()',
    p_table_name
  );
END;
$function$;
