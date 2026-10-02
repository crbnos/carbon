CREATE OR REPLACE FUNCTION public.attach_event_trigger(table_name_text text, sync_functions text[] DEFAULT ARRAY[]::text[], after_sync_functions text[] DEFAULT ARRAY[]::text[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  sync_args TEXT;
  after_sync_args TEXT;
BEGIN
  -- A. Attach BEFORE SYNC Trigger (Row Level) -- unchanged behavior
  IF array_length(sync_functions, 1) > 0 THEN
      SELECT string_agg(quote_literal(x), ', ') INTO sync_args FROM unnest(sync_functions) x;

      EXECUTE format('
        DROP TRIGGER IF EXISTS "trg_event_sync_%1$s" ON %1$I;
        CREATE TRIGGER "trg_event_sync_%1$s"
        BEFORE INSERT OR UPDATE OR DELETE ON %1$I
        FOR EACH ROW
        EXECUTE FUNCTION public.dispatch_event_interceptors(%2$s);
      ', table_name_text, sync_args);
  ELSE
      EXECUTE format('DROP TRIGGER IF EXISTS "trg_event_sync_%1$s" ON %1$I;', table_name_text);
  END IF;

  -- B. Attach AFTER SYNC Trigger (Row Level) -- NEW
  IF array_length(after_sync_functions, 1) > 0 THEN
      SELECT string_agg(quote_literal(x), ', ') INTO after_sync_args FROM unnest(after_sync_functions) x;

      EXECUTE format('
        DROP TRIGGER IF EXISTS "trg_event_after_sync_%1$s" ON %1$I;
        CREATE TRIGGER "trg_event_after_sync_%1$s"
        AFTER INSERT OR UPDATE OR DELETE ON %1$I
        FOR EACH ROW
        EXECUTE FUNCTION public.dispatch_event_after_interceptors(%2$s);
      ', table_name_text, after_sync_args);
  ELSE
      EXECUTE format('DROP TRIGGER IF EXISTS "trg_event_after_sync_%1$s" ON %1$I;', table_name_text);
  END IF;

  -- C. Attach ASYNC Triggers (Statement Level) -- unchanged behavior
  -- 1. INSERT
  EXECUTE format('
    DROP TRIGGER IF EXISTS "trg_event_async_ins_%1$s" ON %1$I;
    CREATE TRIGGER "trg_event_async_ins_%1$s"
    AFTER INSERT ON %1$I
    REFERENCING NEW TABLE AS batched_new
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.dispatch_event_batch();
  ', table_name_text);

  -- 2. DELETE
  EXECUTE format('
    DROP TRIGGER IF EXISTS "trg_event_async_del_%1$s" ON %1$I;
    CREATE TRIGGER "trg_event_async_del_%1$s"
    AFTER DELETE ON %1$I
    REFERENCING OLD TABLE AS batched_old
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.dispatch_event_batch();
  ', table_name_text);

  -- 3. UPDATE
  EXECUTE format('
    DROP TRIGGER IF EXISTS "trg_event_async_upd_%1$s" ON %1$I;
    CREATE TRIGGER "trg_event_async_upd_%1$s"
    AFTER UPDATE ON %1$I
    REFERENCING NEW TABLE AS batched_new OLD TABLE AS batched_old
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.dispatch_event_batch();
  ', table_name_text);

END;
$function$;
