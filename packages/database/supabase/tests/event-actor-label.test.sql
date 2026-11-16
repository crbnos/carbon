-- The actor label a change with no user behind it carries into the audit log
-- (dispatch_event_batch):
--
--   app.actor_label set in the transaction        -> AUDIT metadata.actorLabel
--   x-carbon-actor header on a service-role call  -> AUDIT metadata.actorLabel
--   the same header on any other caller           -> ignored
--   any other handler type                        -> config unchanged
--
-- The probe is a temp table shadowing "employee" (same columns and key, no
-- foreign keys), so no fixtures are needed and no real row is touched.
--
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/event-actor-label.test.sql
-- Everything is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = warning;

DO $proof$
DECLARE
  company text;
  audit_label text;
  audit_has_metadata boolean;
  webhook_config jsonb;
  step int := 0;
BEGIN
  SELECT "id" INTO company FROM "company" ORDER BY "id" LIMIT 1;
  ASSERT company IS NOT NULL, 'the local database has a company';

  CREATE TEMP TABLE queued_before ON COMMIT DROP AS
    SELECT msg_id FROM pgmq.q_event_system;

  CREATE TEMP TABLE "employee"
    (LIKE public."employee" INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP;
  CREATE TRIGGER probe_ins AFTER INSERT ON pg_temp."employee"
    REFERENCING NEW TABLE AS batched_new
    FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_event_batch();

  INSERT INTO "eventSystemSubscription"
    ("name", "companyId", "table", "operations", "handlerType", "config", "filter", "active")
  VALUES
    ('actor-label-audit', company, 'employee', ARRAY['INSERT'], 'AUDIT',
     '{"probe":"actor-label"}', '{}', TRUE),
    ('actor-label-webhook', company, 'employee', ARRAY['INSERT'], 'WEBHOOK',
     '{"url":"http://actor-label-probe.invalid"}', '{}', TRUE);

  -- One insert per case; each reads back the messages for its own row id.
  CREATE TEMP TABLE cases (id text, expected text) ON COMMIT DROP;

  -- 1. No label at all.
  INSERT INTO pg_temp."employee" ("id", "companyId", "employeeTypeId")
    VALUES ('probe-none', company, 'probe-type');
  INSERT INTO cases VALUES ('probe-none', NULL);

  -- 2. A server transaction sets the label.
  PERFORM set_config('app.actor_label', 'SCIM', true);
  INSERT INTO pg_temp."employee" ("id", "companyId", "employeeTypeId")
    VALUES ('probe-setting', company, 'probe-type');
  INSERT INTO cases VALUES ('probe-setting', 'SCIM');
  PERFORM set_config('app.actor_label', '', true);

  -- 3. The header from a signed-in user is not trusted.
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  PERFORM set_config('request.headers', '{"x-carbon-actor":"SCIM"}', true);
  INSERT INTO pg_temp."employee" ("id", "companyId", "employeeTypeId")
    VALUES ('probe-user-header', company, 'probe-type');
  INSERT INTO cases VALUES ('probe-user-header', NULL);

  -- 4. The header from the service role is.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO pg_temp."employee" ("id", "companyId", "employeeTypeId")
    VALUES ('probe-service-header', company, 'probe-type');
  INSERT INTO cases VALUES ('probe-service-header', 'SCIM');

  FOR step IN 1..4 LOOP
    DECLARE
      probe text := (SELECT id FROM cases ORDER BY id OFFSET step - 1 LIMIT 1);
      expected text := (SELECT c.expected FROM cases c WHERE c.id = probe);
    BEGIN
      SELECT message->'handlerConfig'->'metadata'->>'actorLabel',
             message->'handlerConfig' ? 'metadata'
        INTO audit_label, audit_has_metadata
      FROM pgmq.q_event_system
      WHERE msg_id NOT IN (SELECT msg_id FROM queued_before)
        AND message->>'handlerType' = 'AUDIT'
        AND message->'handlerConfig'->>'probe' = 'actor-label'
        AND message->'event'->>'recordId' = probe;
      ASSERT FOUND, format('%s: no AUDIT message was queued', probe);
      ASSERT audit_label IS NOT DISTINCT FROM expected,
        format('%s: AUDIT actorLabel is %s, expected %s', probe, audit_label, expected);
      ASSERT expected IS NOT NULL OR NOT audit_has_metadata,
        format('%s: AUDIT config gained metadata with no label', probe);

      SELECT message->'handlerConfig' INTO webhook_config
      FROM pgmq.q_event_system
      WHERE msg_id NOT IN (SELECT msg_id FROM queued_before)
        AND message->>'handlerType' = 'WEBHOOK'
        AND message->'handlerConfig'->>'url' = 'http://actor-label-probe.invalid'
        AND message->'event'->>'recordId' = probe;
      ASSERT webhook_config = '{"url":"http://actor-label-probe.invalid"}'::jsonb,
        format('%s: WEBHOOK config changed to %s', probe, webhook_config);
    END;
  END LOOP;

  RAISE NOTICE 'event-actor-label: 4 cases passed';
END
$proof$;

ROLLBACK;
