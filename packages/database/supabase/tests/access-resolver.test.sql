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
  group_a text; company_a text; company_b text;
  foreign_admin text := gen_random_uuid()::text;  -- employee of A whose type is B's Admin type
  admin_type_b text; asked text;
  u text := gen_random_uuid()::text;  -- employee of A on an ordinary type
  a text := gen_random_uuid()::text;  -- employee of A on the Admin type
  c text := gen_random_uuid()::text;  -- customer-portal account of A
  role_type text; admin_type text;
  raw_key text := 'crbn_access_resolver_' || gen_random_uuid()::text;
  key_id text;
  test_case jsonb; g jsonb; only_key boolean; who text; actual text; failures int := 0;
  claims jsonb; companies text[]; module_view text[]; page_keys text[];
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Access A ' || id(), 'system')
    RETURNING id INTO group_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Access A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;

  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Access B', group_a, 'USD', 'America/New_York') RETURNING id INTO company_b;

  INSERT INTO "user" (id, email) VALUES
    (u, u || '@access.invalid'), (a, a || '@access.invalid'), (c, c || '@access.invalid'),
    (foreign_admin, foreign_admin || '@access.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (u, company_a, 'employee'), (a, company_a, 'employee'), (c, company_a, 'customer'),
    (foreign_admin, company_a, 'employee');

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
  INSERT INTO "group" (id, name, "companyId")
  VALUES ('00000000-0000-' || substring(company_b, 1, 4) || '-' || substring(company_b, 5, 4) || '-' || substring(company_b, 9, 12),
          'Access employees B', company_b)
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO admin_type_b FROM "employeeType"
    WHERE "companyId" = company_b AND "systemType" = 'Admin';
  IF admin_type_b IS NULL THEN
    INSERT INTO "employeeType" (name, "companyId", "systemType") VALUES ('Access admin B', company_b, 'Admin')
      RETURNING id INTO admin_type_b;
  END IF;
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (u, role_type, company_a, true), (a, admin_type, company_a, true);
  -- Only a corrupt or forged row points at another company's type.
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (foreign_admin, role_type, company_a, true);
  UPDATE employee SET "employeeTypeId" = admin_type_b WHERE id = foreign_admin AND "companyId" = company_a;

  INSERT INTO "apiKey" (name, "keyHash", "companyId", "createdBy")
    VALUES ('Access key', encode(extensions.digest(raw_key::bytea, 'sha256'), 'hex'), company_a, 'system')
    RETURNING id INTO key_id;

  -- 1. Every shared case, against util.access_level.
  FOR test_case IN SELECT jsonb_array_elements(doc) FROM access_cases LOOP
    DELETE FROM permission WHERE "companyId" IN (company_a, company_b);
    -- Grants and the Admin type are in A unless the case names B; it asks about A
    -- unless askCompany names B.
    who := CASE
      WHEN (test_case->>'admin')::boolean AND test_case->>'adminCompany' = 'B' THEN foreign_admin
      WHEN (test_case->>'admin')::boolean THEN a
      ELSE u END;
    asked := CASE WHEN test_case->>'askCompany' = 'B' THEN company_b ELSE company_a END;
    only_key := jsonb_array_length(test_case->'grants') > 0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(test_case->'grants') x WHERE x->>'subject' <> 'key'
    );
    FOR g IN SELECT jsonb_array_elements(test_case->'grants') LOOP
      INSERT INTO permission ("companyId", "userId", "employeeTypeId", "apiKeyId", module, page, level, "createdBy")
      VALUES (
        CASE WHEN g->>'company' = 'B' THEN company_b ELSE company_a END,
        CASE WHEN g->>'subject' = 'person' THEN who END,
        CASE WHEN g->>'subject' = 'role' THEN
          CASE WHEN who = a THEN admin_type ELSE role_type END
        END,
        CASE WHEN g->>'subject' = 'key' THEN key_id END,
        (g->>'module')::module,
        g->>'page',
        (g->>'level')::"permissionLevel",
        'system'
      );
    END LOOP;

    actual := CASE WHEN only_key
      THEN util.access_level(NULL, key_id, asked, test_case->>'pageId')
      ELSE util.access_level(who, NULL, asked, test_case->>'pageId')
    END;
    IF actual IS DISTINCT FROM test_case->>'expected' THEN
      failures := failures + 1;
      RAISE WARNING 'case "%": expected %, got %', test_case->>'name', test_case->>'expected', actual;
    END IF;

    -- A module read is one call naming the module: the same companies as the
    -- key list of every page of the module that policies used to carry.
    PERFORM pg_temp.act_as(who, CASE WHEN only_key THEN raw_key END);
    module_view := get_companies_with_module_view(
      ARRAY[split_part(test_case->>'pageId', '.', 1)], ARRAY['sales.quotes_view']);
    page_keys := get_companies_with_any_employee_permission(
      ARRAY(SELECT p || '_view' FROM unnest(util.module_pages(split_part(test_case->>'pageId', '.', 1))) p)
      || ARRAY['sales.quotes_view']);
    IF module_view IS DISTINCT FROM page_keys THEN
      failures := failures + 1;
      RAISE WARNING 'case "%": the module read holds % but its pages hold %', test_case->>'name', module_view, page_keys;
    END IF;
    -- View on the case's page in the asked company admits a read of its module there.
    IF (actual::"permissionLevel" >= 'View') AND asked = company_a
       AND NOT company_a = ANY (module_view) THEN
      failures := failures + 1;
      RAISE WARNING 'case "%": View on the page must admit a read of its module', test_case->>'name';
    END IF;
  END LOOP;
  IF failures > 0 THEN
    RAISE EXCEPTION '% access_level case(s) failed', failures;
  END IF;
  DELETE FROM permission WHERE "companyId" IN (company_a, company_b);

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

  -- The clamp reaches the helpers too: a role at Full on a View-only page holds View only.
  INSERT INTO permission ("companyId", "employeeTypeId", module, page, level, "createdBy") VALUES
    (company_a, role_type, 'Inventory', 'inventory.traceability', 'Full', 'system');
  IF NOT company_a = ANY (get_companies_with_employee_permission('inventory.traceability_view')) THEN
    RAISE EXCEPTION 'a role at Full on a View-only page must hold its view';
  END IF;
  IF company_a = ANY (get_companies_with_employee_permission('inventory.traceability_update')) THEN
    RAISE EXCEPTION 'a role at Full on a View-only page must not hold more than View';
  END IF;
  -- A module read: the role's Inventory Edit admits it; nothing admits Quality.
  IF NOT company_a = ANY (get_companies_with_module_view(ARRAY['inventory'], '{}')) THEN
    RAISE EXCEPTION 'a module grant must admit a read of the module';
  END IF;
  IF cardinality(get_companies_with_module_view(ARRAY['quality', 'nosuchmodule'], '{}')) <> 0 THEN
    RAISE EXCEPTION 'no grant on the module must admit no read of it';
  END IF;
  IF NOT company_a = ANY (get_companies_with_module_view(ARRAY['quality'], ARRAY['inventory.receipts_view'])) THEN
    RAISE EXCEPTION 'a held key must admit the read, module view or not';
  END IF;
  DELETE FROM permission WHERE "companyId" = company_a AND page = 'inventory.traceability';

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

  -- The transitional old keys, from the module grants: role Inventory Edit, and
  -- a person Sales None over the role's Sales Full.
  IF claims->'inventory_update' IS DISTINCT FROM jsonb_build_array(company_a)
     OR claims ? 'inventory_delete' OR claims ? 'sales_view' THEN
    RAISE EXCEPTION 'unexpected old claims keys: %', claims;
  END IF;

  PERFORM pg_temp.act_as(a);
  claims := get_claims(a, company_a);
  IF NOT (claims->>'admin')::boolean THEN
    RAISE EXCEPTION 'the Admin type must read admin: true';
  END IF;
  IF claims->'accounting_delete' IS DISTINCT FROM jsonb_build_array(company_a) THEN
    RAISE EXCEPTION 'the Admin type must hold every old key: %', claims;
  END IF;

  PERFORM pg_temp.act_as(foreign_admin);
  claims := get_claims(foreign_admin, company_a);
  IF (claims->>'admin')::boolean OR claims ? 'accounting_view' THEN
    RAISE EXCEPTION 'another company''s Admin type must not read admin: %', claims;
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
