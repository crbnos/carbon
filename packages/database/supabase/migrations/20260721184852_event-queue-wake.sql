-- =============================================================================
-- Push-based wake for the event queue
--
-- The event-queue Inngest function used to poll PGMQ on a 1-minute cron.
-- This migration makes the database push instead:
--
--   1. util.wake_event_queue() POSTs (via pg_net, fire-and-forget) to the
--      `event-wake` edge function, which forwards a
--      `carbon/event-queue.process` event to Inngest. Reads apiUrl/anonKey
--      from the singleton "config" table (same pattern as the webhook
--      triggers); silently no-ops when config is missing and never raises,
--      so OLTP writes can't fail on a push failure. pg_net queues the HTTP
--      request transactionally, so the wake only fires after commit — it can
--      never outrun the pgmq messages it announces.
--
--   2. dispatch_event_batch() calls it after enqueueing, at most once per
--      transaction (txn-local GUC carbon.event_wake_sent), so bulk writes
--      produce one wake, not thousands.
--
--   3. A pg_cron sweeper (every minute, in-DB) re-fires the wake only while
--      visible messages are sitting in the queue — the safety net for lost
--      pushes (dead pg_net worker, edge fn down, Inngest ingest failure).
--      No queue → no HTTP → no Inngest run.
--
-- Both helpers live in the internal `util` schema (like util.process_embeddings),
-- NOT public: public functions are auto-exposed as PostgREST RPCs, and a
-- non-superuser reference to a function that transitively calls net.http_post
-- segfaults the backend under pg_net 0.20 / PG15 — so exposing them in public
-- is a remote-DoS surface that a REVOKE does not close (the crash precedes the
-- privilege check). anon/authenticated have no USAGE on `util`, so the function
-- is unreachable from the API before any of that can happen. The trigger and
-- pg_cron call it as the owner (superuser), where the pg_net path is safe.
-- =============================================================================

-- Internal schema for trigger/cron-only helpers (created in 20250317_embeddings;
-- guarded here so this migration is self-contained). anon/authenticated get no
-- USAGE, which is what keeps these functions off the PostgREST RPC surface.
CREATE SCHEMA IF NOT EXISTS util;

-- ----------------------------------------------------------------------------
-- 1. util.wake_event_queue(): fire-and-forget doorbell to the event-wake edge fn
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION util.wake_event_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  api_url TEXT;
  anon_key TEXT;
BEGIN
  SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;

  IF api_url IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    api_url || '/functions/v1/event-wake',
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'wake_event_queue failed: % %', SQLERRM, SQLSTATE;
END;
$$;

COMMENT ON FUNCTION util.wake_event_queue() IS 'Fire-and-forget POST (pg_net) to the event-wake edge function, which sends carbon/event-queue.process to Inngest. Never raises; no-ops when the config row is missing. Internal (util schema): unreachable from the API.';

REVOKE ALL ON FUNCTION util.wake_event_queue() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. dispatch_event_batch(): wake the drainer after enqueueing
--    (body copied forward from 20260427120000_audit-event-timestamp.sql;
--     additions are did_enqueue + the wake block before RETURN NULL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_event_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, extensions
AS $$
DECLARE
  sub RECORD;
  msg_batch JSONB[];
  rec_company_id TEXT;
  has_subs BOOLEAN;
  current_actor_id TEXT;
  pk_column TEXT;
  query_text TEXT;
  did_enqueue BOOLEAN := FALSE;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  current_actor_id := auth.uid()::TEXT;
  pk_column := public.get_primary_key_column(TG_TABLE_NAME);

  IF TG_OP = 'DELETE' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_old t LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  ELSE
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  END IF;

  IF rec_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  ) INTO has_subs;

  IF NOT has_subs THEN RETURN NULL; END IF;

  FOR sub IN
    SELECT * FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  LOOP

    IF TG_OP = 'INSERT' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', row_to_json(t)::jsonb,
                        ''old'', null,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;

    ELSIF TG_OP = 'DELETE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', null,
                        ''old'', row_to_json(t)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_old t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;

    ELSIF TG_OP = 'UPDATE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', n.%I::TEXT,
                        ''new'', row_to_json(n)::jsonb,
                        ''old'', row_to_json(o)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new n
            JOIN batched_old o ON n.%I = o.%I
            WHERE n."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(n)::jsonb @> $9)
        ', pk_column, pk_column, pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;
    END IF;

    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
      did_enqueue := TRUE;
    END IF;

  END LOOP;

  -- Wake the Inngest drainer, at most once per transaction. The GUC is
  -- txn-local (set_config(..., true)), so multi-statement transactions and
  -- bulk imports post a single doorbell instead of one per statement.
  IF did_enqueue
     AND current_setting('carbon.event_wake_sent', true) IS DISTINCT FROM 'true' THEN
    PERFORM util.wake_event_queue();
    PERFORM set_config('carbon.event_wake_sent', 'true', true);
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispatch_event_batch() IS 'Dispatches database events to PGMQ and wakes the Inngest drainer via wake_event_queue() (once per transaction). Uses clock_timestamp() so each event has a unique microsecond timestamp even when batched.';

-- ----------------------------------------------------------------------------
-- 3. Sweeper: re-wake while visible messages are pending (safety net)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION util.sweep_event_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, extensions
AS $$
BEGIN
  -- Only visible messages count: rows hidden by a read's visibility timeout
  -- are already being drained and must not trigger a spurious wake.
  IF EXISTS (
    SELECT 1 FROM pgmq.q_event_system WHERE vt <= clock_timestamp()
  ) THEN
    PERFORM util.wake_event_queue();
  END IF;
END;
$$;

COMMENT ON FUNCTION util.sweep_event_queue() IS 'pg_cron safety net: wakes the Inngest event-queue drainer if visible messages are sitting in the event_system PGMQ queue (i.e. a push wake was lost). Internal (util schema): unreachable from the API.';

REVOKE ALL ON FUNCTION util.sweep_event_queue() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event-queue-sweeper') THEN
    PERFORM cron.unschedule('event-queue-sweeper');
  END IF;

  PERFORM cron.schedule(
    'event-queue-sweeper',
    '* * * * *',
    $job$ SELECT util.sweep_event_queue(); $job$
  );
END;
$$;
