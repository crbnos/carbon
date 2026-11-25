CREATE OR REPLACE FUNCTION public.get_company_id_from_api_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  BEGIN
    RETURN (SELECT k.company_id FROM util.request_api_key() k);
  END;
$function$;
