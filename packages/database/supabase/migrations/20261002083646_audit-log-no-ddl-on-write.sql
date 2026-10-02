-- An audit write must not run DDL.
--
-- insert_audit_log_batch calls create_audit_log_table on every write, and for a
-- table that already exists that function re-attached the append-only trigger
-- (DROP TRIGGER + CREATE TRIGGER) and re-ran secure_audit_log_table (DROP
-- POLICY, CREATE POLICY, REVOKE) unconditionally. CREATE TRIGGER fires
-- PostgREST's pgrst_ddl_watch event trigger, which reloads the schema cache.
-- With one search-index and one audit table per company that reload takes
-- 10-13 s, and every request that joins related tables waits for it. So each
-- audit write stalled those requests for every company: 480+ reloads a day in
-- production, 139 in the busiest hour.
--
-- The table is still re-secured when something is missing; it is checked in
-- the catalog first, so a healthy table costs no DDL.
--
-- Forked from 20260924171942_audit-log-company-scope.sql with that one change
-- to the existing-table branch.

CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  tbl REGCLASS;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_update');

  tbl_name := 'auditLog_' || p_company_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    -- Table exists; ensure recordId column is present (for tables created before this migration)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = tbl_name
        AND column_name = 'recordId'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "recordId" TEXT', tbl_name);
      EXECUTE format('UPDATE %I SET "recordId" = "entityId" WHERE "recordId" IS NULL', tbl_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("recordId")',
        'idx_' || tbl_name || '_record', tbl_name);
    END IF;

    tbl := format('public.%I', tbl_name)::regclass;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = tbl
        AND t.tgname = 'append_only'
        AND NOT t.tgisinternal
        AND t.tgenabled <> 'D'
        AND t.tgfoid = 'public.prevent_audit_log_mutation'::regproc
    ) THEN
      PERFORM attach_audit_log_append_only(tbl_name);
    END IF;

    -- Secured means: the company-scoped read policy is there, the old
    -- open policy is not, and the API roles cannot write.
    IF EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = tbl_name
           AND p.policyname = 'audit_log_access'
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = tbl_name
           AND p.policyname = 'SELECT' AND p.cmd = 'SELECT'
           AND p.qual LIKE '%' || quote_literal(p_company_id) || '%'
           AND p.qual LIKE '%settings_view%'
       )
       OR has_table_privilege('anon', tbl, 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_table_privilege('authenticated', tbl, 'INSERT, UPDATE, DELETE, TRUNCATE')
    THEN
      PERFORM secure_audit_log_table(p_company_id);
    END IF;

    RETURN;
  END IF;

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      "id" TEXT PRIMARY KEY DEFAULT id(''aud''),
      "tableName" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "recordId" TEXT,
      "operation" TEXT NOT NULL CHECK ("operation" IN (''INSERT'', ''UPDATE'', ''DELETE'')),
      "actorId" TEXT,
      "diff" JSONB,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  ', tbl_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("entityType", "entityId")',
    'idx_' || tbl_name || '_entity', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("tableName")',
    'idx_' || tbl_name || '_table', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("recordId")',
    'idx_' || tbl_name || '_record', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("actorId")',
    'idx_' || tbl_name || '_actor', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("createdAt" DESC)',
    'idx_' || tbl_name || '_created', tbl_name);

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl_name);

  PERFORM attach_audit_log_append_only(tbl_name);
  PERFORM secure_audit_log_table(p_company_id);
END;
$function$;
