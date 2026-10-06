CREATE OR REPLACE FUNCTION public.set_event_triggers(table_name_text text, before_functions text[] DEFAULT ARRAY[]::text[], after_functions text[] DEFAULT ARRAY[]::text[], queue_events boolean DEFAULT false, statement_functions text[] DEFAULT ARRAY[]::text[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  existing TEXT;
  fn_args TEXT;
  live TEXT[];
  wanted TEXT[];
BEGIN
  -- Makes a table's event triggers exactly what one entry of
  -- packages/database/src/event-system/attachments.ts says: the interceptors
  -- that run before and after each row, whether changes are queued as events,
  -- and the statement handlers. Called with only the table name, it detaches
  -- everything.

  -- A table dropped since its entry was shipped has nothing to attach to.
  IF to_regclass(format('public.%I', table_name_text)) IS NULL THEN
    RETURN;
  END IF;

  -- Already as declared: touch nothing. Creating a trigger locks the table
  -- against writes until the transaction ends, so a migration that restates
  -- every table's entry must not re-create the ones that have not changed.
  SELECT coalesce(array_agg(t.tgname || ':' || encode(t.tgargs, 'escape') ORDER BY t.tgname), '{}')
    INTO live
    FROM pg_trigger t
   WHERE t.tgrelid = format('public.%I', table_name_text)::regclass
     AND NOT t.tgisinternal
     AND t.tgname LIKE 'trg\_event\_%';

  SELECT coalesce(array_agg(w.name ORDER BY w.name), '{}')
    INTO wanted
    FROM (
      -- A trigger's arguments are stored NUL-terminated; a name is cut at 63 bytes.
      SELECT left('trg_event_sync_' || table_name_text, 63) || ':'
             || array_to_string(before_functions, '\000') || '\000'
       WHERE cardinality(before_functions) > 0
      UNION ALL
      SELECT left('trg_event_after_sync_' || table_name_text, 63) || ':'
             || array_to_string(after_functions, '\000') || '\000'
       WHERE cardinality(after_functions) > 0
      UNION ALL
      SELECT left('trg_event_async_' || op || '_' || table_name_text, 63) || ':'
        FROM unnest(ARRAY['ins', 'del', 'upd']) op
       WHERE queue_events
      UNION ALL
      SELECT left('trg_event_statement_' || fn || '_' || op, 63) || ':'
        FROM unnest(statement_functions) fn, unnest(ARRAY['ins', 'upd', 'del']) op
    ) w(name);

  IF live = wanted THEN
    RETURN;
  END IF;

  IF queue_events THEN
    PERFORM public.attach_event_trigger(table_name_text, before_functions, after_functions);
  ELSE
    -- attach_event_trigger always queues, so here the row-level triggers are
    -- created alone, with the same definitions it uses.
    FOR existing IN
      SELECT t.tgname
      FROM pg_trigger t
      WHERE t.tgrelid = format('public.%I', table_name_text)::regclass
        AND NOT t.tgisinternal
        AND (t.tgname LIKE 'trg\_event\_sync\_%'
          OR t.tgname LIKE 'trg\_event\_after\_sync\_%'
          OR t.tgname LIKE 'trg\_event\_async\_%')
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %2$I ON public.%1$I;', table_name_text, existing);
    END LOOP;

    IF array_length(before_functions, 1) > 0 THEN
      SELECT string_agg(quote_literal(x), ', ') INTO fn_args FROM unnest(before_functions) x;
      EXECUTE format('
        CREATE TRIGGER "trg_event_sync_%1$s"
        BEFORE INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW
        EXECUTE FUNCTION public.dispatch_event_interceptors(%2$s);
      ', table_name_text, fn_args);
    END IF;

    IF array_length(after_functions, 1) > 0 THEN
      SELECT string_agg(quote_literal(x), ', ') INTO fn_args FROM unnest(after_functions) x;
      EXECUTE format('
        CREATE TRIGGER "trg_event_after_sync_%1$s"
        AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW
        EXECUTE FUNCTION public.dispatch_event_after_interceptors(%2$s);
      ', table_name_text, fn_args);
    END IF;
  END IF;

  PERFORM public.attach_statement_handler(table_name_text, statement_functions);
END;
$function$;
