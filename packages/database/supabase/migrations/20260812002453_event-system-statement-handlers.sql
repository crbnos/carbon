-- Event system: attach_statement_handler — a table can register its own
-- STATEMENT-level handler, run with the transition tables batched_new /
-- batched_old. The statement-level sibling of attach_event_trigger's row-level
-- interceptors; does not enqueue to PGMQ.
--
-- This cannot live inside dispatch_event_batch(): transition tables are visible
-- only to the function a trigger invokes directly (a nested call fails with
-- `relation "batched_new" does not exist`), and dispatch_event_batch returns
-- early for tables with no active subscription. It is also not an extra
-- parameter on attach_event_trigger: adding a defaulted parameter alongside the
-- two live overloads makes existing calls ambiguous, and the dispatcher costs
-- ~0.3 ms per statement even with no subscribers — wrong default for a
-- high-volume table like itemLedger that only wants a local aggregate.

-- 20260410030406 added attach_event_trigger's 3rd parameter via CREATE OR
-- REPLACE, which created a SIBLING overload rather than replacing. A 2-argument
-- call has been ambiguous ("is not unique") ever since — unnoticed only because
-- no migration since uses that form. The old overload is redundant (the newer
-- one defaults its 3rd arg), so drop it.
DROP FUNCTION IF EXISTS public.attach_event_trigger(TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION public.attach_statement_handler(
  table_name_text TEXT,
  handler_functions TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.attach_statement_handler(TEXT, TEXT[]) IS
  'Attaches statement-level handler functions to a table, run with the transition tables batched_new / batched_old. The statement-level sibling of attach_event_trigger''s row-level interceptors; does not register the table for PGMQ dispatch. Handlers must branch on TG_OP.';

-- Same columns as before; the CASE expressions gain a HANDLER (STATEMENT) branch.
DROP VIEW IF EXISTS "eventSystemTrigger";

CREATE VIEW "eventSystemTrigger" AS
SELECT
    t.tgrelid::regclass::text AS "tableName",

    CASE
        WHEN t.tgname LIKE 'trg_event_statement_%' THEN 'HANDLER (STATEMENT)'
        WHEN t.tgname LIKE 'trg_event_after_sync_%' THEN 'AFTER SYNC (ROW)'
        WHEN t.tgname LIKE 'trg_event_sync_%' THEN 'BEFORE SYNC (ROW)'
        WHEN t.tgname LIKE 'trg_event_async_%' THEN 'ASYNC (STATEMENT)'
        ELSE 'UNKNOWN'
    END AS "type",

    CASE
        -- ::text so the generated column type stays string, not `name`
        WHEN t.tgname LIKE 'trg_event_statement_%' THEN p.proname::text
        WHEN t.tgname LIKE 'trg_event_after_sync_%' THEN
           REPLACE(
             REPLACE(
               substring(pg_get_triggerdef(t.oid) FROM 'dispatch_event_after_interceptors\((.*)\)'),
               '''', ''
             ),
             ', ', ' -> '
           )
        WHEN t.tgname LIKE 'trg_event_sync_%' THEN
           REPLACE(
             REPLACE(
               substring(pg_get_triggerdef(t.oid) FROM 'dispatch_event_interceptors\((.*)\)'),
               '''', ''
             ),
             ', ', ' -> '
           )
        ELSE 'PGMQ Batch'
    END AS "attachedFunctions",

    CASE
        WHEN t.tgenabled = 'O' THEN 'Active'
        WHEN t.tgenabled = 'D' THEN 'Disabled'
        ELSE 'Replica Only'
    END AS "status",

    t.tgname AS "systemTriggerName"
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgname LIKE 'trg_event_%'
  AND NOT t.tgisinternal
ORDER BY "tableName", "type" DESC;
