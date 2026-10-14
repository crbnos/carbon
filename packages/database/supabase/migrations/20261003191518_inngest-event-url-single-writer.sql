-- The Inngest event URL has several writers (the app when it registers with
-- Inngest, the deploy, an operator), and two of them can run at once. Both
-- setters now take one transaction-scoped advisory lock, so a second caller
-- waits and then sees what the first stored: on a database with no URL yet it
-- no longer fails on the Vault's unique name. Bodies copied forward from
-- 20261003134512 and 20261003142107.
CREATE OR REPLACE FUNCTION public.set_inngest_event_url(p_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  secret_id UUID;
  current_url TEXT;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inngest_event_url'));

  SELECT id, decrypted_secret INTO secret_id, current_url
  FROM vault.decrypted_secrets WHERE name = 'inngest_event_url';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_url, 'inngest_event_url');
  ELSIF current_url IS DISTINCT FROM p_url THEN
    PERFORM vault.update_secret(secret_id, p_url);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_inngest_event_config(p_key TEXT, p_base_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  secret_id UUID;
  current_url TEXT;
  new_url TEXT;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(p_key, '') = '' THEN
    RAISE EXCEPTION 'An event key is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inngest_event_url'));

  SELECT id, decrypted_secret INTO secret_id, current_url
  FROM vault.decrypted_secrets WHERE name = 'inngest_event_url';

  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(
      rtrim(p_base_url, '/') || '/e/' || p_key,
      'inngest_event_url'
    );
    RETURN;
  END IF;

  -- Only a URL of the expected shape (…/e/<key>) is rewritten.
  IF current_url !~ '/e/[^/]*$' THEN
    RETURN;
  END IF;
  new_url := substring(current_url FROM '^(.*/e/)[^/]*$') || p_key;
  IF new_url IS DISTINCT FROM current_url THEN
    PERFORM vault.update_secret(secret_id, new_url);
  END IF;
END;
$$;
