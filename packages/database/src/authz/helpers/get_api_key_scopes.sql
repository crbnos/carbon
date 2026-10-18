CREATE OR REPLACE FUNCTION public.get_api_key_scopes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  DECLARE
    raw_key TEXT;
    key_id TEXT;
    key_company TEXT;
    grant_rows JSONB;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT id, "companyId" INTO key_id, key_company
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());
    IF key_id IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', 'key',
        'module', p.module,
        'page', p.page,
        'level', p.level
      ) ORDER BY p.module, p.page NULLS FIRST), '[]'::jsonb)
    INTO grant_rows
    FROM permission p
    WHERE p."apiKeyId" = key_id AND p."companyId" = key_company;

    RETURN jsonb_build_object('grants', grant_rows);
  END;
$function$;
