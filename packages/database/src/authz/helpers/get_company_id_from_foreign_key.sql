CREATE OR REPLACE FUNCTION public.get_company_id_from_foreign_key(foreign_key text, tbl text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      company_id text;
    BEGIN
      -- Policies call this inside a query. Called as the API endpoint itself it would tell
      -- anyone holding the anon key which company owns any row id, so refuse that. PostgREST
      -- sets request.path to /rpc/<function> only for a direct call (any case, any trailing /).
      IF current_setting('request.path', true) ~* '/rpc/get_company_id_from_foreign_key/*$' THEN
        RAISE EXCEPTION 'get_company_id_from_foreign_key cannot be called through the API'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      EXECUTE format('SELECT "companyId" FROM %I WHERE id = $1', tbl) INTO company_id USING foreign_key;
      RETURN company_id;
    END;
$function$;
