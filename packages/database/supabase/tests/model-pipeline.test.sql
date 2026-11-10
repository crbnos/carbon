-- The model pipeline's two database parts: the statement handler
-- `queue_model_pipeline` that starts every new model
-- (20261017065919_model-pipeline-start.sql) and its backstop
-- `util.reap_model_pipeline` (20261017070014_model-pipeline-reaper.sql).
-- Run from the repository root against an existing local database that has at
-- least one company with a user and the Vault secret `inngest_event_url`
-- (`crbn up` sets it):
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/model-pipeline.test.sql
-- A sent event is a row in `net.http_request_queue`. pg_net reads that table
-- only after a commit, and everything here is rolled back, so nothing is sent.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual anyelement, expected anyelement)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

-- One model of the test company. `sync` skips the statement handler, the way a
-- seed or a restore loads rows.
CREATE FUNCTION pg_temp.model(
  age interval,
  optimize text DEFAULT 'Idle',
  processing text DEFAULT 'Idle',
  path text DEFAULT NULL,
  sync boolean DEFAULT true
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE new_id text;
BEGIN
  PERFORM set_config('app.sync_in_progress', sync::text, true);
  INSERT INTO "modelUpload"
    ("companyId", "createdBy", "modelPath", "optimizeStatus", "processingStatus", "createdAt", "updatedAt")
  SELECT uc."companyId", uc."userId", COALESCE(path, uc."companyId" || '/models/test.step'),
         optimize::"modelProcessingStatus", processing::"modelProcessingStatus",
         now() - age, now() - age
  FROM "userToCompany" uc ORDER BY uc."companyId", uc."userId" LIMIT 1
  RETURNING id INTO new_id;
  PERFORM set_config('app.sync_in_progress', 'false', true);
  RETURN new_id;
END;
$fn$;

-- The `carbon/model-optimize` events queued for one model.
CREATE FUNCTION pg_temp.sent(model_id text) RETURNS bigint LANGUAGE sql AS $fn$
  SELECT count(*) FROM net.http_request_queue
  WHERE convert_from(body, 'UTF8')::jsonb ->> 'name' = 'carbon/model-optimize'
    AND convert_from(body, 'UTF8')::jsonb -> 'data' ->> 'modelUploadId' = model_id;
$fn$;

DO $test$
DECLARE
  fresh text; synced text; template text;
  stuck_optimize text; recent_optimize text; stuck_conversion text;
  lost text; too_new text; too_old text; started text; template_lost text;
BEGIN
  -- The statement handler starts each new model once.
  fresh := pg_temp.model('0 minutes', sync => false);
  PERFORM pg_temp.expect('start: a new model', pg_temp.sent(fresh), 1::bigint);

  synced := pg_temp.model('0 minutes', sync => true);
  PERFORM pg_temp.expect('start: a synced row', pg_temp.sent(synced), 0::bigint);

  template := pg_temp.model('0 minutes', path => '_templates/satellite/models/a.glb', sync => false);
  PERFORM pg_temp.expect('start: bundled demo artwork', pg_temp.sent(template), 0::bigint);

  -- The reaper fails jobs stuck for 8 hours and resends a lost start once.
  stuck_optimize := pg_temp.model('9 hours', optimize => 'Processing');
  recent_optimize := pg_temp.model('7 hours', optimize => 'Queued');
  stuck_conversion := pg_temp.model('9 hours', processing => 'Queued');
  lost := pg_temp.model('45 minutes');
  too_new := pg_temp.model('10 minutes');
  too_old := pg_temp.model('2 hours');
  started := pg_temp.model('45 minutes', optimize => 'Queued');
  template_lost := pg_temp.model('45 minutes', path => '_templates/satellite/models/b.glb');

  PERFORM util.reap_model_pipeline();

  PERFORM pg_temp.expect('reap: optimise stuck 9 hours',
    (SELECT "optimizeStatus"::text FROM "modelUpload" WHERE id = stuck_optimize), 'Failed');
  PERFORM pg_temp.expect('reap: optimise queued 7 hours',
    (SELECT "optimizeStatus"::text FROM "modelUpload" WHERE id = recent_optimize), 'Queued');
  PERFORM pg_temp.expect('reap: conversion stuck 9 hours',
    (SELECT "processingStatus"::text FROM "modelUpload" WHERE id = stuck_conversion), 'Failed');

  PERFORM pg_temp.expect('resend: Idle 45 minutes', pg_temp.sent(lost), 1::bigint);
  PERFORM pg_temp.expect('resend: Idle 10 minutes', pg_temp.sent(too_new), 0::bigint);
  PERFORM pg_temp.expect('resend: Idle 2 hours', pg_temp.sent(too_old), 0::bigint);
  PERFORM pg_temp.expect('resend: already started', pg_temp.sent(started), 0::bigint);
  PERFORM pg_temp.expect('resend: bundled demo artwork', pg_temp.sent(template_lost), 0::bigint);

  RAISE NOTICE 'model-pipeline: all checks passed';
END;
$test$;

ROLLBACK;
