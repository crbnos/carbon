-- Printer API keys (the ProxyBox X-API-Key) move out of plain text on
-- "printerRoute" into Supabase Vault, like integration (20260817122916) and
-- webhook (20261017030352) secrets. They were also sent to every signed-in
-- user's browser through the ERP and MES layouts, which load printer routes.
--
-- Secrets are named 'printer:<companyId>:<printerRouteId>'. Reading and writing
-- are service role only (guards, never REVOKE EXECUTE: on this Postgres image
-- that crashes the backend). "printerRoute"."hasApiKey" is the flag the UI reads.

ALTER TABLE "printerRoute" ADD COLUMN "hasApiKey" BOOLEAN NOT NULL DEFAULT false;

-- Sets, replaces, or (with a null or empty key) removes a printer's API key.
-- A key is only stored for a route that exists; removing works after the route
-- is deleted, so the delete can clear its secret last.
CREATE OR REPLACE FUNCTION set_printer_api_key(
  p_company_id text,
  p_printer_route_id text,
  p_api_key text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'printer:' || p_company_id || ':' || p_printer_route_id;
  v_key text := NULLIF(p_api_key, '');
  v_id uuid;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'set_printer_api_key is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_key IS NULL THEN
    DELETE FROM vault.secrets WHERE name = v_name;
    UPDATE "printerRoute" SET "hasApiKey" = false
      WHERE "id" = p_printer_route_id AND "companyId" = p_company_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "printerRoute" WHERE "id" = p_printer_route_id AND "companyId" = p_company_id
  ) THEN
    RAISE EXCEPTION 'Printer route % not found', p_printer_route_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_key, v_name, 'Carbon printer API key');
  ELSE
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, v_key);
  END IF;
  UPDATE "printerRoute" SET "hasApiKey" = true
    WHERE "id" = p_printer_route_id AND "companyId" = p_company_id;
END;
$$;

-- The printer's API key, or null. A secret whose route is gone is never read.
CREATE OR REPLACE FUNCTION get_printer_api_key(p_company_id text, p_printer_route_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_secret text;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'get_printer_api_key is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "printerRoute" WHERE "id" = p_printer_route_id AND "companyId" = p_company_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
    WHERE name = 'printer:' || p_company_id || ':' || p_printer_route_id;
  RETURN v_secret;
END;
$$;

-- Move the existing keys into the vault in one pass, then drop the column.
SELECT vault.create_secret("apiKey", 'printer:' || "companyId" || ':' || "id", 'Carbon printer API key')
FROM "printerRoute"
WHERE NULLIF("apiKey", '') IS NOT NULL;

UPDATE "printerRoute" SET "hasApiKey" = true WHERE NULLIF("apiKey", '') IS NOT NULL;

ALTER TABLE "printerRoute" DROP COLUMN "apiKey";

NOTIFY pgrst, 'reload schema';
