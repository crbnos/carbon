-- upsert_integration_secret REPLACED the whole secret bag. Every caller that
-- writes only some of an integration's secrets therefore destroyed the rest.
--
-- The live example this fixes: the settings-save path builds metadata from the
-- raw companyIntegration row (a plain select, with the vaulted secrets NOT
-- merged back in) and hands it to persistIntegrationSecrets. splitSecrets then
-- sees only what the form posted, so saving a form that carries one secret
-- writes a bag containing just that one — silently deleting the OAuth
-- accessToken/refreshToken that were in it. Recovery is a full reconnect.
--
-- Already reachable on main for `rillet`, whose SECRET_KEYS lists two
-- form-written paths (credentials.apiKey and
-- credentials.providerMetadata.webhookToken): a save filling one and leaving the
-- other blank destroys the blank one. It becomes reachable for Onshape v2 the
-- moment webhookSigningSecret is classified as a secret alongside the OAuth
-- tokens.
--
-- Merge is the correct semantics, not a workaround: splitSecrets already treats
-- an empty or absent value as "unchanged, do not write" and strips it from the
-- payload, so a caller has no way to express "remove this key" through this
-- function anyway. Wholesale removal is delete_integration_secret's job, which
-- the uninstall path and the AFTER DELETE trigger both use.
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
    -- Merge over what is already stored. A corrupt (non-JSON) bag raises here
    -- rather than being silently overwritten — that is a bug worth surfacing.
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
