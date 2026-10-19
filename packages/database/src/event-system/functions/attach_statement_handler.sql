CREATE OR REPLACE FUNCTION public.attach_statement_handler(table_name_text text, handler_functions text[] DEFAULT ARRAY[]::text[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  fn TEXT;
  existing TEXT;
BEGIN
  -- Drop-then-attach, like attach_event_trigger's sync sections: re-running is
  -- idempotent and an empty array detaches.
  FOR existing IN
    SELECT t.tgname
    FROM pg_trigger t
    WHERE t.tgrelid = format('%I', table_name_text)::regclass
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'trg\_event\_statement\_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %2$I ON %1$I;', table_name_text, existing);
  END LOOP;

  -- One function serves all three operations, so it must branch on TG_OP: only
  -- batched_new exists on INSERT and only batched_old on DELETE. PL/pgSQL plans
  -- lazily, so a branch that does not run never resolves its missing table.
  FOREACH fn IN ARRAY handler_functions LOOP
    EXECUTE format('
      CREATE TRIGGER %2$I AFTER INSERT ON %1$I
      REFERENCING NEW TABLE AS batched_new
      FOR EACH STATEMENT EXECUTE FUNCTION %3$I();
    ', table_name_text, format('trg_event_statement_%s_ins', fn), fn);

    EXECUTE format('
      CREATE TRIGGER %2$I AFTER UPDATE ON %1$I
      REFERENCING NEW TABLE AS batched_new OLD TABLE AS batched_old
      FOR EACH STATEMENT EXECUTE FUNCTION %3$I();
    ', table_name_text, format('trg_event_statement_%s_upd', fn), fn);

    EXECUTE format('
      CREATE TRIGGER %2$I AFTER DELETE ON %1$I
      REFERENCING OLD TABLE AS batched_old
      FOR EACH STATEMENT EXECUTE FUNCTION %3$I();
    ', table_name_text, format('trg_event_statement_%s_del', fn), fn);
  END LOOP;
END;
$function$;
