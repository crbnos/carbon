-- NIST 800-171 3.13.16: one-time backfill — move every existing plaintext
-- integration secret out of companyIntegration.metadata INTO Supabase Vault AND
-- strip the plaintext, in a single auto-applied, idempotent pass.
--
-- This supersedes the manual TS backfill script + the separate scrub migration.
-- Those split the work in two: a manual `secretRef` backfill and an
-- auto-applied scrub gated on `secretRef IS NOT NULL`. On a normal deploy the
-- scrub ran BEFORE the manual step, matched zero rows, and never re-ran — so the
-- plaintext survived forever. Doing both here removes that ordering foot-gun:
-- the vault-move sets secretRef and the strip happens in the same statement.
--
-- The secret-path map below is a FROZEN snapshot of @carbon/ee's SECRET_KEYS at
-- backfill time. Runtime writes keep using that canonical TS map via
-- persistIntegrationSecrets; this migration only transforms rows that already
-- exist, so the snapshot never needs to stay in sync with the TS source.
--
-- Depends on upsert_integration_secret (20260817122916). metadata is a `json`
-- column, so cast json -> jsonb for path ops and back on write, matching the
-- vault reader's flat {dotPath: value} bag exactly (resolveIntegrationSecrets
-- setPath()s each dot key back onto the metadata copy).

-- Vault + strip one row for a set of dot-paths. Idempotent: re-running re-vaults
-- the same vault name (upsert) and re-strips already-absent paths (a no-op).
-- Only paths whose value is present and non-empty are vaulted — mirrors
-- splitSecrets' anti-overwrite rule so an empty placeholder is never stored.
CREATE OR REPLACE FUNCTION _backfill_integration_secret(
  p_company_id text, p_integration_id text, p_paths text[]
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_meta jsonb;
  v_bag  jsonb := '{}'::jsonb;
  v_path text;
  v_val  jsonb;
BEGIN
  SELECT metadata::jsonb INTO v_meta FROM "companyIntegration"
    WHERE "companyId" = p_company_id AND id = p_integration_id;
  IF v_meta IS NULL THEN RETURN; END IF;

  -- Collect present, non-empty secret values into a flat {dotPath: value} bag.
  FOREACH v_path IN ARRAY p_paths LOOP
    v_val := v_meta #> string_to_array(v_path, '.');
    IF v_val IS NOT NULL AND v_val <> '""'::jsonb THEN
      v_bag := v_bag || jsonb_build_object(v_path, v_val);
    END IF;
  END LOOP;

  -- Nothing to vault (already stripped, or never carried a secret) → done.
  IF v_bag = '{}'::jsonb THEN RETURN; END IF;

  PERFORM upsert_integration_secret(p_company_id, p_integration_id, v_bag);

  -- Strip every secret path from the plaintext column.
  FOREACH v_path IN ARRAY p_paths LOOP
    v_meta := v_meta #- string_to_array(v_path, '.');
  END LOOP;
  UPDATE "companyIntegration" SET metadata = v_meta::json
    WHERE "companyId" = p_company_id AND id = p_integration_id;
END;
$$;

-- Drive the backfill. A known integration is vaulted+stripped; an UNKNOWN
-- integration whose metadata looks secret-bearing ABORTS the migration loudly
-- rather than silently leaving plaintext behind — add it to the map (here and in
-- @carbon/ee SECRET_KEYS) and redeploy.
DO $$
DECLARE
  r RECORD;
  v_paths text[];
BEGIN
  FOR r IN SELECT id, "companyId", metadata FROM "companyIntegration" LOOP
    v_paths := CASE r.id
      WHEN 'linear'          THEN ARRAY['apiKey']
      WHEN 'resend'          THEN ARRAY['apiKey']
      WHEN 'slack'           THEN ARRAY['access_token']
      WHEN 'paperless-parts' THEN ARRAY['apiKey', 'secretKey']
      WHEN 'email'           THEN ARRAY['apiKey', 'password']
      WHEN 'jira'            THEN ARRAY['credentials.accessToken', 'credentials.refreshToken']
      WHEN 'onshape'         THEN ARRAY['credentials.accessToken', 'credentials.refreshToken']
      WHEN 'xero'            THEN ARRAY['credentials.accessToken', 'credentials.refreshToken']
      WHEN 'quickbooks'      THEN ARRAY['credentials.accessToken', 'credentials.refreshToken']
      WHEN 'rillet'          THEN ARRAY['credentials.apiKey', 'credentials.providerMetadata.webhookToken']
      ELSE NULL
    END;

    IF v_paths IS NULL THEN
      IF r.metadata::text ~* '"(apiKey|api_key|access_token|accessToken|refreshToken|secretKey|password|webhookToken|token|secret)"\s*:' THEN
        RAISE EXCEPTION
          'companyIntegration "%" (company %) has secret-looking metadata but is not in the backfill map — add it to @carbon/ee SECRET_KEYS and this migration before deploying.',
          r.id, r."companyId";
      END IF;
      CONTINUE;
    END IF;

    PERFORM _backfill_integration_secret(r."companyId", r.id, v_paths);
  END LOOP;
END $$;

-- One-shot helper: drop it so it never becomes API surface.
DROP FUNCTION IF EXISTS _backfill_integration_secret(text, text, text[]);
