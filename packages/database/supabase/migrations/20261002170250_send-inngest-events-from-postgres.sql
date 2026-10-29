-- Postgres sends its Inngest events itself instead of through edge functions.
--
-- The `event-wake`, `trigger` and `embed` edge functions only forwarded a
-- pg_net POST to Inngest (or, for `embed`, did work the Node jobs can do).
-- util.send_inngest_event() posts the event straight to the Inngest event API,
-- so all three functions go away:
--
--   util.wake_event_queue()           carbon/event-queue.process
--   sync_job_complete_or_canceled()   carbon/notify (job-completed)
--   util.sweep_embedding_queue()      carbon/embedding-queue.process, a doorbell
--                                     like util.sweep_event_queue(); the
--                                     embedding-queue Inngest function drains
--                                     pgmq `embedding_jobs` itself.
--
-- The two util doorbells are event-system functions
-- (packages/database/src/event-system/functions); the generated migration after
-- this one ships them.
--
-- The event URL carries the event key (`<base>/e/<key>`), so it lives in Vault,
-- not in "config" (which has a SELECT policy). CI writes it on every deploy and
-- `crbn up` / `crbn migrate` locally, through public.set_inngest_event_url().

CREATE SCHEMA IF NOT EXISTS util;

-- ----------------------------------------------------------------------------
-- 1. Vault-backed event URL
-- ----------------------------------------------------------------------------
-- In public so CI can call it over PostgREST with the service role key. REVOKE
-- is not an option on this image (a revoked call segfaults the backend,
-- 20260924192316), so it refuses the API roles itself, like
-- assert_company_access.
CREATE OR REPLACE FUNCTION public.set_inngest_event_url(p_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  secret_id UUID;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'inngest_event_url';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_url, 'inngest_event_url');
  ELSE
    PERFORM vault.update_secret(secret_id, p_url);
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. util.send_inngest_event(): fire-and-forget POST to the Inngest event API
-- ----------------------------------------------------------------------------
-- Same contract as the doorbell it replaces: no-ops when the URL is not set,
-- never raises (an OLTP write must not fail on a push), and pg_net queues the
-- request transactionally, so it fires only after commit.
CREATE OR REPLACE FUNCTION util.send_inngest_event(p_name TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  event_url TEXT;
BEGIN
  SELECT decrypted_secret INTO event_url
  FROM vault.decrypted_secrets
  WHERE name = 'inngest_event_url';
  IF event_url IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    event_url,
    jsonb_build_object('name', p_name, 'data', COALESCE(p_data, '{}'::jsonb)),
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json')
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_inngest_event(%) failed: % %', p_name, SQLERRM, SQLSTATE;
END;
$$;
COMMENT ON FUNCTION util.send_inngest_event(TEXT, JSONB) IS 'Fire-and-forget POST (pg_net) of one event to the Inngest event API at the Vault secret inngest_event_url. Never raises; no-ops when the secret is missing. Internal (util schema): unreachable from the API.';
REVOKE ALL ON FUNCTION util.send_inngest_event(TEXT, JSONB) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. Job-completed notification
--    (body copied forward from 20260410031803_job-interceptors.sql, SECURITY
--     INVOKER since 20260925121735; only the notify call changed)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_job_complete_or_canceled(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  group_ids TEXT[];
BEGIN
  IF p_operation = 'UPDATE'
    AND (p_old->>'status') != (p_new->>'status')
    AND ((p_new->>'status') = 'Completed' OR (p_new->>'status') = 'Cancelled')
  THEN
    UPDATE "kanban"
    SET "jobId" = NULL
    WHERE "jobId" = p_new->>'id';

    -- Send notification on job completion
    IF (p_new->>'status') = 'Completed' THEN
      IF (p_new->>'salesOrderId') IS NULL THEN
        SELECT "inventoryJobCompletedNotificationGroup" INTO group_ids
        FROM "companySettings" WHERE "id" = p_new->>'companyId';
      ELSE
        SELECT "salesJobCompletedNotificationGroup" INTO group_ids
        FROM "companySettings" WHERE "id" = p_new->>'companyId';
      END IF;

      IF (p_new->>'assignee') IS NOT NULL THEN
        group_ids := array_append(COALESCE(group_ids, '{}'), p_new->>'assignee');
      END IF;

      IF array_length(group_ids, 1) > 0 THEN
        PERFORM util.send_inngest_event(
          'carbon/notify',
          jsonb_build_object(
            'companyId', p_new->>'companyId',
            'documentId', p_new->>'id',
            'event', 'job-completed',
            'recipient', jsonb_build_object(
              'type', 'group',
              'groupIds', group_ids
            ),
            'from', 'system'
          )
        );
      END IF;
    END IF;
  END IF;
END;
$$;
