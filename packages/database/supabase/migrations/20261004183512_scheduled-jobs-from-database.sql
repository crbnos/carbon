-- Three Inngest crons ran on the clock whether or not there was anything to do:
-- the notification digest 96 times a day (11 digests in a month), the
-- notification purge and the workflow run retention once a night. The database
-- already knows when there is work, so it now decides:
--
--   notification purge      runs here, in pg_cron. It was two DELETEs by age.
--   notification digest     pg_cron asks every 15 minutes and wakes the Inngest
--   workflow run retention  function only when there is work for it. The work
--                           itself stays in TypeScript: the digest's wording is
--                           translated copy and the retention's payload
--                           shrinker is code.
--
-- The helpers live in `util`, like the event queue's: a public function is an
-- API endpoint, and one that reaches pg_net segfaults the backend when a
-- non-superuser calls it (see 20260721184852_event-queue-wake.sql).
--
-- The ages and thresholds below repeat constants in
-- packages/jobs/src/inngest/functions/scheduled/{notification-digest,workflow-run-retention}.ts.
-- Change both together: a looser rule here wakes the function for nothing, a
-- stricter one leaves work undone.

-- 1. Notification purge. Unread rows are kept forever. Digested children go
-- before read rows, and a day earlier: a parent deleted while its children
-- remain puts them back in the topbar as unread (digestedInto is ON DELETE SET
-- NULL).
CREATE OR REPLACE FUNCTION util.purge_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purged_digested bigint;
  purged_read bigint;
BEGIN
  DELETE FROM "notification"
  WHERE "createdAt" < now() - interval '30 days'
    AND "digestedInto" IS NOT NULL;
  GET DIAGNOSTICS purged_digested = ROW_COUNT;

  DELETE FROM "notification"
  WHERE "createdAt" < now() - interval '31 days'
    AND "readAt" IS NOT NULL;
  GET DIAGNOSTICS purged_read = ROW_COUNT;

  RAISE LOG 'purge_notifications: % digested, % read', purged_digested, purged_read;
END;
$$;

-- 2. Notification digest. True when a run of the digest function would write
-- something:
--   a (user, company, topic) with 5 or more unread notifications older than an
--   hour and no digest yet;
--   one that already has an unread digest and a notification to fold into it;
--   one with more than one unread digest (they are merged into the oldest);
--   a digest whose title no longer matches how many notifications it holds.
CREATE OR REPLACE FUNCTION util.notification_digest_has_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT "userId", "companyId", "topic", count(*) AS total
    FROM "notification"
    WHERE "readAt" IS NULL
      AND "digestedInto" IS NULL
      AND "event" <> 'digest'
      AND "createdAt" < now() - interval '60 minutes'
    GROUP BY "userId", "companyId", "topic"
  ),
  digests AS (
    SELECT "userId", "companyId", "topic", count(*) AS total
    FROM "notification"
    WHERE "readAt" IS NULL
      AND "digestedInto" IS NULL
      AND "event" = 'digest'
    GROUP BY "userId", "companyId", "topic"
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM candidates c
      LEFT JOIN digests d USING ("userId", "companyId", "topic")
      WHERE d.total IS NOT NULL OR c.total >= 5
    )
    OR EXISTS (SELECT 1 FROM digests WHERE total > 1)
    OR EXISTS (
      SELECT 1
      FROM "notification" d
      WHERE d."readAt" IS NULL
        AND d."digestedInto" IS NULL
        AND d."event" = 'digest'
        AND (d."payload" ->> 'count') IS DISTINCT FROM (
          SELECT count(*)::text FROM "notification" c WHERE c."digestedInto" = d."id"
        )
    );
$$;

CREATE OR REPLACE FUNCTION util.sweep_notification_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF util.notification_digest_has_work() THEN
    PERFORM util.send_inngest_event('carbon/notification-digest.process', '{}'::jsonb);
  END IF;
END;
$$;

-- 3. Workflow run retention. True when any of the function's four passes has a
-- run to work on. Age is COALESCE("completedAt", "createdAt"): Blocked runs and
-- the scheduler's Skipped runs are inserted terminal and never get a completedAt.
CREATE OR REPLACE FUNCTION util.workflow_run_retention_has_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- reap: a run still in flight after a day has stopped reporting.
    EXISTS (
      SELECT 1 FROM "workflowRun"
      WHERE "status" IN ('Queued', 'Running')
        AND "createdAt" < now() - interval '24 hours'
    )
    OR EXISTS (
      SELECT 1
      FROM "workflowRun" r
      WHERE r."status" IN ('Succeeded', 'Failed', 'Blocked', 'Skipped')
        AND (
          -- compact: full step detail lasts a week.
          (
            r."compactedAt" IS NULL
            AND COALESCE(r."completedAt", r."createdAt") < now() - interval '7 days'
          )
          -- drop step detail: a month, and only once compacted.
          OR (
            r."compactedAt" IS NOT NULL
            AND COALESCE(r."completedAt", r."createdAt") < now() - interval '30 days'
            AND EXISTS (
              SELECT 1 FROM "workflowStepRun" s
              WHERE s."runId" = r."id" AND s."companyId" = r."companyId"
            )
          )
          -- purge the header: a quarter.
          OR COALESCE(r."completedAt", r."createdAt") < now() - interval '90 days'
        )
    );
$$;

CREATE OR REPLACE FUNCTION util.sweep_workflow_run_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF util.workflow_run_retention_has_work() THEN
    PERFORM util.send_inngest_event('carbon/workflow-run-retention.process', '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION util.purge_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.notification_digest_has_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.sweep_notification_digest() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.workflow_run_retention_has_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.sweep_workflow_run_retention() FROM PUBLIC;

-- The schedules the Inngest crons had.
DO $$
DECLARE
  job record;
BEGIN
  FOR job IN
    SELECT * FROM (VALUES
      ('notification-purge', '0 3 * * *', 'SELECT util.purge_notifications();'),
      ('notification-digest-sweeper', '*/15 * * * *', 'SELECT util.sweep_notification_digest();'),
      ('workflow-run-retention-sweeper', '0 4 * * *', 'SELECT util.sweep_workflow_run_retention();')
    ) AS t(name, schedule, command)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job.name) THEN
      PERFORM cron.unschedule(job.name);
    END IF;
    PERFORM cron.schedule(job.name, job.schedule, job.command);
  END LOOP;
END;
$$;
