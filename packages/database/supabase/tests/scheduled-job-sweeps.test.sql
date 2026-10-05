-- The pg_cron sweeps that replaced three Inngest crons
-- (20261004183512_scheduled-jobs-from-database.sql): when the digest and the
-- workflow run retention are woken, and what the notification purge deletes.
-- Run from the repository root against an existing local database that has at
-- least one company with a user and one workflow version:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/scheduled-job-sweeps.test.sql
-- Everything, including clearing the two tables, is confined to the
-- rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

-- The sweeps read whole tables, so start from none.
DELETE FROM "notification";
DELETE FROM "workflowRun";

CREATE FUNCTION pg_temp.notify(
  age interval,
  kind text DEFAULT 'job-assignment',
  topic text DEFAULT 'jobs',
  parent text DEFAULT NULL,
  read boolean DEFAULT false,
  payload jsonb DEFAULT '{}'
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE new_id text;
BEGIN
  INSERT INTO "notification"
    ("companyId", "userId", "event", "topic", "title", "payload", "createdAt", "readAt", "digestedInto")
  SELECT uc."companyId", uc."userId", kind, topic, 'Test', payload, now() - age,
         CASE WHEN read THEN now() END, parent
  FROM "userToCompany" uc ORDER BY uc."companyId", uc."userId" LIMIT 1
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$fn$;

CREATE FUNCTION pg_temp.run(
  run_status text,
  age interval,
  finished boolean DEFAULT true,
  compacted boolean DEFAULT false,
  with_step boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE run_id text; company text;
BEGIN
  INSERT INTO "workflowRun"
    ("companyId", "workflowId", "workflowVersionId", "ownerId", "eventId", "sourceEventId",
     "status", "createdAt", "completedAt", "compactedAt")
  SELECT v."companyId", v."workflowId", v."id", w."createdBy", 'test.event', 'test:' || id(),
         run_status, now() - age, CASE WHEN finished THEN now() - age END,
         CASE WHEN compacted THEN now() END
  FROM "workflowVersion" v JOIN "workflow" w ON w."id" = v."workflowId" AND w."companyId" = v."companyId"
  LIMIT 1
  RETURNING id, "companyId" INTO run_id, company;
  IF with_step THEN
    INSERT INTO "workflowStepRun" ("companyId", "runId", "nodeId", "nodeType", "sequence", "status")
    VALUES (company, run_id, 'node', 'action', 1, 'Succeeded');
  END IF;
  RETURN run_id;
END;
$fn$;

CREATE FUNCTION pg_temp.expect(label text, actual boolean, expected boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

DO $proof$
DECLARE
  digest text;
  kept text;
  gone text;
BEGIN
  -- Notification digest ----------------------------------------------------
  PERFORM pg_temp.expect('digest: nothing', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('2 hours') FROM generate_series(1, 4);
  PERFORM pg_temp.expect('digest: four old', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('5 minutes') FROM generate_series(1, 5);
  PERFORM pg_temp.expect('digest: recent ones do not count', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('2 hours', read => true);
  PERFORM pg_temp.expect('digest: a read one does not count', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('2 hours', topic => 'quality');
  PERFORM pg_temp.expect('digest: another topic does not count', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('2 hours');
  PERFORM pg_temp.expect('digest: five old', util.notification_digest_has_work(), true);

  DELETE FROM "notification";
  digest := pg_temp.notify('1 day', kind => 'digest', payload => '{"count": 2}');
  PERFORM pg_temp.notify('1 day', parent => digest) FROM generate_series(1, 2);
  PERFORM pg_temp.expect('digest: a settled digest', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('2 hours');
  PERFORM pg_temp.expect('digest: one to fold in', util.notification_digest_has_work(), true);

  DELETE FROM "notification" WHERE "digestedInto" IS NULL AND "event" <> 'digest';
  PERFORM pg_temp.notify('1 day', parent => digest);
  PERFORM pg_temp.expect('digest: a stale count', util.notification_digest_has_work(), true);

  UPDATE "notification" SET "payload" = '{"count": 3}' WHERE id = digest;
  PERFORM pg_temp.expect('digest: count refreshed', util.notification_digest_has_work(), false);

  PERFORM pg_temp.notify('1 hour', kind => 'digest', payload => '{"count": 0}');
  PERFORM pg_temp.expect('digest: two digests stacked', util.notification_digest_has_work(), true);

  -- Notification purge -----------------------------------------------------
  DELETE FROM "notification";
  digest := pg_temp.notify('40 days', kind => 'digest');
  gone := pg_temp.notify('30 days 12 hours', parent => digest);
  kept := pg_temp.notify('29 days', parent => digest);
  PERFORM pg_temp.notify('32 days', read => true);
  PERFORM pg_temp.notify('30 days 12 hours', read => true);
  PERFORM pg_temp.notify('2 years');
  PERFORM util.purge_notifications();
  PERFORM pg_temp.expect('purge: old digested child', EXISTS (SELECT 1 FROM "notification" WHERE id = gone), false);
  PERFORM pg_temp.expect('purge: young digested child', EXISTS (SELECT 1 FROM "notification" WHERE id = kept), true);
  -- Left: the unread digest, its young child, the read row under 31 days, and
  -- the unread row however old.
  PERFORM pg_temp.expect('purge: what is left', (SELECT count(*) FROM "notification") = 4, true);

  -- Workflow run retention -------------------------------------------------
  PERFORM pg_temp.expect('retention: nothing', util.workflow_run_retention_has_work(), false);

  PERFORM pg_temp.run('Running', '1 hour', finished => false);
  PERFORM pg_temp.run('Succeeded', '6 days');
  PERFORM pg_temp.run('Succeeded', '8 days', compacted => true, with_step => true);
  PERFORM pg_temp.run('Succeeded', '31 days', compacted => true);
  PERFORM pg_temp.expect('retention: nothing due', util.workflow_run_retention_has_work(), false);

  PERFORM pg_temp.run('Running', '25 hours', finished => false);
  PERFORM pg_temp.expect('retention: a stale run', util.workflow_run_retention_has_work(), true);
  DELETE FROM "workflowRun" WHERE "status" = 'Running' AND "createdAt" < now() - interval '2 hours';

  -- Blocked runs never get a completedAt: their age is their creation.
  PERFORM pg_temp.run('Blocked', '8 days', finished => false);
  PERFORM pg_temp.expect('retention: to compact', util.workflow_run_retention_has_work(), true);
  DELETE FROM "workflowRun" WHERE "status" = 'Blocked';

  PERFORM pg_temp.run('Failed', '31 days', compacted => true, with_step => true);
  PERFORM pg_temp.expect('retention: step detail to drop', util.workflow_run_retention_has_work(), true);
  DELETE FROM "workflowRun" WHERE "status" = 'Failed';

  PERFORM pg_temp.run('Skipped', '91 days', compacted => true);
  PERFORM pg_temp.expect('retention: a header to purge', util.workflow_run_retention_has_work(), true);
END;
$proof$;

ROLLBACK;
