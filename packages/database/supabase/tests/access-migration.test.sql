-- The conversion of today's permissions to grants
-- (migrations/20261018093518_convert-permissions-to-grants.sql), run again over fixtures.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/access-migration.test.sql
-- All fixtures are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '60s';

DO $fixtures$
DECLARE
  group_id text; company_a text; role_type text; admin_type text; key_id text;
  same text := gen_random_uuid()::text;   -- keys equal to the role's
  differs text := gen_random_uuid()::text; -- keys that differ from the role's
  boss text := gen_random_uuid()::text;   -- on the Admin type
  everything text[];
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Conversion ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Conversion A', group_id, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO "group" (id, name, "companyId")
  VALUES ('00000000-0000-' || substring(company_a, 1, 4) || '-' || substring(company_a, 5, 4) || '-' || substring(company_a, 9, 12),
          'Conversion employees', company_a)
  ON CONFLICT (id) DO NOTHING;
  everything := ARRAY[company_a];

  INSERT INTO "employeeType" (name, "companyId") VALUES ('Conversion role', company_a) RETURNING id INTO role_type;
  SELECT id INTO admin_type FROM "employeeType" WHERE "companyId" = company_a AND "systemType" = 'Admin';
  IF admin_type IS NULL THEN
    INSERT INTO "employeeType" (name, "companyId", "systemType") VALUES ('Conversion admin', company_a, 'Admin')
      RETURNING id INTO admin_type;
  END IF;

  INSERT INTO "employeeTypePermission" ("employeeTypeId", module, "view", "create", "update", "delete") VALUES
    (role_type, 'Sales', everything, '{}', everything, '{}'),             -- view + update → Edit
    (role_type, 'Purchasing', '{}', '{}', '{}', everything),              -- delete only → Full
    (role_type, 'Inventory', everything, everything, everything, everything), -- all four → Full
    (role_type, 'Accounting', '{}', '{}', '{}', '{}'),                    -- none → no row
    (admin_type, 'Sales', everything, '{}', '{}', '{}');                  -- Admin type → no row

  INSERT INTO "user" (id, email) VALUES
    (same, same || '@conversion.invalid'), (differs, differs || '@conversion.invalid'),
    (boss, boss || '@conversion.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (same, company_a, 'employee'), (differs, company_a, 'employee'), (boss, company_a, 'employee');
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (same, role_type, company_a, true), (differs, role_type, company_a, true), (boss, admin_type, company_a, true);
  INSERT INTO "userPermission" (id, permissions) VALUES
    (same, jsonb_build_object(
      'sales_view', everything, 'sales_update', everything,
      'purchasing_delete', everything,
      'inventory_view', everything, 'inventory_create', everything,
      'inventory_update', everything, 'inventory_delete', everything)),
    (differs, jsonb_build_object(
      'sales_view', everything,                      -- below the role's Edit → View
      'purchasing_delete', everything,
      'quality_create', jsonb_build_array('0'),      -- "0": all companies → Create
      'accounting_view', jsonb_build_array('other'))), -- another company: not granted
                                                       -- and no Inventory keys → None
    (boss, jsonb_build_object('sales_view', everything))
  ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions;

  INSERT INTO "apiKey" (name, "keyHash", "companyId", "createdBy", scopes)
    VALUES ('Conversion key', 'conversion-' || id(), company_a, 'system', jsonb_build_object(
      'parts_view', everything, 'parts_update', everything, 'sales_view', jsonb_build_array('other')))
    RETURNING id INTO key_id;

  PERFORM set_config('test.company', company_a, true);
  PERFORM set_config('test.role', role_type, true);
  PERFORM set_config('test.admin_type', admin_type, true);
  PERFORM set_config('test.same', same, true);
  PERFORM set_config('test.differs', differs, true);
  PERFORM set_config('test.boss', boss, true);
  PERFORM set_config('test.key', key_id, true);
END;
$fixtures$;

\i packages/database/supabase/migrations/20261018093518_convert-permissions-to-grants.sql
-- Twice: a second run changes nothing.
\i packages/database/supabase/migrations/20261018093518_convert-permissions-to-grants.sql

DO $proof$
DECLARE
  company_a text := current_setting('test.company');
  got text;
  n int;
BEGIN
  CREATE TEMP TABLE expected (subject text, module text, level text, converted text[]) ON COMMIT DROP;
  INSERT INTO expected VALUES
    ('role', 'Sales', 'Edit', '{view,update}'),
    ('role', 'Purchasing', 'Full', '{delete}'),
    ('role', 'Inventory', 'Full', '{view,create,update,delete}'),
    ('differs', 'Sales', 'View', '{view}'),
    ('differs', 'Quality', 'Create', '{create}'),
    ('differs', 'Inventory', 'None', '{}'),
    ('key', 'Parts', 'Edit', '{view,update}');

  CREATE TEMP TABLE actual ON COMMIT DROP AS
  SELECT CASE
      WHEN p."employeeTypeId" = current_setting('test.role') THEN 'role'
      WHEN p."employeeTypeId" = current_setting('test.admin_type') THEN 'admin_type'
      WHEN p."userId" = current_setting('test.same') THEN 'same'
      WHEN p."userId" = current_setting('test.differs') THEN 'differs'
      WHEN p."userId" = current_setting('test.boss') THEN 'boss'
      WHEN p."apiKeyId" = current_setting('test.key') THEN 'key'
    END AS subject,
    p.module::text AS module, p.level::text AS level, p."convertedFrom" AS converted
  FROM permission p
  WHERE p."companyId" = company_a;

  SELECT string_agg(format('%s %s %s %s', subject, module, level, converted), '; ') INTO got
  FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) missing;
  IF got IS NOT NULL THEN RAISE EXCEPTION 'missing grants: %', got; END IF;

  SELECT string_agg(format('%s %s %s %s', subject, module, level, converted), '; ') INTO got
  FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) extra;
  IF got IS NOT NULL THEN RAISE EXCEPTION 'unexpected grants: %', got; END IF;

  SELECT count(*) INTO n FROM permission WHERE "companyId" = company_a;
  IF n <> 7 THEN RAISE EXCEPTION 'a second run must add nothing: % rows', n; END IF;

  -- The converted grants resolve as the old keys did.
  IF util.access_level(current_setting('test.same'), NULL, company_a, 'sales') <> 'Edit'
     OR util.access_level(current_setting('test.differs'), NULL, company_a, 'sales') <> 'View'
     OR util.access_level(current_setting('test.differs'), NULL, company_a, 'inventory') <> 'None'
     OR util.access_level(current_setting('test.differs'), NULL, company_a, 'purchasing') <> 'Full'
     OR util.access_level(current_setting('test.boss'), NULL, company_a, 'accounting') <> 'Full'
     OR util.access_level(NULL, current_setting('test.key'), company_a, 'parts') <> 'Edit'
     OR util.access_level(NULL, current_setting('test.key'), company_a, 'sales') <> 'None' THEN
    RAISE EXCEPTION 'a converted grant does not resolve to its old level';
  END IF;

  RAISE NOTICE 'access migration: 7 grants, a no-op second run, and the levels resolve';
END;
$proof$;

ROLLBACK;
