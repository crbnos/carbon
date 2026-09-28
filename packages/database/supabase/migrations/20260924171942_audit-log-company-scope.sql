-- Scope the audit log to the company it belongs to.
--
-- The per-company "auditLog_<companyId>" tables had one policy,
-- "audit_log_access" FOR ALL USING (true) WITH CHECK (true), with the default
-- anon/authenticated table grants — so anyone holding the public anon key could
-- read or append to any company's audit history given its id. Every audit RPC is
-- SECURITY DEFINER, EXECUTE-able by anon, and checked nothing: get_audit_log read
-- any company's log, insert_audit_log_batch forged entries, delete_old_audit_logs
-- erased them, and drop_audit_log_table dropped the table outright.
--
-- After this migration:
--   read    — get_entity_audit_log / get_audit_log / get_audit_log_count, and
--             a direct SELECT on the table, need settings_view in that company.
--   enable  — create_audit_log_table needs settings_update in that company.
--   the rest (insert, archive, delete, drop) — service role only; every caller
--             (the AUDIT event handler, the archive job, the invite / ITAR /
--             acknowledge routes) already uses it.
-- The service role and direct Postgres connections (role "none") pass every
-- guard: the check is on the API role PostgREST switched to, which a SECURITY
-- DEFINER function still sees in current_setting('role').
--
-- The guards are checks INSIDE each function, not REVOKE EXECUTE. On this
-- Postgres build (supabase/postgres 15.14.1.112) calling ANY function the
-- caller lacks EXECUTE on, as anon or authenticated, segfaults the backend and
-- restarts the whole server — so a REVOKE on a function PostgREST exposes turns
-- a data leak into an unauthenticated one-request DoS. A RAISE is an ordinary
-- error. Table-level REVOKEs are unaffected and are used below.

-- p_permission NULL means no API role may call it at all (service role only).
CREATE OR REPLACE FUNCTION public.assert_audit_log_access(
  p_company_id TEXT,
  p_permission TEXT
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;

  IF p_permission IS NOT NULL AND p_company_id = ANY (
    COALESCE(get_companies_with_employee_permission(p_permission), '{}')::text[]
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Not authorized to access the audit log for this company'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- One company's table: a read policy scoped to that company, and no API writes.
-- Called for existing tables below and by create_audit_log_table for new ones —
-- the default privileges on "public" grant ALL to anon/authenticated on every
-- table the owner creates, so each new table has to be locked down as it is made.
CREATE OR REPLACE FUNCTION public.secure_audit_log_table(p_company_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tbl_name TEXT := 'auditLog_' || p_company_id;
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS "audit_log_access" ON %I', tbl_name);
  EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON %I', tbl_name);
  EXECUTE format(
    'CREATE POLICY "SELECT" ON %I FOR SELECT USING (
       %L = ANY ((SELECT get_companies_with_employee_permission(''settings_view''))::text[])
     )',
    tbl_name, p_company_id
  );
  EXECUTE format(
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM anon, authenticated',
    tbl_name
  );
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'auditLog\_%' ESCAPE '\'
  LOOP
    PERFORM secure_audit_log_table(substring(t FROM length('auditLog_') + 1));
  END LOOP;
END $$;

-- Fork create_audit_log_table (live def, 20260818014100): guard first, then
-- secure_audit_log_table on both the existing-table and the new-table path.
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
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
    PERFORM attach_audit_log_append_only(tbl_name);
    PERFORM secure_audit_log_table(p_company_id);
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

-- Fork get_entity_audit_log (live def, 20260418000000) with the read guard.
CREATE OR REPLACE FUNCTION public.get_entity_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_record_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "tableName" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "recordId" TEXT,
  "operation" TEXT,
  "actorId" TEXT,
  "diff" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ
) AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  IF p_record_id IS NULL THEN
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE format('
      SELECT "id", "tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt"
      FROM %I
      WHERE "entityType" = $1 AND "entityId" = $2 AND "recordId" = $3
      ORDER BY "createdAt" DESC
      LIMIT $4 OFFSET $5
    ', tbl_name)
    USING p_entity_type, p_entity_id, p_record_id, p_limit, p_offset;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fork get_audit_log (live def, 20260217120000) with the read guard.
CREATE OR REPLACE FUNCTION public.get_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "tableName" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "operation" TEXT,
  "actorId" TEXT,
  "diff" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ,
  "totalCount" BIGINT
) AS $$
DECLARE
  tbl_name TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
  where_clause TEXT := '';
  query_text TEXT;
  count_query TEXT;
  total BIGINT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  IF p_entity_type IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityType" = %L', p_entity_type));
  END IF;

  IF p_entity_id IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityId" = %L', p_entity_id));
  END IF;

  IF p_actor_id IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"actorId" = %L', p_actor_id));
  END IF;

  IF p_operation IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"operation" = %L', p_operation));
  END IF;

  IF p_start_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" >= %L', p_start_date));
  END IF;

  IF p_end_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" <= %L', p_end_date));
  END IF;

  IF p_search IS NOT NULL AND p_search != '' THEN
    where_clauses := array_append(where_clauses,
      format('"entityId" ILIKE %L', '%' || p_search || '%'));
  END IF;

  IF array_length(where_clauses, 1) > 0 THEN
    where_clause := 'WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;

  count_query := format('SELECT COUNT(*) FROM %I %s', tbl_name, where_clause);
  EXECUTE count_query INTO total;

  query_text := format('
    SELECT "id", "tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt", %s::BIGINT as "totalCount"
    FROM %I
    %s
    ORDER BY "createdAt" DESC
    LIMIT %s OFFSET %s
  ', total, tbl_name, where_clause, p_limit, p_offset);

  RETURN QUERY EXECUTE query_text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fork get_audit_log_count (live def, 20260217120000) with the read guard.
CREATE OR REPLACE FUNCTION public.get_audit_log_count(
  p_company_id TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
  where_clause TEXT := '';
  count_val INTEGER;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, 'settings_view');

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN 0;
  END IF;

  IF p_entity_type IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"entityType" = %L', p_entity_type));
  END IF;

  IF p_actor_id IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"actorId" = %L', p_actor_id));
  END IF;

  IF p_operation IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"operation" = %L', p_operation));
  END IF;

  IF p_start_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" >= %L', p_start_date));
  END IF;

  IF p_end_date IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('"createdAt" <= %L', p_end_date));
  END IF;

  IF p_search IS NOT NULL AND p_search != '' THEN
    where_clauses := array_append(where_clauses,
      format('"entityId" ILIKE %L', '%' || p_search || '%'));
  END IF;

  IF array_length(where_clauses, 1) > 0 THEN
    where_clause := 'WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;

  EXECUTE format('SELECT COUNT(*)::INTEGER FROM %I %s', tbl_name, where_clause) INTO count_val;
  RETURN count_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The remaining audit functions are service role only.

-- insert_audit_log is the pre-batch single-row writer. It still writes the
-- "actorName" column that 20260212174458 dropped, so it cannot succeed, and
-- nothing calls it.
DROP FUNCTION IF EXISTS public.insert_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);

-- Fork drop_audit_log_table (live def, 20260212154954).
CREATE OR REPLACE FUNCTION public.drop_audit_log_table(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', tbl_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fork insert_audit_log_batch (live def, 20260427120000).
CREATE OR REPLACE FUNCTION public.insert_audit_log_batch(
  p_company_id TEXT,
  p_entries JSONB[]
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  entry JSONB;
  inserted_count INTEGER := 0;
  v_created_at TIMESTAMPTZ;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  PERFORM create_audit_log_table(p_company_id);

  FOREACH entry IN ARRAY p_entries
  LOOP
    -- Use the entry's createdAt if provided (the original event time);
    -- otherwise fall back to clock_timestamp() so rows in the same
    -- transaction still get unique values rather than sharing NOW().
    v_created_at := COALESCE(
      (entry->>'createdAt')::TIMESTAMPTZ,
      clock_timestamp()
    );

    EXECUTE format('
      INSERT INTO %I ("tableName", "entityType", "entityId", "recordId", "operation", "actorId", "diff", "metadata", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ', tbl_name)
    USING
      entry->>'tableName',
      entry->>'entityType',
      entry->>'entityId',
      entry->>'recordId',
      entry->>'operation',
      entry->>'actorId',
      CASE WHEN entry->'diff' = 'null'::jsonb THEN NULL ELSE entry->'diff' END,
      CASE WHEN entry->'metadata' = 'null'::jsonb THEN NULL ELSE entry->'metadata' END,
      v_created_at;

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fork get_audit_logs_for_archive (live def, 20260217120000).
CREATE OR REPLACE FUNCTION public.get_audit_logs_for_archive(
  p_company_id TEXT,
  p_before_date TIMESTAMPTZ
)
RETURNS TABLE (
  "id" TEXT,
  "tableName" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "operation" TEXT,
  "actorId" TEXT,
  "diff" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ
) AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT "id", "tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "createdAt" < $1
    ORDER BY "createdAt" ASC
  ', tbl_name)
  USING p_before_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fork delete_old_audit_logs (live def, 20260818014100).
CREATE OR REPLACE FUNCTION public.delete_old_audit_logs(p_company_id text, p_cutoff_date timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  tbl_name TEXT;
  deleted_count INTEGER;
BEGIN
  PERFORM assert_audit_log_access(p_company_id, NULL);

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
