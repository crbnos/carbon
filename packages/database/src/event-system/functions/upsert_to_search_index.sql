CREATE OR REPLACE FUNCTION public.upsert_to_search_index(p_company_id text, p_entity_type text, p_entity_id text, p_title text, p_description text, p_link text, p_tags text[], p_metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_table_name TEXT;
  v_search_text TEXT;
BEGIN
  v_table_name := 'searchIndex_' || p_company_id;
  v_search_text := p_title || ' ' || COALESCE(p_description, '') || ' ' || COALESCE(array_to_string(p_tags, ' '), '');
  
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector(''english'', $8))
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "link" = EXCLUDED."link",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING 
    p_entity_type, 
    p_entity_id, 
    p_title, 
    COALESCE(p_description, ''),
    p_link, 
    COALESCE(p_tags, ARRAY[]::text[]), 
    COALESCE(p_metadata, '{}'::jsonb),
    v_search_text;
END;
$function$;
