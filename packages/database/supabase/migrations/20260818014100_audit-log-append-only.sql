-- NIST 800-171 3.3.8 (AU-9): make the per-company audit log tables append-only.
-- The auditLog_{companyId} tables had permissive RLS (USING true) and no
-- immutability constraint, so any UPDATE/DELETE reaching them mutated the record
-- of who-did-what. Add a trigger that rejects UPDATE unconditionally and DELETE
-- unless the retention/archival path (delete_old_audit_logs) has set a
-- transaction-local flag. Even a service-role client can no longer casually
-- rewrite or erase audit history outside that one path.
--
-- This is defense-in-depth at the DB layer; stronger tamper-evidence (S3 Object
-- Lock on the archives, hash-chaining) is layered on top in the deployment.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit log records are immutable (append-only)';
  END IF;
  -- DELETE: permitted only during retention/archival, which sets this flag.
  IF current_setting('app.audit_archiving', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Audit log records cannot be deleted (retention/archival only)';
  END IF;
  RETURN OLD;
END;
$$;

-- Idempotent: (re)attach the append-only trigger to one audit-log table.
CREATE OR REPLACE FUNCTION attach_audit_log_append_only(p_table_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS "append_only" ON %I', p_table_name);
  EXECUTE format(
    'CREATE TRIGGER "append_only" BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()',
    p_table_name
  );
END;
$$;

-- Backfill: attach to every existing per-company audit table. The escaped
-- underscore matches "auditLog_<company>" but NOT "auditLogArchive".
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'auditLog\_%' ESCAPE '\'
  LOOP
    PERFORM attach_audit_log_append_only(t);
  END LOOP;
END $$;

-- Fork create_audit_log_table (live def) to attach the trigger to new tables and
-- to any pre-existing table it touches.
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
BEGIN
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
    PERFORM attach_audit_log_append_only(tbl_name);
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

  EXECUTE format('
    CREATE POLICY "audit_log_access" ON %I
    FOR ALL
    USING (true)
    WITH CHECK (true)
  ', tbl_name);

  PERFORM attach_audit_log_append_only(tbl_name);
END;
$function$;

-- Fork delete_old_audit_logs (live def) to set the transaction-local flag the
-- append-only trigger checks, so the retention/archival delete is permitted.
CREATE OR REPLACE FUNCTION public.delete_old_audit_logs(p_company_id text, p_cutoff_date timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  deleted_count INTEGER;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN 0;
  END IF;

  -- Authorize the append-only trigger to permit these retention deletes.
  PERFORM set_config('app.audit_archiving', 'on', true);

  EXECUTE format('
    WITH deleted AS (
      DELETE FROM %I
      WHERE "createdAt" < $1
      RETURNING *
    )
    SELECT COUNT(*) FROM deleted
  ', tbl_name)
  USING p_cutoff_date
  INTO deleted_count;

  RETURN deleted_count;
END;
$function$;

NOTIFY pgrst, 'reload schema';
