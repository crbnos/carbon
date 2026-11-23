-- Each webhook signs its deliveries with its own secret, kept in Supabase Vault
-- like integration secrets (20260817122916). The secret is created on first use —
-- the first delivery, or the first time someone reveals it in Settings — so
-- existing webhooks are signed from their next delivery on.
--
-- Secrets are named 'webhook:<companyId>:<webhookId>'. Reading and rolling are
-- service-role only; the delivery job and the settings route call them over a
-- direct (Kysely) connection.

CREATE OR REPLACE FUNCTION get_webhook_signing_secret(p_company_id text, p_webhook_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions AS $$
DECLARE
  v_name text := 'webhook:' || p_company_id || ':' || p_webhook_id;
  v_secret text;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'get_webhook_signing_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "webhook" WHERE "id" = p_webhook_id AND "companyId" = p_company_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = v_name;
  IF v_secret IS NOT NULL THEN
    RETURN v_secret;
  END IF;

  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  BEGIN
    PERFORM vault.create_secret(v_secret, v_name, 'Carbon webhook signing secret');
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent delivery created it first; use that one.
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = v_name;
  END;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION rotate_webhook_signing_secret(p_company_id text, p_webhook_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions AS $$
DECLARE
  v_name text := 'webhook:' || p_company_id || ':' || p_webhook_id;
  v_id uuid;
  v_secret text;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'rotate_webhook_signing_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "webhook" WHERE "id" = p_webhook_id AND "companyId" = p_company_id
  ) THEN
    RETURN NULL;
  END IF;

  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_secret, v_name, 'Carbon webhook signing secret');
  ELSE
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, v_secret);
  END IF;
  RETURN v_secret;
END;
$$;

-- Called by sync_webhook_subscription when a webhook row is deleted, including a
-- company delete's cascade. SECURITY INVOKER: from the SECURITY DEFINER
-- interceptor dispatcher it runs as the owner; called through the API it runs as
-- the caller, who cannot read the vault. Removes the secret only once its webhook
-- is gone.
CREATE OR REPLACE FUNCTION delete_webhook_signing_secret(p_company_id text, p_webhook_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, vault AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "webhook" WHERE "id" = p_webhook_id AND "companyId" = p_company_id
  ) THEN
    RETURN;
  END IF;
  DELETE FROM vault.secrets WHERE name = 'webhook:' || p_company_id || ':' || p_webhook_id;
END;
$$;

-- Restricted by the guards above, never by REVOKE EXECUTE: on this Postgres image
-- an API role calling a function it lacks EXECUTE on crashes the backend.

NOTIFY pgrst, 'reload schema';
