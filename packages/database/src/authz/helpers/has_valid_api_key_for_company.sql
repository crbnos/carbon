CREATE OR REPLACE FUNCTION public.has_valid_api_key_for_company(company text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  DECLARE
    has_valid_key boolean;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN FALSE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "apiKey"
      WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
        AND "companyId" = company
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    ) INTO has_valid_key;

    RETURN has_valid_key;
  END;
$function$;
