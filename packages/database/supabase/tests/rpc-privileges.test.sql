-- Tenant isolation for functions reachable at /rest/v1/rpc (20260925121735_rpc-function-guards),
-- and console PINs out of the API's reach (20260926141957_employee-pin).
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/rpc-privileges.test.sql
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
  user_c text := gen_random_uuid()::text;
  group_b text := gen_random_uuid()::text;
  raw_key text := 'crbn_rpc_privileges_' || gen_random_uuid()::text;
  perms jsonb;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('RPC privileges ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode") VALUES ('RPC A ' || id(), group_id, 'USD') RETURNING id INTO company_a;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode") VALUES ('RPC B ' || id(), group_id, 'USD') RETURNING id INTO company_b;
  INSERT INTO "user" (id, email) VALUES
    (user_a, user_a || '@rpc-privileges.invalid'),
    (user_b, user_b || '@rpc-privileges.invalid'),
    (user_c, user_c || '@rpc-privileges.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (user_a, company_a, 'employee'), (user_b, company_b, 'employee'), (user_c, company_a, 'employee');
  SELECT jsonb_object_agg(p, jsonb_build_array(company_a)) INTO perms
  FROM unnest(ARRAY['sales_view', 'sales_create', 'inventory_view', 'users_view']) p;
  -- user_c can edit users but not view them: the permission editor's shape.
  INSERT INTO "userPermission" (id, permissions) VALUES
    (user_a, perms), (user_b, '{}'::jsonb),
    (user_c, jsonb_build_object('users_update', jsonb_build_array(company_a)));
  INSERT INTO "group" (id, name, "companyId") VALUES (group_b, 'RPC privileges B', company_b);
  INSERT INTO "membership" ("groupId", "memberUserId") VALUES (group_b, user_b);
  INSERT INTO "apiKey" (name, "companyId", "createdBy", "keyHash", scopes)
  VALUES ('RPC privileges', company_a, user_a, encode(digest(raw_key::bytea, 'sha256'), 'hex'),
          jsonb_build_object('inventory_view', jsonb_build_array(company_a)));

  PERFORM set_config('test.company_a', company_a, true);
  PERFORM set_config('test.company_b', company_b, true);
  PERFORM set_config('test.user_a', user_a, true);
  PERFORM set_config('test.user_b', user_b, true);
  PERFORM set_config('test.user_c', user_c, true);
  PERFORM set_config('test.group_b', group_b, true);
  PERFORM set_config('test.raw_key', raw_key, true);
END;
$fixtures$;

-- Never REVOKE EXECUTE here: on this image a call to a revoked function
-- segfaults the backend (20260924192316). Internal functions are SECURITY
-- INVOKER instead, and only the dispatchers that call them run as the owner.
DO $$
DECLARE
  definer_interceptors text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ') INTO definer_interceptors
  FROM pg_trigger t
  JOIN pg_proc d ON d.oid = t.tgfoid AND d.proname LIKE 'dispatch_event%'
  CROSS JOIN LATERAL unnest(string_to_array(encode(t.tgargs, 'escape'), E'\\000')) a(fname)
  JOIN pg_proc p ON p.proname = a.fname AND p.pronamespace = 'public'::regnamespace
  WHERE p.prosecdef AND p.prosrc !~* 'current_setting\(\s*''role''';
  IF definer_interceptors IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: event interceptors callable through the API as the owner: %', definer_interceptors;
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'create_rfq_from_model_v1(text,text,text,text,text,text,json)'::regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'backflush_job_materials(text,numeric,text,text)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'dispatch_event_interceptors()'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'dispatch_event_after_interceptors()'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL: internal functions or dispatchers have the wrong security mode';
  END IF;
END;
$$;

-- Anonymous: no access to any company, and no injection through the table name.
SET LOCAL ROLE anon;
DO $$
DECLARE
  leaked text;
BEGIN
  BEGIN
    PERFORM get_inventory_valuation(current_setting('test.company_b'));
    RAISE EXCEPTION 'FAIL: anon read another company''s inventory valuation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM get_production_projections(current_setting('test.company_b'), 'x', ARRAY[]::text[]);
    RAISE EXCEPTION 'FAIL: anon read another company''s production projections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM get_next_sequence('customer', current_setting('test.company_b'));
    RAISE EXCEPTION 'FAIL: anon advanced another company''s sequence';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM get_claims(current_setting('test.user_a'), current_setting('test.company_a'));
    RAISE EXCEPTION 'FAIL: anon read a user''s claims';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- An inline `IF NOT (x = ANY(helper()))` guard: failed open while the helper returned NULL.
  BEGIN
    PERFORM get_item_storage_unit_requirements_by_location(current_setting('test.company_b'), 'x');
    RAISE EXCEPTION 'FAIL: anon read another company''s storage requirements';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    leaked := get_company_id_from_foreign_key('x', 'customer" WHERE 1=0 UNION SELECT (''X'')::text -- ');
    RAISE EXCEPTION 'FAIL: get_company_id_from_foreign_key returned % for an injected table name', leaked;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- An API key reads its own company, and only its own.
SELECT set_config('request.headers', jsonb_build_object('carbon-key', current_setting('test.raw_key'))::text, true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM get_inventory_valuation(current_setting('test.company_a'));
  BEGIN
    PERFORM get_inventory_valuation(current_setting('test.company_b'));
    RAISE EXCEPTION 'FAIL: an API key read another company''s inventory valuation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SELECT set_config('request.headers', '{}', true);

-- A signed-in employee of company A.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  claims jsonb;
BEGIN
  PERFORM get_inventory_valuation(current_setting('test.company_a'));
  BEGIN
    PERFORM get_inventory_valuation(current_setting('test.company_b'));
    RAISE EXCEPTION 'FAIL: an employee of A read B''s inventory valuation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  claims := get_claims(current_setting('test.user_a'), current_setting('test.company_a'));
  IF claims->>'role' IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'FAIL: a user cannot read their own claims (%)', claims;
  END IF;
  BEGIN
    PERFORM get_claims(current_setting('test.user_b'), current_setting('test.company_b'));
    RAISE EXCEPTION 'FAIL: an employee of A read the claims of a user only in B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF cardinality(groups_for_user(current_setting('test.user_b'))) <> 0 THEN
    RAISE EXCEPTION 'FAIL: an employee of A saw the groups of a user only in B';
  END IF;

  IF users_for_groups(ARRAY[current_setting('test.group_b')]) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: an employee of A listed the members of a group in B';
  END IF;

  -- An interceptor called directly with a forged payload runs under RLS.
  BEGIN
    PERFORM sync_create_customer_type_group('customerType', 'INSERT',
      jsonb_build_object('id', 'rpc-privileges-forged', 'name', 'forged', 'companyId', current_setting('test.company_b')), NULL);
    RAISE EXCEPTION 'FAIL: an employee of A wrote a group into B through an interceptor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- Ordinary writes still work as the user: id() defaults, RLS helpers and the
-- event-system dispatchers (now SECURITY DEFINER) all run.
SET LOCAL "app.sync_in_progress" = 'false';
INSERT INTO "customer" (name, "readableId", "companyId") VALUES ('RPC privileges customer', 'RPC-TEST', current_setting('test.company_a'));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "customer" WHERE name = 'RPC privileges customer') THEN
    RAISE EXCEPTION 'FAIL: the employee cannot read back their own customer';
  END IF;
END;
$$;
RESET ROLE;

-- The permission editor reads a colleague's claims holding users_update alone.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF get_claims(current_setting('test.user_a'), current_setting('test.company_a'))->>'role' IS DISTINCT FROM 'employee' THEN
    RAISE EXCEPTION 'FAIL: a users_update holder cannot read a colleague''s claims';
  END IF;
END;
$$;
RESET ROLE;

-- Console PINs (20260926141957_employee-pin). "employeePin" holds bcrypt
-- hashes that no API role may read or write, even through the two SECURITY
-- INVOKER functions; companySettings."consoleEnabled" changes only over the
-- servers' direct connection. user_a gets settings_update here so the trigger,
-- not the UPDATE policy, is what refuses the console flag.
SET LOCAL "app.sync_in_progress" = 'true';
DO $pin_fixtures$
DECLARE
  company_a text := current_setting('test.company_a');
  user_a text := current_setting('test.user_a');
  user_c text := current_setting('test.user_c');
  employee_type text;
BEGIN
  -- The company's all-employees group, which the employeeType interceptor joins.
  INSERT INTO "group" (id, name, "companyId")
  VALUES ('00000000-0000-' || substring(company_a, 1, 4) || '-' || substring(company_a, 5, 4) || '-' || substring(company_a, 9, 12),
          'RPC privileges employees', company_a)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO "employeeType" (name, "companyId") VALUES ('RPC privileges', company_a) RETURNING id INTO employee_type;
  INSERT INTO "employee" (id, "companyId", "employeeTypeId", active) VALUES
    (user_a, company_a, employee_type, true), (user_c, company_a, employee_type, true);
  INSERT INTO "companySettings" (id, "consoleEnabled") VALUES (company_a, false)
  ON CONFLICT (id) DO UPDATE SET "consoleEnabled" = false;
  UPDATE "userPermission"
  SET permissions = permissions || jsonb_build_object('settings_update', jsonb_build_array(company_a))
  WHERE id = user_a;

  -- The owner (the servers' direct connection) sets and verifies.
  PERFORM set_employee_pin(user_a, company_a, '4821', user_a);
  IF NOT verify_employee_pin(user_a, company_a, '4821') THEN
    RAISE EXCEPTION 'FAIL: the owner cannot verify a PIN it set';
  END IF;
  IF verify_employee_pin(user_a, company_a, '0000') THEN
    RAISE EXCEPTION 'FAIL: a wrong PIN verified';
  END IF;
  IF verify_employee_pin(user_c, company_a, '4821') THEN
    RAISE EXCEPTION 'FAIL: an employee with no PIN verified';
  END IF;
  IF (SELECT "pinHash" FROM "employeePin" WHERE "employeeId" = user_a AND "companyId" = company_a) = '4821' THEN
    RAISE EXCEPTION 'FAIL: the PIN is stored in plaintext';
  END IF;
END;
$pin_fixtures$;

SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM "employeePin";
    RAISE EXCEPTION 'FAIL: anon read employeePin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    IF verify_employee_pin(current_setting('test.user_a'), current_setting('test.company_a'), '4821') THEN
      RAISE EXCEPTION 'FAIL: anon verified an employee''s PIN';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM set_employee_pin(current_setting('test.user_a'), current_setting('test.company_a'), '1111', NULL);
    RAISE EXCEPTION 'FAIL: anon set an employee''s PIN';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE "companySettings" SET "consoleEnabled" = true WHERE id = current_setting('test.company_a');
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: anon switched console mode on';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- The employee themself, holding settings_update in company A.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.user_a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  updated integer;
BEGIN
  BEGIN
    PERFORM 1 FROM "employeePin";
    RAISE EXCEPTION 'FAIL: an employee read employeePin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO "employeePin" ("employeeId", "companyId", "pinHash")
    VALUES (current_setting('test.user_c'), current_setting('test.company_a'), 'forged');
    RAISE EXCEPTION 'FAIL: an employee wrote employeePin directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    IF verify_employee_pin(current_setting('test.user_a'), current_setting('test.company_a'), '4821') THEN
      RAISE EXCEPTION 'FAIL: an employee verified a PIN through the API';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM set_employee_pin(current_setting('test.user_c'), current_setting('test.company_a'), '1111', current_setting('test.user_a'));
    RAISE EXCEPTION 'FAIL: an employee set a colleague''s PIN through the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE "companySettings" SET "consoleEnabled" = true WHERE id = current_setting('test.company_a');
    RAISE EXCEPTION 'FAIL: a settings_update holder switched console mode on over the API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Every other column stays writable, and sending consoleEnabled unchanged is fine.
  UPDATE "companySettings"
  SET "digitalQuoteEnabled" = NOT "digitalQuoteEnabled", "consoleEnabled" = "consoleEnabled"
  WHERE id = current_setting('test.company_a');
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'FAIL: a settings_update holder could not update another companySettings column (% rows)', updated;
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- Nothing the API roles tried landed, and the server can still flip the flag.
DO $$
DECLARE
  company_a text := current_setting('test.company_a');
BEGIN
  IF NOT verify_employee_pin(current_setting('test.user_a'), company_a, '4821')
     OR verify_employee_pin(current_setting('test.user_a'), company_a, '1111')
     OR EXISTS (SELECT 1 FROM "employeePin" WHERE "employeeId" = current_setting('test.user_c') AND "companyId" = company_a) THEN
    RAISE EXCEPTION 'FAIL: an API role changed a PIN';
  END IF;
  IF (SELECT "consoleEnabled" FROM "companySettings" WHERE id = company_a) THEN
    RAISE EXCEPTION 'FAIL: an API role switched console mode on';
  END IF;

  UPDATE "companySettings" SET "consoleEnabled" = true WHERE id = company_a;
  IF NOT (SELECT "consoleEnabled" FROM "companySettings" WHERE id = company_a) THEN
    RAISE EXCEPTION 'FAIL: the server cannot switch console mode on';
  END IF;
END;
$$;

SELECT 'rpc-privileges: all checks passed' AS result;
ROLLBACK;
