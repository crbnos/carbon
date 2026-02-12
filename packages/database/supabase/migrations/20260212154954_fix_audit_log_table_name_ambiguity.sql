-- Fix ambiguous table_name reference in audit log functions
-- Rename the variable to tbl_name to avoid conflict with information_schema.tables.table_name

-- Function to create a per-company audit log table
CREATE OR REPLACE FUNCTION create_audit_log_table(p_company_id TEXT)
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
    CREATE TABLE %I (
      "id" TEXT NOT NULL DEFAULT id(''aud''),
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "actorId" TEXT NOT NULL,
      "actorName" TEXT NOT NULL,
      "diff" JSONB,
      "metadata" JSONB,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

      CONSTRAINT %I PRIMARY KEY ("id"),
      CONSTRAINT %I 
        FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT %I
        CHECK ("operation" IN (''INSERT'', ''UPDATE'', ''DELETE''))
    )', 
    tbl_name,
    tbl_name || '_pkey',
    tbl_name || '_actorId_fkey',
    tbl_name || '_operation_check'
  );

  -- Create indexes
  EXECUTE format('CREATE INDEX %I ON %I("entityType", "entityId")', 
    tbl_name || '_entityType_entityId_idx', tbl_name);
  EXECUTE format('CREATE INDEX %I ON %I("createdAt" DESC)', 
    tbl_name || '_createdAt_idx', tbl_name);
  EXECUTE format('CREATE INDEX %I ON %I("actorId")', 
    tbl_name || '_actorId_idx', tbl_name);
  EXECUTE format('CREATE INDEX %I ON %I("operation")', 
    tbl_name || '_operation_idx', tbl_name);

  -- Enable RLS (no policies = service role only)
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to drop a per-company audit log table
CREATE OR REPLACE FUNCTION drop_audit_log_table(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', tbl_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to insert into a per-company audit log table
CREATE OR REPLACE FUNCTION insert_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_operation TEXT,
  p_actor_id TEXT,
  p_actor_name TEXT,
  p_diff JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  tbl_name TEXT;
  new_id TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "operation", "actorId", "actorName", "diff", "metadata")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING "id"
  ', tbl_name)
  USING p_entity_type, p_entity_id, p_operation, p_actor_id, p_actor_name, p_diff, p_metadata
  INTO new_id;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to batch insert into a per-company audit log table
CREATE OR REPLACE FUNCTION insert_audit_log_batch(
  p_company_id TEXT,
  p_entries JSONB
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  entry JSONB;
  inserted_count INTEGER := 0;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    EXECUTE format('
      INSERT INTO %I ("entityType", "entityId", "operation", "actorId", "actorName", "diff", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    ', tbl_name)
    USING 
      entry->>'entityType',
      entry->>'entityId',
      entry->>'operation',
      entry->>'actorId',
      entry->>'actorName',
      entry->'diff',
      entry->'metadata';
    
    inserted_count := inserted_count + 1;
  END LOOP;
  
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to query audit logs for an entity
CREATE OR REPLACE FUNCTION get_entity_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  operation TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  diff JSONB,
  metadata JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE
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
    SELECT "id", "entityType", "entityId", "operation", "actorId", "actorName", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "entityType" = $1 AND "entityId" = $2
    ORDER BY "createdAt" DESC
    LIMIT $3 OFFSET $4
  ', tbl_name)
  USING p_entity_type, p_entity_id, p_limit, p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to query all audit logs for a company with filters
CREATE OR REPLACE FUNCTION get_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  operation TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  diff JSONB,
  metadata JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  tbl_name TEXT;
  query TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
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
  
  IF p_search IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format(
      '("actorName" ILIKE %L OR "entityId" ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    ));
  END IF;
  
  -- Build query
  query := format('
    SELECT "id", "entityType", "entityId", "operation", "actorId", "actorName", "diff", "metadata", "createdAt"
    FROM %I
  ', tbl_name);
  
  IF array_length(where_clauses, 1) > 0 THEN
    query := query || ' WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;
  
  query := query || format(' ORDER BY "createdAt" DESC LIMIT %s OFFSET %s', p_limit, p_offset);
  
  RETURN QUERY EXECUTE query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get count of audit logs with filters
CREATE OR REPLACE FUNCTION get_audit_log_count(
  p_company_id TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_operation TEXT DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  query TEXT;
  where_clauses TEXT[] := ARRAY[]::TEXT[];
  result INTEGER;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  -- Check if table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN 0;
  END IF;
  
  -- Build WHERE clauses (same as get_audit_log)
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
  
  IF p_search IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format(
      '("actorName" ILIKE %L OR "entityId" ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    ));
  END IF;
  
  -- Build query
  query := format('SELECT COUNT(*)::INTEGER FROM %I', tbl_name);
  
  IF array_length(where_clauses, 1) > 0 THEN
    query := query || ' WHERE ' || array_to_string(where_clauses, ' AND ');
  END IF;
  
  EXECUTE query INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete old audit logs (for archival)
CREATE OR REPLACE FUNCTION delete_old_audit_logs(
  p_company_id TEXT,
  p_cutoff_date TIMESTAMP WITH TIME ZONE
)
RETURNS INTEGER AS $$
DECLARE
  tbl_name TEXT;
  deleted_count INTEGER;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;
  
  -- Check if table exists
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

-- Function to get all audit logs for archival
CREATE OR REPLACE FUNCTION get_audit_logs_for_archive(
  p_company_id TEXT,
  p_cutoff_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  id TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  operation TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  diff JSONB,
  metadata JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE
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
    SELECT "id", "entityType", "entityId", "operation", "actorId", "actorName", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "createdAt" < $1
    ORDER BY "createdAt" ASC
  ', tbl_name)
  USING p_cutoff_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
