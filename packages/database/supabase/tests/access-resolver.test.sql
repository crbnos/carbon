-- The SQL access resolver (util.access_level and the helpers that read it) against the
-- cases the TS resolver passes (packages/database/src/access/cases.json).
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/access-resolver.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
\set cases `cat packages/database/src/access/cases.json`
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE access_cases ON COMMIT DROP AS SELECT :'cases'::jsonb AS doc;

CREATE FUNCTION pg_temp.act_as(user_id text, raw_key text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers',
    CASE WHEN raw_key IS NULL THEN '{}' ELSE jsonb_build_object('carbon-key', raw_key)::text END, true);
  PERFORM set_config('request.path', '/test', true);
END;
$fn$;

DO $proof$
DECLARE
  group_a text; company_a text;
  u text := gen_random_uuid()::text;  -- employee of A on an ordinary type
  a text := gen_random_uuid()::text;  -- employee of A on the Admin type
  c text := gen_random_uuid()::text;  -- customer-portal account of A
  role_type text; admin_type text;
  raw_key text := 'crbn_access_resolver_' || gen_random_uuid()::text;
  key_id text;
  test_case jsonb; g jsonb; only_key boolean; who text; actual text; failures int := 0;
  claims jsonb; companies text[];
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Access A ' || id(), 'system')
    RETURNING id INTO group_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Access A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;

  INSERT INTO "user" (id, email) VALUES
    (u, u || '@access.invalid'), (a, a || '@access.invalid'), (c, c || '@access.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (u, company_a, 'employee'), (a, company_a, 'employee'), (c, company_a, 'customer');

  -- The company's all-employees group, which the employeeType interceptor joins.
  INSERT INTO "group" (id, name, "companyId")
  VALUES ('00000000-0000-' || substring(company_a, 1, 4) || '-' || substring(company_a, 5, 4) || '-' || substring(company_a, 9, 12),
          'Access employees', company_a)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO "employeeType" (name, "companyId") VALUES ('Access role', company_a)
    RETURNING id INTO role_type;
  SELECT id INTO admin_type FROM "employeeType"
    WHERE "companyId" = company_a AND "systemType" = 'Admin';
  IF admin_type IS NULL THEN
    INSERT INTO "employeeType" (name, "companyId", "systemType") VALUES ('Access admin', company_a, 'Admin')
      RETURNING id INTO admin_type;
  END IF;
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (u, role_type, company_a, true), (a, admin_type, company_a, true);

  INSERT INTO "apiKey" (name, "keyHash", "companyId", "createdBy")
    VALUES ('Access key', encode(extensions.digest(raw_key::bytea, 'sha256'), 'hex'), company_a, 'system')
    RETURNING id INTO key_id;

  -- 1. Every shared case, against util.access_level.
  FOR test_case IN SELECT jsonb_array_elements(doc) FROM access_cases LOOP
    DELETE FROM permission WHERE "companyId" = company_a;
    who := CASE WHEN (test_case->>'admin')::boolean THEN a ELSE u END;
    only_key := jsonb_array_length(test_case->'grants') > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(test_case->'grants') x WHERE x->>'subject' <> 'key'
    );
    FOR g IN SELECT jsonb_array_elements(test_case->'grants') LOOP
      INSERT INTO permission ("companyId", "userId", "employeeTypeId", "apiKeyId", module, page, level, "createdBy")
      VALUES (
        company_a,
        CASE WHEN g->>'subject' = 'person' THEN who END,
        CASE WHEN g->>'subject' = 'role' THEN
          CASE WHEN (test_case->>'admin')::boolean THEN admin_type ELSE role_type END
        END,
        CASE WHEN g->>'subject' = 'key' THEN key_id END,
        (g->>'module')::module,
        g->>'page',
        (g->>'level')::"permissionLevel",
        'system'
      );
    END LOOP;

    actual := CASE WHEN only_key
      THEN util.access_level(NULL, key_id, company_a, test_case->>'pageId')
      ELSE util.access_level(who, NULL, company_a, test_case->>'pageId')
    END;
    IF actual IS DISTINCT FROM test_case->>'expected' THEN
      failures := failures + 1;
      RAISE WARNING 'case "%": expected %, got %', test_case->>'name', test_case->>'expected', actual;
    END IF;
  END LOOP;
  IF failures > 0 THEN
    RAISE EXCEPTION '% access_level case(s) failed', failures;
  END IF;
  DELETE FROM permission WHERE "companyId" = company_a;

  -- 2. get_companies_with_employee_permission: a role grant, an override, a key.
  INSERT INTO permission ("companyId", "employeeTypeId", module, level, "createdBy") VALUES
    (company_a, role_type, 'Inventory', 'Edit', 'system'),
    (company_a, role_type, 'Sales', 'Full', 'system');
  INSERT INTO permission ("companyId", "userId", module, level, "createdBy") VALUES
    (company_a, u, 'Sales', 'None', 'system');
  INSERT INTO permission ("companyId", "apiKeyId", module, level, "createdBy") VALUES
    (company_a, key_id, 'Purchasing', 'View', 'system');

  PERFORM pg_temp.act_as(u);
  IF NOT company_a = ANY (get_companies_with_employee_permission('inventory_update')) THEN
    RAISE EXCEPTION 'a role grant of Edit must hold inventory_update';
  END IF;
  IF company_a = ANY (get_companies_with_employee_permission('inventory_delete')) THEN
    RAISE EXCEPTION 'a role grant of Edit must not hold inventory_delete';
  END IF;
  IF company_a = ANY (get_companies_with_employee_permission('sales_view')) THEN
    RAISE EXCEPTION 'a person None must remove the role''s Sales grant';
  END IF;
  IF cardinality(get_companies_with_employee_permission('inventory')) <> 0 THEN
    RAISE EXCEPTION 'a permission with no action must hold nothing';
  END IF;
  -- get_companies_with_any_employee_permission: one held key is enough.
  IF NOT company_a = ANY (get_companies_with_any_employee_permission(ARRAY['sales_view', 'inventory_update'])) THEN
    RAISE EXCEPTION 'any-of must hold when one key is held';
  END IF;
  IF cardinality(get_companies_with_any_employee_permission(ARRAY['sales_view', 'inventory_delete', 'inventory'])) <> 0 THEN
    RAISE EXCEPTION 'any-of must hold nothing when no key is held';
  END IF;

  PERFORM pg_temp.act_as(a);
  IF NOT company_a = ANY (get_companies_with_employee_permission('accounting_delete')) THEN
    RAISE EXCEPTION 'the Admin type must hold every action';
  END IF;
  IF NOT company_a = ANY (get_companies_with_any_employee_permission(ARRAY['accounting_delete', 'sales_delete'])) THEN
    RAISE EXCEPTION 'the Admin type must hold every action, any-of';
  END IF;

  PERFORM pg_temp.act_as(c);
  IF cardinality(get_companies_with_employee_permission('inventory_view')) <> 0 THEN
    RAISE EXCEPTION 'a portal account must hold no employee permission';
  END IF;
  IF cardinality(get_companies_with_any_employee_permission(ARRAY['inventory_view', 'sales_view'])) <> 0 THEN
    RAISE EXCEPTION 'a portal account must hold no employee permission, any-of';
  END IF;

  PERFORM pg_temp.act_as(u, raw_key);
  companies := get_companies_with_employee_permission('purchasing_view');
  IF companies IS DISTINCT FROM ARRAY[company_a] THEN
    RAISE EXCEPTION 'a key grant of View must hold purchasing_view, got %', companies;
  END IF;
  IF cardinality(get_companies_with_employee_permission('purchasing_create')) <> 0 THEN
    RAISE EXCEPTION 'a key grant of View must not hold purchasing_create';
  END IF;
  IF cardinality(get_companies_with_employee_permission('inventory_update')) <> 0 THEN
    RAISE EXCEPTION 'a key must not borrow the role grants of the user who sent it';
  END IF;
  companies := get_companies_with_any_employee_permission(ARRAY['inventory_update', 'purchasing_view']);
  IF companies IS DISTINCT FROM ARRAY[company_a] THEN
    RAISE EXCEPTION 'a key grant of View must hold purchasing_view, any-of, got %', companies;
  END IF;
  IF cardinality(get_companies_with_any_employee_permission(ARRAY['inventory_update', 'purchasing_create'])) <> 0 THEN
    RAISE EXCEPTION 'a key must hold none of its ungranted keys, any-of';
  END IF;
  IF (get_api_key_scopes()->'grants'->0->>'level') IS DISTINCT FROM 'View' THEN
    RAISE EXCEPTION 'get_api_key_scopes must return the key''s grants';
  END IF;

  -- 3. get_claims: grants for an employee, portal keys only for a portal account.
  INSERT INTO "userPermission" (id, permissions) VALUES
    (u, jsonb_build_object('sales_view', jsonb_build_array(company_a))),
    (c, jsonb_build_object('sales_view', jsonb_build_array(company_a), 'parts_view', jsonb_build_array('0')))
  ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

  PERFORM pg_temp.act_as(u);
  claims := get_claims(u, company_a);
  IF claims->>'role' <> 'employee' OR (claims->>'admin')::boolean
     OR jsonb_array_length(claims->'grants') <> 3 OR claims->'portal' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'unexpected employee claims: %', claims;
  END IF;

  PERFORM pg_temp.act_as(a);
  IF NOT (get_claims(a, company_a)->>'admin')::boolean THEN
    RAISE EXCEPTION 'the Admin type must read admin: true';
  END IF;

  PERFORM pg_temp.act_as(c);
  claims := get_claims(c, company_a);
  IF claims->'portal' <> jsonb_build_object('sales_view', jsonb_build_array(company_a))
     OR claims->'grants' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'unexpected portal claims: %', claims;
  END IF;

  RAISE NOTICE 'access resolver: % cases and the helper checks passed',
    (SELECT jsonb_array_length(doc) FROM access_cases);
END
$proof$;

ROLLBACK;
