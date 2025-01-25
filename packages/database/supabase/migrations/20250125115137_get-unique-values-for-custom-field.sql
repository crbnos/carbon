CREATE OR REPLACE FUNCTION get_custom_field_unique_values(
  table_name text,
  field_key text,
  company_id text
)
RETURNS TABLE (value jsonb) AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT DISTINCT jsonb_extract_path("customFields", $1) as value
     FROM %I 
     WHERE "companyId" = $2
     AND "customFields" ? $1
     AND jsonb_extract_path("customFields", $1) IS NOT NULL',
    table_name
  ) USING field_key, company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

