-- get_traveler_target (spec .ai/specs/2026-11-12-serial-traveler-line-flow.md, S3).
-- Run from the repository root against a local database that has at least
-- one company with an employee user:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/traveler-target.test.sql
-- Every fixture row is confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect(label text, actual text, expected text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END;
$fn$;

CREATE FUNCTION pg_temp.unit(p_company text, p_user text, p_status text, p_attributes jsonb)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_id text;
BEGIN
  INSERT INTO "trackedEntity" (
    "quantity", "status", "sourceDocument", "sourceDocumentId",
    "attributes", "companyId", "createdBy"
  ) VALUES (
    1, p_status::"trackedEntityStatus", 'Job', 'traveler-target-test',
    p_attributes, p_company, p_user
  )
  RETURNING "id" INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE FUNCTION pg_temp.edge(
  p_company text, p_user text, p_type text,
  p_input text, p_output text, p_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_activity text := gen_random_uuid()::text;
BEGIN
  INSERT INTO "trackedActivity" ("id", "type", "companyId", "createdBy", "createdAt")
  VALUES (v_activity, p_type, p_company, p_user, p_at);
  INSERT INTO "trackedActivityInput" ("trackedActivityId", "trackedEntityId", "quantity", "companyId", "createdBy")
  VALUES (v_activity, p_input, 1, p_company, p_user);
  INSERT INTO "trackedActivityOutput" ("trackedActivityId", "trackedEntityId", "quantity", "companyId", "createdBy")
  VALUES (v_activity, p_output, 1, p_company, p_user);
END;
$fn$;

DO $proof$
DECLARE
  company text;
  usr text;
  a text; b text; c text;
  e text; f text; g text;
  h text; k text;
  x text; y text;
  r record;
BEGIN
  SELECT uc."companyId", uc."userId" INTO company, usr
  FROM "userToCompany" uc
  WHERE uc."role" = 'employee'
  LIMIT 1;
  IF company IS NULL THEN
    RAISE EXCEPTION 'traveler-target: no company with an employee user';
  END IF;

  -- 1. Two levels: A went into B, B went into C (in a job).
  a := pg_temp.unit(company, usr, 'Consumed', '{}');
  b := pg_temp.unit(company, usr, 'Consumed', '{}');
  c := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-1", "Job Make Method": "jmm-1"}');
  PERFORM pg_temp.edge(company, usr, 'Consume', a, b, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', b, c, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(a, company);
  PERFORM pg_temp.expect('two levels: unit', r."trackedEntityId", c);
  PERFORM pg_temp.expect('two levels: depth', r."depth"::text, '2');
  PERFORM pg_temp.expect('two levels: status', r."status"::text, 'Reserved');
  PERFORM pg_temp.expect('two levels: job', r."jobId", 'job-1');
  PERFORM pg_temp.expect('two levels: make method', r."jobMakeMethodId", 'jmm-1');

  -- 2. Given back, then issued again: E into F, F gives E back, E into G.
  e := pg_temp.unit(company, usr, 'Consumed', '{}');
  f := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-2"}');
  g := pg_temp.unit(company, usr, 'Reserved', '{"Job": "job-3"}');
  PERFORM pg_temp.edge(company, usr, 'Consume', e, f, now() - interval '3 hours');
  PERFORM pg_temp.edge(company, usr, 'Unconsume', f, e, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', e, g, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(e, company);
  PERFORM pg_temp.expect('re-issue: unit', r."trackedEntityId", g);
  PERFORM pg_temp.expect('re-issue: job', r."jobId", 'job-3');

  -- 3. Given back and not issued again: the walk stays on H.
  h := pg_temp.unit(company, usr, 'Consumed', '{}');
  k := pg_temp.unit(company, usr, 'Reserved', '{}');
  PERFORM pg_temp.edge(company, usr, 'Consume', h, k, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Unconsume', k, h, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(h, company);
  PERFORM pg_temp.expect('given back: unit', r."trackedEntityId", h);
  PERFORM pg_temp.expect('given back: depth', r."depth"::text, '0');

  -- 4. A unit that is not Consumed returns itself.
  SELECT * INTO r FROM get_traveler_target(c, company);
  PERFORM pg_temp.expect('not consumed: unit', r."trackedEntityId", c);
  PERFORM pg_temp.expect('not consumed: depth', r."depth"::text, '0');

  -- 5. A loop stops after 20 steps.
  x := pg_temp.unit(company, usr, 'Consumed', '{}');
  y := pg_temp.unit(company, usr, 'Consumed', '{}');
  PERFORM pg_temp.edge(company, usr, 'Consume', x, y, now() - interval '2 hours');
  PERFORM pg_temp.edge(company, usr, 'Consume', y, x, now() - interval '1 hour');
  SELECT * INTO r FROM get_traveler_target(x, company);
  PERFORM pg_temp.expect('loop: depth', r."depth"::text, '20');

  -- 6. No row for an unknown unit or another company.
  PERFORM pg_temp.expect('unknown unit',
    (SELECT count(*) FROM get_traveler_target('no-such-unit', company))::text, '0');
  PERFORM pg_temp.expect('other company',
    (SELECT count(*) FROM get_traveler_target(a, 'no-such-company'))::text, '0');

  RAISE NOTICE 'traveler-target: all checks passed';
END
$proof$;

ROLLBACK;
