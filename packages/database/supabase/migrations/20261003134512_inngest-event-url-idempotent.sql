-- The app now calls set_inngest_event_url() on every boot, so an unchanged URL
-- must not rewrite the secret. Body copied forward from
-- 20261002170250_send-inngest-events-from-postgres.sql.
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

  SELECT id, decrypted_secret INTO secret_id, current_url
  FROM vault.decrypted_secrets WHERE name = 'inngest_event_url';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_url, 'inngest_event_url');
  ELSIF current_url IS DISTINCT FROM p_url THEN
    PERFORM vault.update_secret(secret_id, p_url);
  END IF;
END;
$$;
