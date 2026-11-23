-- The statement handler `queue_pmi_inspection_plans` on `item`
-- (packages/database/src/event-system/handlers/queue_pmi_inspection_plans.sql):
-- an item that starts using a model whose PMI was already read asks for an
-- inspection plan made from it (`carbon/pmi-inspection-plan`).
-- Run from the repository root against an existing local database that has at
-- least one company with a user and the Vault secret `inngest_event_url`
-- (`crbn up` sets it):
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/pmi-inspection-plans.test.sql
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

-- One model of the test company, loaded the way a sync loads it so the model
-- pipeline's own handler stays quiet.
CREATE FUNCTION pg_temp.model(pmi boolean) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE new_id text;
BEGIN
  PERFORM set_config('app.sync_in_progress', 'true', true);
  INSERT INTO "modelUpload" ("companyId", "createdBy", "modelPath", "pmiPath")
  SELECT uc."companyId", uc."userId", uc."companyId" || '/models/test.step',
         CASE WHEN pmi THEN uc."companyId" || '/models/test/pmi.json' END
  FROM "userToCompany" uc ORDER BY uc."companyId", uc."userId" LIMIT 1
  RETURNING id INTO new_id;
  PERFORM set_config('app.sync_in_progress', 'false', true);
  RETURN new_id;
END;
$fn$;

-- One part of the test company, on `model_id` (null for none).
CREATE FUNCTION pg_temp.item(model_id text, sync boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE new_id text;
BEGIN
  PERFORM set_config('app.sync_in_progress', sync::text, true);
  INSERT INTO "item" ("companyId", "createdBy", "readableId", "name", "type", "itemTrackingType", "modelUploadId")
  SELECT uc."companyId", uc."userId", 'PMI-TEST-' || gen_random_uuid(), 'PMI test', 'Part', 'Inventory', model_id
  FROM "userToCompany" uc ORDER BY uc."companyId", uc."userId" LIMIT 1
  RETURNING id INTO new_id;
  PERFORM set_config('app.sync_in_progress', 'false', true);
  RETURN new_id;
END;
$fn$;

-- The `carbon/pmi-inspection-plan` events queued for one item.
CREATE FUNCTION pg_temp.sent(item_id text) RETURNS bigint LANGUAGE sql AS $fn$
  SELECT count(*) FROM net.http_request_queue
  WHERE convert_from(body, 'UTF8')::jsonb ->> 'name' = 'carbon/pmi-inspection-plan'
    AND convert_from(body, 'UTF8')::jsonb -> 'data' ->> 'itemId' = item_id;
$fn$;

DO $test$
DECLARE
  with_pmi text; without_pmi text;
  created text; plain text; synced text; linked text; moved text;
BEGIN
  with_pmi := pg_temp.model(true);
  without_pmi := pg_temp.model(false);

  -- INSERT: a new item (a revision, a converted line) already on a PMI model.
  created := pg_temp.item(with_pmi);
  PERFORM pg_temp.expect('insert: on a model with PMI', pg_temp.sent(created), 1::bigint);

  plain := pg_temp.item(without_pmi);
  PERFORM pg_temp.expect('insert: on a model without PMI', pg_temp.sent(plain), 0::bigint);

  synced := pg_temp.item(with_pmi, sync => true);
  PERFORM pg_temp.expect('insert: a synced row', pg_temp.sent(synced), 0::bigint);

  -- UPDATE: only a change of model asks, and only for a model with PMI.
  linked := pg_temp.item(NULL);
  UPDATE "item" SET "modelUploadId" = with_pmi WHERE id = linked;
  PERFORM pg_temp.expect('update: linked to a PMI model', pg_temp.sent(linked), 1::bigint);

  UPDATE "item" SET "name" = 'Renamed' WHERE id = linked;
  PERFORM pg_temp.expect('update: model unchanged', pg_temp.sent(linked), 1::bigint);

  moved := pg_temp.item(with_pmi);
  UPDATE "item" SET "modelUploadId" = without_pmi WHERE id = moved;
  PERFORM pg_temp.expect('update: moved to a model without PMI', pg_temp.sent(moved), 1::bigint);

  RAISE NOTICE 'pmi-inspection-plans: all checks passed';
END;
$test$;

ROLLBACK;
