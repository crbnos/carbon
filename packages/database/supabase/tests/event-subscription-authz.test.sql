-- Replacing an event subscription needs the right to manage the one that is
-- there, not only the one being written: any employee may manage a search or
-- audit subscription, but a webhook's belongs to whoever may change settings.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/event-subscription-authz.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL "app.sync_in_progress" = 'true';

DO $fixtures$
DECLARE
  group_id text;
  company text;
  employee text := gen_random_uuid()::text;
  admin text := gen_random_uuid()::text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Subscription authz ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode") VALUES ('Subscription authz ' || id(), group_id, 'USD') RETURNING id INTO company;
  INSERT INTO "user" (id, email) VALUES
    (employee, employee || '@subscription-authz.invalid'),
    (admin, admin || '@subscription-authz.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (employee, company, 'employee'), (admin, company, 'employee');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (employee, '{}'::jsonb),
    (admin, jsonb_build_object('settings_update', jsonb_build_array(company)));
  INSERT INTO "eventSystemSubscription" (name, "table", "companyId", operations, "handlerType", config)
  VALUES ('webhook-probe', 'item', company, ARRAY['INSERT'], 'WEBHOOK', '{"url":"https://example.invalid"}');

  PERFORM set_config('test.company', company, true);
  PERFORM set_config('test.employee', employee, true);
  PERFORM set_config('test.admin', admin, true);
END;
$fixtures$;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.employee'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  company text := current_setting('test.company');
BEGIN
  BEGIN
    PERFORM * FROM create_event_system_subscription('webhook-probe', 'item', company, ARRAY['INSERT'], 'AUDIT');
    RAISE EXCEPTION 'FAIL: an employee replaced a webhook subscription with one of a type they may manage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Their own kind they may create, and replace.
  PERFORM * FROM create_event_system_subscription('audit-probe', 'item', company, ARRAY['INSERT'], 'AUDIT');
  PERFORM * FROM create_event_system_subscription('audit-probe', 'item', company, ARRAY['UPDATE'], 'AUDIT');
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT "handlerType" FROM "eventSystemSubscription"
      WHERE "companyId" = current_setting('test.company') AND name = 'webhook-probe') <> 'WEBHOOK' THEN
    RAISE EXCEPTION 'FAIL: the webhook subscription was changed';
  END IF;
  IF (SELECT operations FROM "eventSystemSubscription"
      WHERE "companyId" = current_setting('test.company') AND name = 'audit-probe') <> ARRAY['UPDATE'] THEN
    RAISE EXCEPTION 'FAIL: an employee could not replace their own audit subscription';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM * FROM create_event_system_subscription(
    'webhook-probe', 'item', current_setting('test.company'), ARRAY['UPDATE'], 'WEBHOOK',
    '{"url":"https://example.invalid/2"}'
  );
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT config->>'url' FROM "eventSystemSubscription"
      WHERE "companyId" = current_setting('test.company') AND name = 'webhook-probe') <> 'https://example.invalid/2' THEN
    RAISE EXCEPTION 'FAIL: a settings holder could not replace the webhook subscription';
  END IF;
END;
$$;

SELECT 'event-subscription-authz: all checks passed' AS result;
ROLLBACK;
