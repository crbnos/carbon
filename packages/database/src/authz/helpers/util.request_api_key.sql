CREATE OR REPLACE FUNCTION util.request_api_key()
 RETURNS TABLE(id text, company_id text)
 LANGUAGE sql
 STABLE
AS $function$
  -- The API key the request carries in its carbon-key header, when it is valid,
  -- unexpired and holds at least one grant in its company: the one place that
  -- reads the header, hashes it and checks expiry. A key with no grant is no
  -- member of the company, as admits (packages/database/src/access/admits.ts)
  -- refuses it, so every helper built on this one reads it as no key at all.
  -- Only grants on modules that have pages count: admits drops the rest (Items,
  -- Messaging, Printing), which no page can hold.
  -- Not SECURITY DEFINER and no SET search_path (names are qualified), so Postgres
  -- inlines it into its callers, which are SECURITY DEFINER.
  SELECT k.id, k."companyId"
  FROM public."apiKey" k
  WHERE k."keyHash" = encode(extensions.digest((((current_setting('request.headers'::text, true))::json ->> 'carbon-key'))::bytea, 'sha256'::text), 'hex')
    AND (k."expiresAt" IS NULL OR k."expiresAt" > now())
    AND EXISTS (
      SELECT 1 FROM public.permission p
      WHERE p."apiKeyId" = k.id
        AND p."companyId" = k."companyId"
        AND p.level <> 'None'::public."permissionLevel"
        AND util.module_pages(lower(p.module::text)) <> '{}'
    )
$function$;
