-- A record's properties panel saves one custom field at a time. Writing the
-- whole "customFields" map from the panel's copy put back the old value of
-- every field another person saved on the same record after the panel loaded.
-- So a save sends only the fields it changes, and they are merged into the
-- stored map in the UPDATE itself: p_set is added with `||`, the keys in
-- p_clear are removed, and every other key keeps its stored value. Two saves of
-- one record therefore never lose each other's fields, whatever their order.
--
-- SECURITY INVOKER: row-level security on the target table decides which
-- records the caller may change, as it did for the plain column update this
-- replaces. p_table must be a custom field table and p_scope_column one of the
-- two tenant columns before either is interpolated. "customFields" is json on
-- a few tables, so it is read as jsonb and assigned back.
CREATE OR REPLACE FUNCTION set_record_custom_fields (
  p_table TEXT,
  p_ids TEXT[],
  p_scope_column TEXT,
  p_scope_id TEXT,
  p_set JSONB,
  p_clear TEXT[],
  p_updated_by TEXT
)
RETURNS TABLE ("id" TEXT)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "customFieldTable" WHERE "table" = p_table) THEN
    RAISE EXCEPTION 'Unknown custom field table: %', p_table;
  END IF;

  IF p_scope_column NOT IN ('companyId', 'companyGroupId') THEN
    RAISE EXCEPTION 'Unknown scope column: %', p_scope_column;
  END IF;

  IF p_set IS NULL OR jsonb_typeof(p_set) <> 'object' THEN
    RAISE EXCEPTION 'p_set must be a JSON object';
  END IF;

  RETURN QUERY EXECUTE format(
    'UPDATE %I SET '
    '"customFields" = (COALESCE("customFields"::jsonb, ''{}''::jsonb) || $1) - $2, '
    '"updatedBy" = $3, "updatedAt" = NOW() '
    'WHERE "id" = ANY($4) AND %I = $5 '
    'RETURNING "id"::TEXT',
    p_table,
    p_scope_column
  ) USING p_set, COALESCE(p_clear, '{}'::TEXT[]), p_updated_by, p_ids, p_scope_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_record_custom_fields(TEXT, TEXT[], TEXT, TEXT, JSONB, TEXT[], TEXT) TO anon, authenticated;
