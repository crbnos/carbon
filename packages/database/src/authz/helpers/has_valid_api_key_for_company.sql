CREATE OR REPLACE FUNCTION public.has_valid_api_key_for_company(company text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  BEGIN
    RETURN EXISTS (SELECT 1 FROM util.request_api_key() k WHERE k.company_id = company);
  END;
$function$;
