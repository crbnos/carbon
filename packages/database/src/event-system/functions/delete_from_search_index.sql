CREATE OR REPLACE FUNCTION public.delete_from_search_index(p_company_id text, p_entity_type text, p_entity_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_table_name TEXT;
BEGIN
  v_table_name := 'searchIndex_' || p_company_id;
  
  EXECUTE format(
    'DELETE FROM %I WHERE "entityType" = $1 AND "entityId" = $2',
    v_table_name
  ) USING p_entity_type, p_entity_id;
END;
$function$;
