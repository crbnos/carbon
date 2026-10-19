-- The app keeps the event KEY in the database's Inngest URL current on boot,
-- and leaves the address alone once one is stored: the database may reach
-- Inngest somewhere the app does not, and that address is set by whoever
-- deploys it (set_inngest_event_url). With nothing stored yet, the URL is
-- created from the app's own base.
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
