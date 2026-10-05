-- Realtime broadcast and the change log: what the triggers send and record, who
-- may join a topic, and what table_changes_since answers
-- (20261004191247_realtime-broadcast, 20261004200418_table-change-log).
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/realtime-broadcast.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL "app.sync_in_progress" = 'true';

DO $fixtures$
DECLARE
  group_id text;
  company_a text;
  company_b text;
  user_a text := gen_random_uuid()::text;
  user_b text := gen_random_uuid()::text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Realtime ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode") VALUES ('Realtime A ' || id(), group_id, 'USD') RETURNING id INTO company_a;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode") VALUES ('Realtime B ' || id(), group_id, 'USD') RETURNING id INTO company_b;
  INSERT INTO "user" (id, email) VALUES
    (user_a, user_a || '@realtime.invalid'),
    (user_b, user_b || '@realtime.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (user_a, company_a, 'employee'), (user_b, company_b, 'employee');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (user_a, jsonb_build_object('sales_view', jsonb_build_array(company_a))),
    (user_b, jsonb_build_object('sales_view', jsonb_build_array(company_b)));

  PERFORM set_config('test.company_a', company_a, true);
  PERFORM set_config('test.company_b', company_b, true);
  PERFORM set_config('test.user_a', user_a, true);
  PERFORM set_config('test.user_b', user_b, true);
END;
$fixtures$;

-- What a statement sends.
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  company_b text := current_setting('test.company_b');
  user_a text := current_setting('test.user_a');
  user_b text := current_setting('test.user_b');
  item_topic text := 'company:' || company_a || ':item';
  base int;
  sent int;
  message jsonb;
  customer_id text;
BEGIN
  -- Creating the second company of a group already wrote intercompany partners
  -- into this one, so every count below is relative to this point.
  SELECT count(*) INTO base FROM realtime.messages WHERE topic = 'company:' || company_a || ':customer';

  -- INSERT: one message, the new id, on the company's topic for the table.
  INSERT INTO "customer" (name, "companyId", "readableId", "accountManagerId") VALUES ('Realtime customer', company_a, 'RT-0', user_a) RETURNING id INTO customer_id;
  SELECT count(*) - base INTO sent FROM realtime.messages WHERE topic = 'company:' || company_a || ':customer';
  SELECT payload INTO message FROM realtime.messages
  WHERE topic = 'company:' || company_a || ':customer' AND payload->'ids' = jsonb_build_array(customer_id);
  IF sent <> 1 OR message->>'op' <> 'INSERT' OR message->'ids' <> jsonb_build_array(customer_id)
     OR message->>'table' <> 'customer' OR message ? 'name' THEN
    RAISE EXCEPTION 'FAIL: customer INSERT sent % message(s): %', sent, message;
  END IF;
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic = 'company:' || company_b || ':customer' AND payload->'ids' ? customer_id) THEN
    RAISE EXCEPTION 'FAIL: a write in company A reached company B''s topic';
  END IF;
  -- The message names the records the row belongs to: each foreign key
  -- "<name>Id" column that holds a value, so a client can filter on one
  -- (`quoteLineId=eq.…`).
  IF message->'parents'->'accountManagerId' <> jsonb_build_array(user_a) OR message->'parents' ? 'companyId' THEN
    RAISE EXCEPTION 'FAIL: customer INSERT did not name its foreign keys: %', message;
  END IF;
  -- A column that only ends in "Id" is the row's own data and is not sent.
  IF message->'parents' ? 'readableId' OR message::text LIKE '%RT-0%' THEN
    RAISE EXCEPTION 'FAIL: customer INSERT sent the customer number: %', message;
  END IF;
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic LIKE 'company:' || company_a || ':%' AND NOT private) THEN
    RAISE EXCEPTION 'FAIL: a broadcast was sent on a public topic';
  END IF;

  -- UPDATE that changes only bookkeeping columns: nothing.
  UPDATE "customer" SET "updatedAt" = now(), "updatedBy" = user_a WHERE id = customer_id;
  SELECT count(*) - base INTO sent FROM realtime.messages WHERE topic = 'company:' || company_a || ':customer';
  IF sent <> 1 THEN
    RAISE EXCEPTION 'FAIL: an updatedAt-only UPDATE sent a message';
  END IF;

  -- A real UPDATE, then a DELETE: one message each.
  UPDATE "customer" SET name = 'Realtime customer 2', "accountManagerId" = user_b WHERE id = customer_id;
  -- A row moved to another parent names the one it left as well as the one it joined.
  SELECT payload INTO message FROM realtime.messages
  WHERE topic = 'company:' || company_a || ':customer' AND payload->>'op' = 'UPDATE'
    AND payload->'ids' = jsonb_build_array(customer_id)
  ORDER BY inserted_at DESC LIMIT 1;
  IF NOT (message->'parents'->'accountManagerId' @> jsonb_build_array(user_a, user_b)) THEN
    RAISE EXCEPTION 'FAIL: an UPDATE did not name the old and the new parent: %', message;
  END IF;

  DELETE FROM "customer" WHERE id = customer_id;
  SELECT count(*) - base INTO sent FROM realtime.messages WHERE topic = 'company:' || company_a || ':customer';
  IF sent <> 3 THEN
    RAISE EXCEPTION 'FAIL: INSERT + UPDATE + DELETE sent % messages, expected 3', sent;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM realtime.messages
    WHERE topic = 'company:' || company_a || ':customer'
      AND payload->>'op' = 'DELETE' AND payload->'ids' = jsonb_build_array(customer_id)
  ) THEN
    RAISE EXCEPTION 'FAIL: DELETE did not carry the deleted id';
  END IF;

  -- One statement, many rows, two companies: one message per company, and no ids past 100.
  INSERT INTO "customer" (name, "companyId", "readableId")
  SELECT 'Bulk ' || n, CASE WHEN n <= 150 THEN company_a ELSE company_b END, 'RT-' || n
  FROM generate_series(1, 152) n;
  SELECT count(*) INTO sent FROM realtime.messages
  WHERE topic = 'company:' || company_a || ':customer' AND payload->>'op' = 'INSERT' AND payload->'ids' = 'null'::jsonb
    AND payload->'parents' = 'null'::jsonb;
  IF sent <> 1 THEN
    RAISE EXCEPTION 'FAIL: a 150-row INSERT did not send exactly one "resync" message without ids or parents';
  END IF;
  SELECT count(*) INTO sent FROM realtime.messages
  WHERE topic = 'company:' || company_b || ':customer' AND jsonb_array_length(payload->'ids') = 2;
  IF sent <> 1 THEN
    RAISE EXCEPTION 'FAIL: company B''s 2 rows of the same statement did not arrive as one message with 2 ids';
  END IF;

  -- A reference table goes to the shared topic, without ids.
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy") VALUES ('RT', 'Realtime unit', company_a, user_a);
  SELECT count(*), max(payload::text)::jsonb INTO sent, message
  FROM realtime.messages WHERE topic = 'company:' || company_a || ':reference';
  IF sent <> 1 OR message->>'table' <> 'unitOfMeasure' OR message ? 'ids' THEN
    RAISE EXCEPTION 'FAIL: unitOfMeasure INSERT sent % reference message(s): %', sent, message;
  END IF;

  -- A notification goes to its user, not to the company.
  INSERT INTO "notification" ("userId", "companyId", topic, event, title)
  VALUES (user_a, company_a, 'test', 'test', 'Realtime notification');
  SELECT count(*) INTO sent FROM realtime.messages WHERE topic = 'user:' || user_a || ':notification';
  IF sent <> 1 THEN
    RAISE EXCEPTION 'FAIL: notification INSERT sent % user message(s)', sent;
  END IF;
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic = 'company:' || company_a || ':notification') THEN
    RAISE EXCEPTION 'FAIL: a notification was broadcast to the whole company';
  END IF;
END;
$$;

-- Who may join a topic. Realtime sets realtime.topic and reads realtime.messages
-- as the joining user; a visible row means the join is allowed.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  visible int;
BEGIN
  PERFORM set_config('realtime.topic', 'company:' || current_setting('test.company_a') || ':customer', true);
  SELECT count(*) INTO visible FROM realtime.messages;
  IF visible = 0 THEN
    RAISE EXCEPTION 'FAIL: an employee cannot join their own company''s topic';
  END IF;

  PERFORM set_config('realtime.topic', 'company:' || current_setting('test.company_b') || ':customer', true);
  SELECT count(*) INTO visible FROM realtime.messages;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: an employee of company A can join company B''s topic';
  END IF;

  PERFORM set_config('realtime.topic', 'user:' || current_setting('test.user_a') || ':notification', true);
  SELECT count(*) INTO visible FROM realtime.messages;
  IF visible = 0 THEN
    RAISE EXCEPTION 'FAIL: a user cannot join their own notification topic';
  END IF;

  PERFORM set_config('realtime.topic', 'user:' || current_setting('test.user_b') || ':notification', true);
  SELECT count(*) INTO visible FROM realtime.messages;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: a user can join another user''s notification topic';
  END IF;

  PERFORM set_config('realtime.topic', 'something-else', true);
  SELECT count(*) INTO visible FROM realtime.messages;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: a topic outside company:/user: is readable';
  END IF;
END;
$$;

-- The change log: what the list handlers record, and what a reader gets back.
RESET ROLE;
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  company_b text := current_setting('test.company_b');
  user_a text := current_setting('test.user_a');
  logged int;
BEGIN
  -- The writes above: the single customer (INSERT, a real UPDATE, DELETE — the
  -- updatedAt-only UPDATE logs nothing) and the 150-row statement, which is one
  -- "read it again" row.
  SELECT count(*) INTO logged FROM "tableChange"
  WHERE "companyId" = company_a AND "table" = 'customer' AND "rowId" LIKE 'cust_%'
    AND "rowId" NOT IN (SELECT id FROM customer);
  IF logged <> 3 THEN
    RAISE EXCEPTION 'FAIL: the deleted customer has % log rows, expected 3 (insert, update, delete)', logged;
  END IF;
  SELECT count(*) INTO logged FROM "tableChange"
  WHERE "companyId" = company_a AND "table" = 'customer' AND "rowId" IS NULL;
  IF logged <> 1 THEN
    RAISE EXCEPTION 'FAIL: a 150-row INSERT logged % "read it again" rows, expected 1', logged;
  END IF;
  SELECT count(*) INTO logged FROM "tableChange" c
  WHERE c."companyId" = company_b AND c."table" = 'customer'
    AND c."rowId" IN (SELECT id FROM customer WHERE name LIKE 'Bulk %');
  IF logged <> 2 THEN
    RAISE EXCEPTION 'FAIL: company B''s 2 rows of the bulk statement logged % rows', logged;
  END IF;
  -- A table with no log handler records nothing.
  IF EXISTS (SELECT 1 FROM "tableChange" WHERE "table" = 'unitOfMeasure') THEN
    RAISE EXCEPTION 'FAIL: a table without the log handler was logged';
  END IF;

  -- A person's name lives on "user": the change is logged for their company's people list.
  UPDATE "user" SET "firstName" = 'Renamed' WHERE id = user_a;
  IF NOT EXISTS (
    SELECT 1 FROM "tableChange"
    WHERE "companyId" = company_a AND "table" = 'employee' AND "rowId" = user_a
  ) THEN
    RAISE EXCEPTION 'FAIL: renaming a user did not log a change to their company''s people';
  END IF;
  IF EXISTS (SELECT 1 FROM "tableChange" WHERE "companyId" = company_b AND "rowId" = user_a) THEN
    RAISE EXCEPTION 'FAIL: a user''s rename was logged for a company they are not in';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  company_b text := current_setting('test.company_b');
  first jsonb;
  next jsonb;
BEGIN
  -- The table itself is not readable through the API.
  IF EXISTS (SELECT 1 FROM "tableChange") THEN
    RAISE EXCEPTION 'FAIL: tableChange is readable as an authenticated user';
  END IF;

  -- No cursor: fetch everything, and here is a cursor.
  first := table_changes_since(company_a);
  IF NOT (first->>'reset')::boolean OR first->'changes' <> '{}'::jsonb
     OR first->>'xid' IS NULL OR first->>'epoch' IS NULL OR first->>'at' IS NULL THEN
    RAISE EXCEPTION 'FAIL: a first call did not answer reset with a cursor: %', first;
  END IF;

  -- With the cursor: the changes of this company only. The customer table is
  -- "read it again" (the bulk statement); people lists the renamed user.
  next := table_changes_since(company_a, first->>'xid', first->>'epoch', (first->>'at')::timestamptz);
  IF (next->>'reset')::boolean THEN
    RAISE EXCEPTION 'FAIL: a fresh cursor was answered with reset';
  END IF;
  IF next->'changes'->'customer' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: customer should be "read it again" after a 150-row statement: %', next->'changes'->'customer';
  END IF;
  IF NOT (next->'changes'->'employee' ? current_setting('test.user_a')) THEN
    RAISE EXCEPTION 'FAIL: the renamed user is missing from the changes: %', next->'changes';
  END IF;

  -- A cursor from before a restart, and one older than the retention, both reset.
  IF NOT (table_changes_since(company_a, first->>'xid', 'another-epoch', (first->>'at')::timestamptz)->>'reset')::boolean THEN
    RAISE EXCEPTION 'FAIL: a cursor from another server epoch was not reset';
  END IF;
  IF NOT (table_changes_since(company_a, first->>'xid', first->>'epoch', now() - interval '6 days 1 hour')->>'reset')::boolean THEN
    RAISE EXCEPTION 'FAIL: a cursor older than the retention margin was not reset';
  END IF;

  -- Another company's log is refused outright.
  BEGIN
    PERFORM table_changes_since(company_b);
    RAISE EXCEPTION 'FAIL: read another company''s change log';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- A crash empties the log and its epoch together (both are UNLOGGED). Until
-- the purge writes a new epoch every cursor is answered with reset, and a
-- cursor issued under the old epoch is reset afterwards as well.
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  before jsonb;
  during jsonb;
  after jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_a'), 'role', 'authenticated')::text, true);
  before := table_changes_since(company_a);
  IF (table_changes_since(company_a, before->>'xid', before->>'epoch', (before->>'at')::timestamptz)->>'reset')::boolean THEN
    RAISE EXCEPTION 'FAIL: a fresh cursor was answered with reset';
  END IF;

  DELETE FROM util."tableChangeEpoch";
  DELETE FROM "tableChange";
  during := table_changes_since(company_a, before->>'xid', before->>'epoch', (before->>'at')::timestamptz);
  IF NOT (during->>'reset')::boolean OR during->>'epoch' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an emptied log was not answered with reset: %', during;
  END IF;
  IF NOT (table_changes_since(company_a, during->>'xid', during->>'epoch', (during->>'at')::timestamptz)->>'reset')::boolean THEN
    RAISE EXCEPTION 'FAIL: a cursor issued without an epoch was trusted';
  END IF;

  PERFORM util.purge_table_changes();
  after := table_changes_since(company_a, before->>'xid', before->>'epoch', (before->>'at')::timestamptz);
  IF NOT (after->>'reset')::boolean OR after->>'epoch' IS NULL OR after->>'epoch' = before->>'epoch' THEN
    RAISE EXCEPTION 'FAIL: the purge did not start a new epoch: %', after;
  END IF;
END;
$$;

\echo realtime-broadcast: all checks passed
ROLLBACK;
