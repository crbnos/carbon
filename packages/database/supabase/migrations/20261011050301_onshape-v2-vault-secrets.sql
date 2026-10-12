-- NIST 800-171 3.13.16: moves `onshape-v2` OAuth tokens from
-- companyIntegration.metadata into Supabase Vault and strips them in the same
-- pass. Idempotent: a stripped row has nothing to vault.
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
