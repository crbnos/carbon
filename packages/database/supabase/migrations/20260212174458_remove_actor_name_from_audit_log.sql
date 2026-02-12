-- Remove actorName from audit log tables and functions
-- The UI will resolve actor info from actorId instead

-- Drop existing functions first (they have different return types or conflicting signatures)
-- Use CASCADE to handle any dependencies
DROP FUNCTION IF EXISTS public.get_entity_audit_log CASCADE;
DROP FUNCTION IF EXISTS public.get_audit_log CASCADE;
DROP FUNCTION IF EXISTS public.get_audit_logs_for_archive CASCADE;
DROP FUNCTION IF EXISTS public.insert_audit_log_batch CASCADE;
DROP FUNCTION IF EXISTS public.create_audit_log_table CASCADE;

-- Update create_audit_log_table to not include actorName
CREATE OR REPLACE FUNCTION public.create_audit_log_table(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  -- Check if table already exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  -- Create the audit log table for this company
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      "id" TEXT PRIMARY KEY DEFAULT id(''aud''),
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "operation" TEXT NOT NULL CHECK ("operation" IN (''INSERT'', ''UPDATE'', ''DELETE'')),
      "actorId" TEXT,
      "diff" JSONB,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  ', tbl_name);

  -- Create indexes for common queries
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("entityType", "entityId")', 
    'idx_' || tbl_name || '_entity', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("actorId")', 
    'idx_' || tbl_name || '_actor', tbl_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("createdAt" DESC)', 
    'idx_' || tbl_name || '_created', tbl_name);

  -- Enable RLS
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl_name);
  
  -- Create RLS policy (company isolation is implicit via table name)
  EXECUTE format('
    CREATE POLICY "audit_log_access" ON %I
    FOR ALL
    USING (true)
    WITH CHECK (true)
  ', tbl_name);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update insert_audit_log_batch to not require actorName
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

  -- Ensure table exists
  PERFORM create_audit_log_table(p_company_id);

  -- Insert each entry
  FOREACH entry IN ARRAY p_entries
  LOOP
    EXECUTE format('
      INSERT INTO %I ("entityType", "entityId", "operation", "actorId", "diff", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6)
    ', tbl_name)
    USING 
      entry->>'entityType',
      entry->>'entityId',
      entry->>'operation',
      entry->>'actorId',
      entry->'diff',
      entry->'metadata';
    
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_entity_audit_log to not return actorName
CREATE OR REPLACE FUNCTION public.get_entity_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  "id" TEXT,
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

  -- Check if table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT "id", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "entityType" = $1 AND "entityId" = $2
    ORDER BY "createdAt" DESC
    LIMIT $3 OFFSET $4
  ', tbl_name)
  USING p_entity_type, p_entity_id, p_limit, p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_audit_log to not return actorName
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

  -- Check if table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  -- Build WHERE clauses
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

  -- Combine WHERE clauses
  IF array_length(where_clauses, 1) > 0 THEN
    where_clause := 'WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;

  -- Get total count
  count_query := format('SELECT COUNT(*) FROM %I %s', tbl_name, where_clause);
  EXECUTE count_query INTO total;

  -- Build and execute main query
  query_text := format('
    SELECT "id", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt", %s::BIGINT as "totalCount"
    FROM %I
    %s
    ORDER BY "createdAt" DESC
    LIMIT %s OFFSET %s
  ', total, tbl_name, where_clause, p_limit, p_offset);

  RETURN QUERY EXECUTE query_text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_audit_logs_for_archive to not return actorName
CREATE OR REPLACE FUNCTION public.get_audit_logs_for_archive(
  p_company_id TEXT,
  p_before_date TIMESTAMPTZ
)
RETURNS TABLE (
  "id" TEXT,
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

  -- Check if table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT "id", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "createdAt" < $1
    ORDER BY "createdAt" ASC
  ', tbl_name)
  USING p_before_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
