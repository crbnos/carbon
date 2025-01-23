CREATE OR REPLACE FUNCTION get_next_numeric_sequence(company_id text, item_type "itemType")
RETURNS text AS $$
BEGIN
  RETURN (
    SELECT "readableId"
    FROM "item"
    WHERE "companyId" = company_id
    AND "type" = item_type
    AND "readableId" ~ '^[0-9]'
    AND "readableId" !~ '[A-Za-z]'
    ORDER BY "readableId" DESC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;
