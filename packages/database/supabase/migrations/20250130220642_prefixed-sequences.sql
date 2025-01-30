CREATE OR REPLACE FUNCTION get_next_prefixed_sequence(company_id text, item_type "itemType", prefix text)
RETURNS text AS $$
BEGIN
  RETURN (
    SELECT "readableId"
    FROM "item"
    WHERE "companyId" = company_id
    AND "type" = item_type
    AND "readableId" LIKE prefix || '%'
    AND substring("readableId" from (length(prefix) + 1)) ~ '^[0-9]+$'
    ORDER BY "readableId" DESC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;