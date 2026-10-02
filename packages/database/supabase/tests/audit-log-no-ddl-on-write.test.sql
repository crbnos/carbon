-- An audit write must not run DDL: CREATE TRIGGER makes PostgREST reload its
-- schema cache, and every request that joins related tables waits for that.
-- A table that lost its trigger, policy or write restrictions must still heal.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/audit-log-no-ddl-on-write.test.sql
-- All fixtures are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  company text := 'audit_ddl_probe';
  tbl text := 'auditLog_audit_ddl_probe';
  entry jsonb := '{"tableName":"job","entityType":"job","entityId":"j1","recordId":"j1","operation":"UPDATE","actorId":null,"diff":{},"metadata":null}';
  trigger_before oid; policy_before oid; trigger_after oid; policy_after oid;
BEGIN
  PERFORM create_audit_log_table(company);

  SELECT oid INTO trigger_before FROM pg_trigger
    WHERE tgrelid = format('public.%I', tbl)::regclass AND tgname = 'append_only';
  SELECT oid INTO policy_before FROM pg_policy
    WHERE polrelid = format('public.%I', tbl)::regclass AND polname = 'SELECT';
  ASSERT trigger_before IS NOT NULL AND policy_before IS NOT NULL,
    'a new audit table gets its trigger and read policy';

  PERFORM insert_audit_log_batch(company, ARRAY[entry]);
  PERFORM insert_audit_log_batch(company, ARRAY[entry]);

  SELECT oid INTO trigger_after FROM pg_trigger
    WHERE tgrelid = format('public.%I', tbl)::regclass AND tgname = 'append_only';
  SELECT oid INTO policy_after FROM pg_policy
    WHERE polrelid = format('public.%I', tbl)::regclass AND polname = 'SELECT';
  ASSERT trigger_after = trigger_before,
    'an audit write must not recreate the append-only trigger';
  ASSERT policy_after = policy_before,
    'an audit write must not recreate the read policy';

  EXECUTE format('DROP TRIGGER "append_only" ON %I', tbl);
  EXECUTE format('DROP POLICY "SELECT" ON %I', tbl);
  EXECUTE format('GRANT INSERT ON %I TO authenticated', tbl);

  PERFORM insert_audit_log_batch(company, ARRAY[entry]);

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = format('public.%I', tbl)::regclass AND tgname = 'append_only'
  ), 'a missing append-only trigger is restored on the next write';
  ASSERT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = format('public.%I', tbl)::regclass AND polname = 'SELECT'
  ), 'a missing read policy is restored on the next write';
  ASSERT NOT has_table_privilege('authenticated', format('public.%I', tbl), 'INSERT'),
    'API write access is revoked again on the next write';
END;
$proof$;

ROLLBACK;
