-- Add tableName column to audit log tables
-- Separates the raw DB table name from the semantic entity type
--
-- tableName = raw DB table name (e.g., "item", "itemCost", "purchaseOrder")
-- entityType = semantic domain entity (e.g., "item", "purchaseOrder", "salesCustomer")
--
-- This allows grouping related tables under one entity type
-- (e.g., both "item" and "itemCost" tables map to entityType "item")

-- Drop existing functions first
DROP FUNCTION IF EXISTS public.create_audit_log_table CASCADE;
DROP FUNCTION IF EXISTS public.insert_audit_log_batch CASCADE;
DROP FUNCTION IF EXISTS public.get_entity_audit_log CASCADE;
DROP FUNCTION IF EXISTS public.get_audit_log CASCADE;
DROP FUNCTION IF EXISTS public.get_audit_log_count CASCADE;
DROP FUNCTION IF EXISTS public.get_audit_logs_for_archive CASCADE;
DROP FUNCTION IF EXISTS public.delete_old_audit_logs CASCADE;

-- Helper function to map table name to entity type
CREATE OR REPLACE FUNCTION public.audit_table_to_entity_type(p_table_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_table_name
    WHEN 'customer' THEN 'salesCustomer'
    WHEN 'supplier' THEN 'purchaseSupplier'
    WHEN 'itemCost' THEN 'item'
    WHEN 'job' THEN 'productionJob'
    WHEN 'quote' THEN 'salesQuote'
    ELSE p_table_name
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Migrate existing per-company tables: add tableName column and backfill
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'auditLog_%'
    AND table_name != 'auditLogArchive'
  LOOP
    -- Add tableName column if not exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND information_schema.columns.table_name = tbl.table_name AND column_name = 'tableName'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "tableName" TEXT', tbl.table_name);
    END IF;

    -- Backfill tableName from existing entityType (which currently holds the table name)
    EXECUTE format('UPDATE %I SET "tableName" = "entityType" WHERE "tableName" IS NULL', tbl.table_name);

    -- Update entityType to the new semantic domain values
    EXECUTE format('UPDATE %I SET "entityType" = audit_table_to_entity_type("tableName")', tbl.table_name);

    -- Make tableName NOT NULL after backfill
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "tableName" SET NOT NULL', tbl.table_name);
  END LOOP;
END;
$$;

-- Recreate create_audit_log_table with tableName column
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    -- Table exists; ensure tableName column is present (for tables created before this migration)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND information_schema.columns.table_name = tbl_name AND column_name = 'tableName'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "tableName" TEXT', tbl_name);
      EXECUTE format('UPDATE %I SET "tableName" = "entityType" WHERE "tableName" IS NULL', tbl_name);
      EXECUTE format('UPDATE %I SET "entityType" = audit_table_to_entity_type("tableName")', tbl_name);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "tableName" SET NOT NULL', tbl_name);
    END IF;
    RETURN;
  END IF;

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      "id" TEXT PRIMARY KEY DEFAULT id(''aud''),
      "tableName" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate insert_audit_log_batch with tableName
CREATE OR REPLACE FUNCTION public.insert_audit_log_batch(
  p_company_id TEXT,
  p_entries JSONB[]
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  entry JSONB;
  inserted_count INTEGER := 0;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  PERFORM create_audit_log_table(p_company_id);

  FOREACH entry IN ARRAY p_entries
  LOOP
    EXECUTE format('
      INSERT INTO %I ("tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    ', tbl_name)
    USING 
      entry->>'tableName',
      entry->>'entityType',
      entry->>'entityId',
      entry->>'operation',
      entry->>'actorId',
      CASE WHEN entry->'diff' = 'null'::jsonb THEN NULL ELSE entry->'diff' END,
      CASE WHEN entry->'metadata' = 'null'::jsonb THEN NULL ELSE entry->'metadata' END;
    
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate get_entity_audit_log — queries by tableName (raw table) + entityId
CREATE OR REPLACE FUNCTION public.get_entity_audit_log(
  p_company_id TEXT,
  p_table_name TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
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
    WHERE "tableName" = $1 AND "entityId" = $2
    ORDER BY "createdAt" DESC
    LIMIT $3 OFFSET $4
  ', tbl_name)
  USING p_table_name, p_entity_id, p_limit, p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate get_audit_log with tableName support
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

-- Recreate get_audit_log_count
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

-- Recreate get_audit_logs_for_archive with tableName
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

-- Recreate delete_old_audit_logs (unchanged logic)
CREATE OR REPLACE FUNCTION public.delete_old_audit_logs(
  p_company_id TEXT,
  p_cutoff_date TIMESTAMP WITH TIME ZONE
)
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
