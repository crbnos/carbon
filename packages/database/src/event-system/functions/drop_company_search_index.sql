CREATE OR REPLACE FUNCTION public.drop_company_search_index(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_table_name TEXT;
BEGIN
  v_table_name := 'searchIndex_' || p_company_id;

  -- Drop the search index table if it exists
  EXECUTE format('DROP TABLE IF EXISTS %I', v_table_name);

  -- Remove from registry
  DELETE FROM "searchIndexRegistry" WHERE "companyId" = p_company_id;
END;
$function$;
