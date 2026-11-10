CREATE OR REPLACE FUNCTION util.request_api_key()
 RETURNS TABLE(id text, company_id text)
 LANGUAGE sql
 STABLE
AS $function$
  -- The API key the request carries in its carbon-key header, when it is valid and
  -- unexpired: the one place that reads the header, hashes it and checks expiry.
  -- Not SECURITY DEFINER and no SET search_path (names are qualified), so Postgres
  -- inlines it into its callers, which are SECURITY DEFINER.
  SELECT k.id, k."companyId"
  FROM public."apiKey" k
  WHERE k."keyHash" = encode(extensions.digest((((current_setting('request.headers'::text, true))::json ->> 'carbon-key'))::bytea, 'sha256'::text), 'hex')
    AND (k."expiresAt" IS NULL OR k."expiresAt" > now())
$function$;
