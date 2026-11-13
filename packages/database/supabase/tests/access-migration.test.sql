-- The conversion of today's permissions to grants
-- (migrations/20261110050003_convert-permissions-to-grants.sql), run again over fixtures.
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
    (role_type, 'Quality', ARRAY['0'], '{}', '{}', '{}'),                 -- the retired "0" → no row
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
      'quality_create', jsonb_build_array('0'),      -- the retired "0": not granted
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

\i packages/database/supabase/migrations/20261110050003_convert-permissions-to-grants.sql
-- Twice: a second run changes nothing.
\i packages/database/supabase/migrations/20261110050003_convert-permissions-to-grants.sql

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
  IF n <> 6 THEN RAISE EXCEPTION 'a second run must add nothing: % rows', n; END IF;

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

  RAISE NOTICE 'access migration: 6 grants, a no-op second run, and the levels resolve';
END;
$proof$;

-- Subjects that already hold the new module, as grants (after the conversion).
DO $holders$
DECLARE
  company_a text := current_setting('test.company');
  planner_type text;
  planner text := gen_random_uuid()::text; -- on the planner role, no override
  scoped text := gen_random_uuid()::text;  -- Inventory None override
  narrowed text := gen_random_uuid()::text; -- Production None override
  stocker_type text;
  stocker text := gen_random_uuid()::text; -- on a role holding only Inventory
BEGIN
  INSERT INTO "employeeType" (name, "companyId") VALUES ('Planner role', company_a) RETURNING id INTO planner_type;
  INSERT INTO "employeeType" (name, "companyId") VALUES ('Stock role', company_a) RETURNING id INTO stocker_type;
  INSERT INTO "user" (id, email) VALUES
    (planner, planner || '@conversion.invalid'), (scoped, scoped || '@conversion.invalid'),
    (narrowed, narrowed || '@conversion.invalid'), (stocker, stocker || '@conversion.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (planner, company_a, 'employee'), (scoped, company_a, 'employee'), (narrowed, company_a, 'employee'),
    (stocker, company_a, 'employee');
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (planner, planner_type, company_a, true), (scoped, planner_type, company_a, true),
    (narrowed, planner_type, company_a, true), (stocker, stocker_type, company_a, true);
  INSERT INTO "permission" ("companyId", "employeeTypeId", "userId", module, level, "createdBy") VALUES
    (company_a, planner_type, NULL, 'Inventory', 'Edit', 'system'),
    (company_a, planner_type, NULL, 'Production', 'View', 'system'),
    (company_a, NULL, scoped, 'Inventory', 'None', 'system'),
    (company_a, NULL, narrowed, 'Production', 'None', 'system'),
    (company_a, stocker_type, NULL, 'Inventory', 'Full', 'system');

  PERFORM set_config('test.planner_type', planner_type, true);
  PERFORM set_config('test.planner', planner, true);
  PERFORM set_config('test.scoped', scoped, true);
  PERFORM set_config('test.narrowed', narrowed, true);
  PERFORM set_config('test.stocker', stocker, true);
END;
$holders$;

-- Tables that moved module keep their old module's holders through the new
-- page's alsoWrittenBy and the old page's readers, with no grant in the new
-- module (20261111050002 gives none). Twice: a second run changes nothing.
\i packages/database/supabase/migrations/20261111050002_grants-for-moved-tables.sql
\i packages/database/supabase/migrations/20261111050002_grants-for-moved-tables.sql

CREATE FUNCTION pg_temp.allows(tbl text, command text, rec jsonb)
RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE expr text; ok boolean;
BEGIN
  SELECT coalesce(with_check, qual) INTO expr
  FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND cmd = command;
  IF expr IS NULL THEN RETURN false; END IF;
  EXECUTE format('SELECT (%s) FROM jsonb_populate_record(NULL::public.%I, $1) AS %I', expr, tbl, tbl)
    INTO ok USING rec;
  RETURN coalesce(ok, false);
END;
$fn$;

DO $moved$
DECLARE
  company_a text := current_setting('test.company');
  resources_type text;
  resourcer text := gen_random_uuid()::text; -- Resources View, nothing on People
  n int;
BEGIN
  -- 6 converted and 5 fixture grants: no page grant in a new module.
  SELECT count(*) INTO n FROM permission WHERE "companyId" = company_a;
  IF n <> 11 THEN RAISE EXCEPTION 'the moved tables must add no grant: % rows', n; END IF;

  -- A converted Inventory role still writes demandForecast through the live
  -- policy (inventory.quantities in alsoWrittenBy); the None override still refuses it.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.same'), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
  IF NOT pg_temp.allows('demandForecast', 'INSERT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'an Inventory role must still write demandForecast';
  END IF;
  IF NOT pg_temp.allows('demandForecast', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'an Inventory role must still read demandForecast';
  END IF;
  -- A role holding only Inventory writes and reads demandForecast, not the rest of
  -- Production (test.same's role also holds Purchasing, which reads planningAction).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.stocker'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('demandForecast', 'INSERT', jsonb_build_object('companyId', company_a))
     OR NOT pg_temp.allows('demandForecast', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'an Inventory-only role must still write and read demandForecast';
  END IF;
  IF pg_temp.allows('planningAction', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'an Inventory-only role must not read planningAction';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.differs'), 'role', 'authenticated')::text, true);
  IF pg_temp.allows('demandForecast', 'INSERT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a person None on Inventory must not write demandForecast';
  END IF;

  -- batchProperty moved to the item pages, and also accepts the Tracked
  -- Entities page that wrote it before: the Inventory role still writes it,
  -- without gaining the items themselves.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.same'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('batchProperty', 'INSERT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'an Inventory role must still write batchProperty';
  END IF;
  IF pg_temp.allows('item', 'UPDATE', jsonb_build_object('companyId', company_a, 'type', 'Part')) THEN
    RAISE EXCEPTION 'an Inventory role must not update an item';
  END IF;

  -- Inventory Edit with Production View, an Inventory None person on that role,
  -- and a Production None person on it: the old Inventory level decides.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.planner'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('demandForecast', 'UPDATE', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'Inventory Edit and Production View must still update demandForecast';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.scoped'), 'role', 'authenticated')::text, true);
  IF pg_temp.allows('demandForecast', 'INSERT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a person None on Inventory must not write demandForecast through a role holding Production View';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.narrowed'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('demandForecast', 'UPDATE', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a person None on Production must still update demandForecast through Inventory';
  END IF;

  -- A Resources View role with nothing on People: it read the user attributes
  -- before (people.attributes moved from Resources), and never payroll.
  INSERT INTO "employeeType" (name, "companyId") VALUES ('Resources role', company_a) RETURNING id INTO resources_type;
  INSERT INTO "user" (id, email) VALUES (resourcer, resourcer || '@conversion.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES (resourcer, company_a, 'employee');
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES (resourcer, resources_type, company_a, true);
  INSERT INTO "permission" ("companyId", "employeeTypeId", module, level, "createdBy")
    VALUES (company_a, resources_type, 'Resources', 'View', 'system');
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', resourcer, 'role', 'authenticated')::text, true);
  IF pg_temp.allows('payrollPeriodTotal', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a Resources role without People must not read payrollPeriodTotal';
  END IF;
  IF pg_temp.allows('timeCardEntry', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a Resources role without People must not read timeCardEntry';
  END IF;
  IF util.access_level(resourcer, NULL, company_a, 'people.attributes') <> 'None' THEN
    RAISE EXCEPTION 'a Resources role must hold nothing on people.attributes';
  END IF;

  RAISE NOTICE 'moved tables: no grant, demandForecast and batchProperty still writable by Inventory, planningAction and payroll not readable';
END;
$moved$;

-- Printing grants moved to settings.printing (20261110050005, then
-- 20261111050002): a person's own Settings grant does not lower their role's Printing.
DO $printers$
DECLARE
  company_a text := current_setting('test.company');
  printer_type text;
  printer text := gen_random_uuid()::text;  -- no override
  settings_view text := gen_random_uuid()::text; -- Settings View override, no Printing one
  print_none text := gen_random_uuid()::text; -- Printing None and Settings View overrides
BEGIN
  INSERT INTO "employeeType" (name, "companyId") VALUES ('Printer role', company_a) RETURNING id INTO printer_type;
  INSERT INTO "user" (id, email) VALUES
    (printer, printer || '@conversion.invalid'), (settings_view, settings_view || '@conversion.invalid'),
    (print_none, print_none || '@conversion.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (printer, company_a, 'employee'), (settings_view, company_a, 'employee'), (print_none, company_a, 'employee');
  INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES
    (printer, printer_type, company_a, true), (settings_view, printer_type, company_a, true),
    (print_none, printer_type, company_a, true);
  INSERT INTO "permission" ("companyId", "employeeTypeId", "userId", module, level, "createdBy") VALUES
    (company_a, printer_type, NULL, 'Printing', 'Edit', 'system'),
    (company_a, NULL, settings_view, 'Settings', 'View', 'system'),
    (company_a, NULL, print_none, 'Printing', 'None', 'system'),
    (company_a, NULL, print_none, 'Settings', 'View', 'system');

  PERFORM set_config('test.printer_type', printer_type, true);
  PERFORM set_config('test.printer', printer, true);
  PERFORM set_config('test.settings_view', settings_view, true);
  PERFORM set_config('test.print_none', print_none, true);
END;
$printers$;

\i packages/database/supabase/migrations/20261110050005_printing-grants-to-settings-page.sql
\i packages/database/supabase/migrations/20261111050002_grants-for-moved-tables.sql
\i packages/database/supabase/migrations/20261111050002_grants-for-moved-tables.sql

DO $printing$
DECLARE
  company_a text := current_setting('test.company');
  got text;
BEGIN
  SELECT string_agg(format('%s %s', s.subject, s.level), ', ' ORDER BY s.subject COLLATE "C") INTO got
  FROM (
    SELECT CASE
        WHEN p."employeeTypeId" = current_setting('test.printer_type') THEN 'printer_type'
        WHEN p."userId" = current_setting('test.printer') THEN 'printer'
        WHEN p."userId" = current_setting('test.settings_view') THEN 'settings_view'
        WHEN p."userId" = current_setting('test.print_none') THEN 'print_none'
        ELSE 'other'
      END AS subject, p.level::text AS level
    FROM permission p
    WHERE p."companyId" = company_a AND p.page = 'settings.printing'
  ) s;
  -- The role's Printing row moved; the Settings View person gets the role's
  -- Edit once, however often it runs; the Printing None person keeps None.
  IF got IS DISTINCT FROM 'print_none None, printer_type Edit, settings_view Edit' THEN
    RAISE EXCEPTION 'unexpected settings.printing grants: %', got;
  END IF;

  IF util.access_level(current_setting('test.printer'), NULL, company_a, 'settings.printing') <> 'Edit'
     OR util.access_level(current_setting('test.settings_view'), NULL, company_a, 'settings.printing') <> 'Edit'
     OR util.access_level(current_setting('test.print_none'), NULL, company_a, 'settings.printing') <> 'None'
     -- Their own Settings View still decides the rest of Settings.
     OR util.access_level(current_setting('test.settings_view'), NULL, company_a, 'settings.company') <> 'View' THEN
    RAISE EXCEPTION 'a level on settings.printing differs from the old Printing level';
  END IF;

  -- Through the live policy: the Settings View person still updates a printer route.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.settings_view'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('printerRoute', 'UPDATE', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'Printing Edit through the role must still update printerRoute';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.print_none'), 'role', 'authenticated')::text, true);
  IF pg_temp.allows('printerRoute', 'UPDATE', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a person None on Printing must not update printerRoute';
  END IF;

  -- A Printing-only person reads printers, not the Settings tables that hold secrets.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('test.printer'), 'role', 'authenticated')::text, true);
  IF NOT pg_temp.allows('printerRoute', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a Printing person must read printerRoute';
  END IF;
  -- companyIntegration stays a read of any Settings page: its secrets are in Vault.
  IF NOT pg_temp.allows('companyIntegration', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a Printing person must read companyIntegration';
  END IF;
  IF pg_temp.allows('apiKey', 'SELECT', jsonb_build_object('companyId', company_a))
     OR pg_temp.allows('apiKeyRateLimit', 'SELECT', jsonb_build_object('apiKeyId', current_setting('test.key')))
     OR pg_temp.allows('webhook', 'SELECT', jsonb_build_object('companyId', company_a))
     OR pg_temp.allows('integrationConnection', 'SELECT', jsonb_build_object('companyId', company_a)) THEN
    RAISE EXCEPTION 'a Printing person must not read apiKey, apiKeyRateLimit, webhook or integrationConnection';
  END IF;

  RAISE NOTICE 'printing: role Printing Edit survives a person Settings override, Printing None stays None, no secret read';
END;
$printing$;

-- Audit log tables re-secured after the page-key secure_audit_log_table (20261111050003).
DO $audit$
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I (id text)', 'auditLog_' || current_setting('test.company'));
END;
$audit$;
\i packages/database/supabase/migrations/20261111050003_audit-log-page-policy.sql
DO $auditproof$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'auditLog_' || current_setting('test.company')
      AND policyname = 'SELECT' AND qual LIKE '%settings.auditLogs_view%'
  ) THEN
    RAISE EXCEPTION 'the audit log read policy must name settings.auditLogs_view';
  END IF;
  RAISE NOTICE 'audit log tables: read policy on the Audit Logs page';
END;
$auditproof$;

ROLLBACK;
