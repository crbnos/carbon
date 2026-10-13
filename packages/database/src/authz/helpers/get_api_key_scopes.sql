CREATE OR REPLACE FUNCTION public.get_api_key_scopes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  DECLARE
    scopes JSONB;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT "apiKey"."scopes" INTO scopes
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    RETURN scopes;
  END;
$function$;
