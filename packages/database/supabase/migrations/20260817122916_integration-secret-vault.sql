-- NIST 800-171 3.13.16: encrypt integration secrets in Supabase Vault.
-- supabase_vault is pgsodium-backed; the supabase/postgres image preloads
-- pgsodium in shared_preload_libraries. If this CREATE fails, the extension is
-- unavailable — an infra prerequisite, not something to work around.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault CASCADE;

ALTER TABLE "companyIntegration" ADD COLUMN IF NOT EXISTS "secretRef" TEXT;

-- Upsert an integration's secret bag (flat {path: value} JSON) into the vault,
-- keyed by a deterministic name; store the vault id back on the row.
CREATE OR REPLACE FUNCTION upsert_integration_secret(p_company_id text, p_integration_id text, p_secret jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'integration:' || p_company_id || ':' || p_integration_id;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration secret');
  ELSE
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, p_secret::text);
  END IF;
  UPDATE "companyIntegration" SET "secretRef" = v_id::text
    WHERE "companyId" = p_company_id AND id = p_integration_id;
  RETURN v_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION get_integration_secret(p_company_id text, p_integration_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_ref text;
  v_secret text;
BEGIN
  SELECT "secretRef" INTO v_ref FROM "companyIntegration"
    WHERE "companyId" = p_company_id AND id = p_integration_id;
  IF v_ref IS NULL THEN RETURN NULL; END IF;  -- caller applies transitional fallback / fails closed
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_ref::uuid;
  IF v_secret IS NULL THEN RETURN NULL; END IF;
  RETURN v_secret::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION delete_integration_secret(p_company_id text, p_integration_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'integration:' || p_company_id || ':' || p_integration_id;
END;
$$;

-- Service-role only. The app calls these via getCarbonServiceRole(); no user
-- client (anon/authenticated) may decrypt a secret.
REVOKE ALL ON FUNCTION upsert_integration_secret(text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_integration_secret(text,text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_integration_secret(text,text)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_integration_secret(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_integration_secret(text,text)          TO service_role;
GRANT EXECUTE ON FUNCTION delete_integration_secret(text,text)       TO service_role;

-- Cascade: drop the paired vault secret when the integration row is deleted
-- (vault.secrets does not cascade on its own).
CREATE OR REPLACE FUNCTION drop_integration_secret_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'integration:' || OLD."companyId" || ':' || OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_drop_integration_secret ON "companyIntegration";
CREATE TRIGGER trg_drop_integration_secret
  AFTER DELETE ON "companyIntegration"
  FOR EACH ROW EXECUTE FUNCTION drop_integration_secret_on_delete();

NOTIFY pgrst, 'reload schema';
