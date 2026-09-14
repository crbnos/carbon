-- NIST 800-171 3.13.16: `onshape-v2` joins @carbon/ee SECRET_KEYS, so its OAuth
-- tokens move out of companyIntegration.metadata INTO Supabase Vault.
--
-- The integration was added after 20260817132607 ran, and was never in that
-- migration's map, so every existing v2 row still carries plaintext tokens.
-- This is the same move-and-strip, for one integration id: vault the present,
-- non-empty values, then remove the paths from the column in the same pass so
-- the plaintext cannot outlive the vault write. Idempotent — a row already
-- stripped has nothing to vault and is skipped.
--
-- The jsonschema needs no change: 20260909174511 already left the token paths
-- out of it.
DO $$
DECLARE
  r RECORD;
  v_meta jsonb;
  v_bag  jsonb;
  v_path text;
  v_val  jsonb;
  v_paths text[] := ARRAY['credentials.accessToken', 'credentials.refreshToken'];
BEGIN
  FOR r IN
    SELECT "companyId", metadata FROM "companyIntegration" WHERE id = 'onshape-v2'
  LOOP
    v_meta := r.metadata::jsonb;
    IF v_meta IS NULL THEN CONTINUE; END IF;

    v_bag := '{}'::jsonb;
    FOREACH v_path IN ARRAY v_paths LOOP
      v_val := v_meta #> string_to_array(v_path, '.');
      IF v_val IS NOT NULL AND v_val <> '""'::jsonb AND v_val <> 'null'::jsonb THEN
        v_bag := v_bag || jsonb_build_object(v_path, v_val);
      END IF;
    END LOOP;

    IF v_bag <> '{}'::jsonb THEN
      PERFORM upsert_integration_secret(r."companyId", 'onshape-v2', v_bag);
    END IF;

    FOREACH v_path IN ARRAY v_paths LOOP
      v_meta := v_meta #- string_to_array(v_path, '.');
    END LOOP;
    UPDATE "companyIntegration" SET metadata = v_meta::json
      WHERE "companyId" = r."companyId" AND id = 'onshape-v2';
  END LOOP;
END $$;
