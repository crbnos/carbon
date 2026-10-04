-- Realtime broadcast: what the triggers send, who may join a topic, and what
-- list_checksums sees (20261004191247_realtime-broadcast, 20261004192633_realtime-broadcast-attach).
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
  INSERT INTO "customer" (name, "companyId", "readableId") VALUES ('Realtime customer', company_a, 'RT-0') RETURNING id INTO customer_id;
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
  UPDATE "customer" SET name = 'Realtime customer 2' WHERE id = customer_id;
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
  WHERE topic = 'company:' || company_a || ':customer' AND payload->>'op' = 'INSERT' AND payload->'ids' = 'null'::jsonb;
  IF sent <> 1 THEN
    RAISE EXCEPTION 'FAIL: a 150-row INSERT did not send exactly one "resync" message';
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

-- list_checksums hashes only what the caller can read, and follows the data.
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  company_b text := current_setting('test.company_b');
  empty text := md5('');
  before text;
  after text;
BEGIN
  IF (SELECT count(*) FROM list_checksums(company_a)) <> 5 THEN
    RAISE EXCEPTION 'FAIL: list_checksums did not return the 5 lists';
  END IF;
  SELECT checksum INTO before FROM list_checksums(company_a) WHERE list = 'customers';
  IF before = empty THEN
    RAISE EXCEPTION 'FAIL: company A''s customers hash as an empty list';
  END IF;
  -- Company B has customers too, but this user cannot read them.
  SELECT checksum INTO after FROM list_checksums(company_b) WHERE list = 'customers';
  IF after <> empty THEN
    RAISE EXCEPTION 'FAIL: list_checksums hashed rows of a company the caller is not in';
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE
  company_a text := current_setting('test.company_a');
  h0 text; h1 text; h2 text;
BEGIN
  SELECT checksum INTO h0 FROM list_checksums(company_a) WHERE list = 'customers';
  UPDATE "customer" SET name = 'Renamed' WHERE "companyId" = company_a AND name = 'Bulk 1';
  SELECT checksum INTO h1 FROM list_checksums(company_a) WHERE list = 'customers';
  DELETE FROM "customer" WHERE "companyId" = company_a AND name = 'Bulk 2';
  SELECT checksum INTO h2 FROM list_checksums(company_a) WHERE list = 'customers';
  IF h0 = h1 OR h1 = h2 THEN
    RAISE EXCEPTION 'FAIL: the customers checksum did not change after a rename and a delete';
  END IF;
END;
$$;

\echo realtime-broadcast: all checks passed
ROLLBACK;
