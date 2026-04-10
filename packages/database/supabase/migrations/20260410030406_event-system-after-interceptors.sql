-- =============================================================================
-- Extend Event System with AFTER Row-Level Interceptors
--
-- This migration adds support for AFTER ROW interceptor functions alongside
-- the existing BEFORE ROW interceptors. AFTER interceptors run after the row
-- is committed, making them suitable for triggers that INSERT child records
-- with FK references back to the parent row.
--
-- Existing behavior is fully preserved:
--   - dispatch_event_interceptors() (BEFORE ROW) unchanged
--   - dispatch_event_batch() (AFTER STATEMENT) unchanged
--   - attach_event_trigger() gains a 3rd parameter: after_sync_functions
-- =============================================================================


-- =============================================================================
-- PART 1A: Fix BEFORE ROW Interceptor Dispatch Function
--
-- Schema-qualify the dynamic function call and cast TG_TABLE_NAME to TEXT
-- so interceptors are found even when the trigger fires under a non-default
-- search_path (e.g. supabase_auth_admin inserting into the "user" table).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_event_interceptors()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  func_name TEXT;
  payload_data JSONB;
  old_payload_data JSONB;
  i INTEGER;
BEGIN
  -- A. Normalize Data
  IF TG_OP = 'DELETE' THEN
    payload_data := row_to_json(OLD)::jsonb;
    old_payload_data := payload_data;
  ELSIF TG_OP = 'INSERT' THEN
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := NULL;
  ELSE -- UPDATE
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := row_to_json(OLD)::jsonb;
  END IF;

  -- B. Execute Interceptor Functions
  -- Loop through arguments passed in CREATE TRIGGER ... EXECUTE FUNCTION func(arg1, arg2)
  FOR i IN 0 .. (TG_NARGS - 1) LOOP
    func_name := TG_ARGV[i];
    EXECUTE format('SELECT public.%I($1, $2, $3, $4)', func_name)
    USING TG_TABLE_NAME::TEXT, TG_OP, payload_data, old_payload_data;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


-- =============================================================================
-- PART 1B: Create AFTER ROW Interceptor Dispatch Function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_event_after_interceptors()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  func_name TEXT;
  payload_data JSONB;
  old_payload_data JSONB;
  i INTEGER;
BEGIN
  -- A. Normalize Data
  IF TG_OP = 'DELETE' THEN
    payload_data := row_to_json(OLD)::jsonb;
    old_payload_data := payload_data;
  ELSIF TG_OP = 'INSERT' THEN
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := NULL;
  ELSE -- UPDATE
    payload_data := row_to_json(NEW)::jsonb;
    old_payload_data := row_to_json(OLD)::jsonb;
  END IF;

  -- B. Execute AFTER Interceptor Functions
  -- Same calling convention as dispatch_event_interceptors():
  --   function_name(table_name TEXT, operation TEXT, new_data JSONB, old_data JSONB)
  FOR i IN 0 .. (TG_NARGS - 1) LOOP
    func_name := TG_ARGV[i];
    EXECUTE format('SELECT public.%I($1, $2, $3, $4)', func_name)
    USING TG_TABLE_NAME::TEXT, TG_OP, payload_data, old_payload_data;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


-- =============================================================================
-- PART 2: Extend attach_event_trigger() with after_sync_functions parameter
-- =============================================================================

CREATE OR REPLACE FUNCTION public.attach_event_trigger(
  table_name_text TEXT,
  sync_functions TEXT[] DEFAULT ARRAY[]::TEXT[],
  after_sync_functions TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;


-- =============================================================================
-- PART 3: Update Status View to include AFTER SYNC triggers
-- =============================================================================

DROP VIEW IF EXISTS "eventSystemTrigger";

CREATE VIEW "eventSystemTrigger" AS
SELECT
    t.tgrelid::regclass::text AS "tableName",

    -- Friendly Type Name
    CASE
        WHEN t.tgname LIKE 'trg_event_after_sync_%' THEN 'AFTER SYNC (ROW)'
        WHEN t.tgname LIKE 'trg_event_sync_%' THEN 'BEFORE SYNC (ROW)'
        WHEN t.tgname LIKE 'trg_event_async_%' THEN 'ASYNC (STATEMENT)'
        ELSE 'UNKNOWN'
    END AS "type",

    -- Cleaned Function List
    CASE
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

    -- Status Badge
    CASE
        WHEN t.tgenabled = 'O' THEN 'Active'
        WHEN t.tgenabled = 'D' THEN 'Disabled'
        ELSE 'Replica Only'
    END AS "status",

    t.tgname AS "systemTriggerName"
FROM pg_trigger t
WHERE t.tgname LIKE 'trg_event_%'
ORDER BY "tableName", "type" DESC;
