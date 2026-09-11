-- Fix: partial secret updates silently wiped an integration's OTHER secrets.
--
-- The integration settings form loads secret fields MASKED (never sent to the
-- browser). On save, splitSecrets() (packages/ee/src/integrations/secrets.ts)
-- deliberately OMITS any secret whose field was left untouched — the documented
-- "unchanged, don't write" rule (D4a). For a multi-secret integration
-- (paperless-parts: apiKey + secretKey; xero/quickbooks/jira/onshape/rillet/email:
-- two each) that means a save which rotates ONE secret submits a bag with only
-- that secret, e.g. { "secretKey": "..." }.
--
-- upsert_integration_secret then called vault.update_secret(), which REPLACES the
-- whole stored bag. So the untouched secret (apiKey) was dropped from the vault.
-- resolveIntegrationSecrets() later merged the now-incomplete bag back onto the
-- metadata, leaving apiKey undefined, and the inbound Paperless Parts webhook
-- failed with a ZodError ("apiKey: expected string, received undefined") before
-- it could even verify the signature.
--
-- Fix: MERGE the incoming bag into the existing one on update, so an omitted key
-- keeps its stored value — exactly what splitSecrets' anti-overwrite rule
-- assumes. The bag is a FLAT { dotPath: value } map (keys like "apiKey" or
-- "credentials.accessToken"), so a shallow jsonb `||` merge is precisely correct.
--
-- CREATE OR REPLACE keeps the existing grants; the REVOKE/GRANT below are
-- re-stated (idempotent) to keep this migration self-describing. Signature is
-- unchanged from 20260817122916.
--
-- Note: a secret can no longer be REMOVED via this path (only overwritten or
-- added), which is correct for every current caller — individual secret removal
-- only happens on uninstall via delete_integration_secret(), which drops the
-- whole bag. A stale opposite-provider email secret may linger encrypted at rest
-- after an SMTP<->Resend switch; it is unused (the provider is chosen by a
-- non-secret field) and far preferable to silently wiping a live credential.
CREATE OR REPLACE FUNCTION upsert_integration_secret(p_company_id text, p_integration_id text, p_secret jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'integration:' || p_company_id || ':' || p_integration_id;
  v_id uuid;
  v_existing jsonb;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration secret');
  ELSE
    -- Merge into the stored bag: an omitted key keeps its existing value.
    SELECT decrypted_secret::jsonb INTO v_existing
      FROM vault.decrypted_secrets WHERE id = v_id;
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, (COALESCE(v_existing, '{}'::jsonb) || p_secret)::text);
  END IF;
  UPDATE "companyIntegration" SET "secretRef" = v_id::text
    WHERE "companyId" = p_company_id AND id = p_integration_id;
  RETURN v_id::text;
END;
$$;

-- Service-role only (re-stated; unchanged from the original definition).
REVOKE ALL ON FUNCTION upsert_integration_secret(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_integration_secret(text,text,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
