-- A workflow may now set a custom field. Setting one must not erase the others, and
-- reading the blob, merging in app code and writing it back races a concurrent human
-- edit — the person's change is silently dropped. So the merge happens server-side, in
-- one statement, with jsonb `||`.
--
-- SECURITY INVOKER: a workflow acts as its owner, and RLS on the target table is the
-- authorization gate, exactly as it is for the ordinary column update issued beside this
-- one. p_table is validated against "customFieldTable" — the global allowlist that
-- already exists — before it is ever interpolated into the dynamic statement.
CREATE OR REPLACE FUNCTION workflow_merge_custom_fields (
  p_table TEXT,
  p_id TEXT,
  p_company_id TEXT,
  p_values JSONB
)
RETURNS VOID
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "customFieldTable" WHERE "table" = p_table) THEN
    RAISE EXCEPTION 'Unknown custom field table: %', p_table;
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'p_values must be a JSON object';
  END IF;

  EXECUTE format(
    'UPDATE %I SET "customFields" = COALESCE("customFields", ''{}''::jsonb) || $1 '
    'WHERE "id" = $2 AND "companyId" = $3',
    p_table
  ) USING p_values, p_id, p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION workflow_merge_custom_fields(TEXT, TEXT, TEXT, JSONB) TO authenticated;
