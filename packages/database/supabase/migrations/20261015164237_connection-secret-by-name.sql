-- Read a connection's secret by its vault NAME, never by the row's `secretRef`.
-- `secretRef` is a column a row's writer controls; the name is built from the
-- company and connection ids, so it can only ever resolve to this connection's own
-- secret. Every connection secret is written by `upsert_connection_secret` under
-- this name, and `delete_connection_secret` already deletes by it.
CREATE OR REPLACE FUNCTION get_connection_secret(p_company_id text, p_connection_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_secret text;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'get_connection_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A disconnected row has no secretRef; keep failing closed for it.
  IF NOT EXISTS (
    SELECT 1 FROM "integrationConnection"
      WHERE "companyId" = p_company_id AND "id" = p_connection_id
        AND "secretRef" IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
    WHERE name = 'connection:' || p_company_id || ':' || p_connection_id;
  IF v_secret IS NULL THEN RETURN NULL; END IF;
  RETURN v_secret::jsonb;
END;
$$;
