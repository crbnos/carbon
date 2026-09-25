-- Replace REVOKE EXECUTE on API-exposed functions with in-function guards.
--
-- On supabase/postgres 15.14.1.112, calling a function the caller lacks EXECUTE
-- on, as anon or authenticated, segfaults the backend (signal 11) and the
-- postmaster restarts every connection. Reproduced with a plain
-- `LANGUAGE sql` function in a fresh container of that image; a RAISE, a
-- missing TABLE privilege and "must be owner" are all ordinary errors. Every
-- function in "public" is a PostgREST RPC, so each of the six below was an
-- unauthenticated one-request restart of the database:
--   POST /rest/v1/rpc/get_integration_secret  (anon key only)
--
-- The four integration-secret functions keep their service-role-only contract,
-- now enforced by the first statement of the body. PostgREST switches to the
-- JWT's role with SET ROLE, and a SECURITY DEFINER function still sees that in
-- current_setting('role'), so anon/authenticated are refused while the service
-- role and direct Postgres connections (role "none") pass. All four are only
-- called by service-role clients (packages/ee/src/integrations/secrets.ts,
-- apps/erp/app/modules/settings/settings.server.ts).
--
-- The two job helpers cannot use that guard: complete_job_to_inventory calls
-- them, and an MES user reaches it as authenticated, which the role GUC still
-- reports inside the nested call. They become SECURITY INVOKER instead. Called
-- from complete_job_to_inventory (SECURITY DEFINER) they run as its owner,
-- exactly as before; called directly through the API they run as the caller,
-- under RLS, and can touch only what that caller could already read or update
-- through the jobOperation table.

-- ---------------------------------------------------------------------------
-- Integration secrets (fork of the live defs: 20260911164732 for
-- upsert_integration_secret, 20260817122916 for get/delete, 20260919152233 for
-- upsert_company_integration_patch), guard added as the first statement.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION upsert_integration_secret(p_company_id text, p_integration_id text, p_secret jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'integration:' || p_company_id || ':' || p_integration_id;
  v_id uuid;
  v_existing jsonb;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'upsert_integration_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration secret');
  ELSE
    -- Merge into the stored bag: an omitted key keeps its existing value.
    SELECT decrypted_secret::jsonb INTO v_existing
      FROM vault.decrypted_secrets WHERE id = v_id;
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, (COALESCE(v_existing, '{}'::jsonb) || p_secret)::text);
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
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'get_integration_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'delete_integration_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM vault.secrets WHERE name = 'integration:' || p_company_id || ':' || p_integration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_company_integration_patch(
  p_company_id text,
  p_integration_id text,
  p_metadata_patch jsonb DEFAULT '{}'::jsonb,
  p_secret_patch jsonb DEFAULT '{}'::jsonb,
  p_metadata_remove text[] DEFAULT ARRAY[]::text[],
  p_secret_remove text[] DEFAULT ARRAY[]::text[],
  p_active boolean DEFAULT NULL,
  p_updated_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $function$
DECLARE
  v_existing public."companyIntegration"%ROWTYPE;
  v_result public."companyIntegration"%ROWTYPE;
  v_exists boolean;
  v_metadata jsonb;
  v_secret jsonb := '{}'::jsonb;
  v_secret_ref text;
  v_secret_changed boolean;
  v_key text;
  v_path text[];
  v_value jsonb;
  v_index integer;
  v_vault_id uuid;
  v_vault_name text := 'integration:' || p_company_id || ':' || p_integration_id;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'upsert_company_integration_patch is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL OR p_company_id = '' THEN
    RAISE EXCEPTION 'company id is required';
  END IF;
  IF p_integration_id IS NULL OR p_integration_id = '' THEN
    RAISE EXCEPTION 'integration id is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_metadata_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'metadata patch must be a JSON object';
  END IF;
  IF jsonb_typeof(COALESCE(p_secret_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'secret patch must be a JSON object';
  END IF;

  p_metadata_patch := COALESCE(p_metadata_patch, '{}'::jsonb);
  p_secret_patch := COALESCE(p_secret_patch, '{}'::jsonb);
  p_metadata_remove := COALESCE(p_metadata_remove, ARRAY[]::text[]);
  p_secret_remove := COALESCE(p_secret_remove, ARRAY[]::text[]);

  -- Serialize both existing-row updates and concurrent first-time upserts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company_id || E'\x1f' || p_integration_id, 0)
  );

  SELECT ci.* INTO v_existing
  FROM public."companyIntegration" ci
  WHERE ci."companyId" = p_company_id
    AND ci.id = p_integration_id
  FOR UPDATE;
  v_exists := FOUND;

  v_metadata := CASE
    WHEN v_exists THEN COALESCE(v_existing.metadata::jsonb, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'stored integration metadata must be a JSON object';
  END IF;
  v_secret_ref := CASE WHEN v_exists THEN v_existing."secretRef" ELSE NULL END;

  FOREACH v_key IN ARRAY p_metadata_remove LOOP
    v_path := string_to_array(v_key, '.');
    IF v_key = '' OR array_position(v_path, '') IS NOT NULL THEN
      RAISE EXCEPTION 'invalid metadata remove path: %', v_key;
    END IF;
    v_metadata := v_metadata #- v_path;
  END LOOP;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_metadata_patch)
  LOOP
    v_path := string_to_array(v_key, '.');
    IF v_key = '' OR array_position(v_path, '') IS NOT NULL THEN
      RAISE EXCEPTION 'invalid metadata patch path: %', v_key;
    END IF;
    IF cardinality(v_path) > 1 THEN
      FOR v_index IN 1..cardinality(v_path) - 1 LOOP
        IF v_metadata #> v_path[1:v_index] IS NULL
          OR jsonb_typeof(v_metadata #> v_path[1:v_index]) <> 'object'
        THEN
          v_metadata := jsonb_set(
            v_metadata,
            v_path[1:v_index],
            '{}'::jsonb,
            true
          );
        END IF;
      END LOOP;
    END IF;
    v_metadata := jsonb_set(v_metadata, v_path, v_value, true);
  END LOOP;

  v_secret_changed := p_secret_patch <> '{}'::jsonb
    OR cardinality(p_secret_remove) > 0;
  IF v_secret_changed THEN
    IF v_secret_ref IS NOT NULL THEN
      SELECT ds.id, ds.decrypted_secret::jsonb INTO v_vault_id, v_secret
      FROM vault.decrypted_secrets ds
      WHERE ds.id = v_secret_ref::uuid;
      IF NOT FOUND OR jsonb_typeof(v_secret) <> 'object' THEN
        RAISE EXCEPTION 'stored integration secret is unavailable';
      END IF;
    ELSE
      -- Recover a deterministic Vault record whose row pointer was lost. Load
      -- its whole bag before patching so adopting it cannot erase siblings.
      SELECT ds.id, ds.decrypted_secret::jsonb INTO v_vault_id, v_secret
      FROM vault.decrypted_secrets ds
      WHERE ds.name = v_vault_name;
      IF FOUND THEN
        IF jsonb_typeof(v_secret) <> 'object' THEN
          RAISE EXCEPTION 'stored integration secret is unavailable';
        END IF;
        v_secret_ref := v_vault_id::text;
      ELSE
        -- SELECT INTO clears its targets when no row is found. Restore the
        -- empty bag before applying the first secret patch.
        v_secret := '{}'::jsonb;
      END IF;
    END IF;

    FOREACH v_key IN ARRAY p_secret_remove LOOP
      IF v_key = '' OR array_position(string_to_array(v_key, '.'), '') IS NOT NULL THEN
        RAISE EXCEPTION 'invalid secret remove path: %', v_key;
      END IF;
      -- Vault bags intentionally use literal flat dot-path keys; the TS reader
      -- expands each key back into nested metadata with setPath().
      v_secret := v_secret - v_key;
    END LOOP;

    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_secret_patch)
    LOOP
      IF v_key = '' OR array_position(string_to_array(v_key, '.'), '') IS NOT NULL THEN
        RAISE EXCEPTION 'invalid secret patch path: %', v_key;
      END IF;
      v_secret := v_secret || jsonb_build_object(v_key, v_value);
    END LOOP;

    IF v_secret = '{}'::jsonb THEN
      IF v_secret_ref IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE id = v_secret_ref::uuid;
      END IF;
      v_secret_ref := NULL;
    ELSIF v_secret_ref IS NULL THEN
      v_vault_id := vault.create_secret(
        v_secret::text,
        v_vault_name,
        'Carbon integration secret'
      );
      v_secret_ref := v_vault_id::text;
    ELSE
      PERFORM vault.update_secret(v_secret_ref::uuid, v_secret::text);
    END IF;
  END IF;

  IF v_exists THEN
    UPDATE public."companyIntegration"
    SET metadata = v_metadata::json,
        active = COALESCE(p_active, v_existing.active),
        "secretRef" = v_secret_ref,
        "updatedBy" = COALESCE(p_updated_by, v_existing."updatedBy"),
        "updatedAt" = now()
    WHERE id = p_integration_id
      AND "companyId" = p_company_id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public."companyIntegration" (
      id,
      "companyId",
      metadata,
      active,
      "secretRef",
      "updatedBy"
    ) VALUES (
      p_integration_id,
      p_company_id,
      v_metadata::json,
      COALESCE(p_active, false),
      v_secret_ref,
      p_updated_by
    )
    RETURNING * INTO v_result;
  END IF;

  RETURN to_jsonb(v_result);
END;
$function$;

-- The guards are in place, so give EXECUTE back: a refused call must reach the
-- RAISE rather than the privilege check that crashes the backend.
GRANT EXECUTE ON FUNCTION upsert_integration_secret(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_integration_secret(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_integration_secret(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_company_integration_patch(
  text, text, jsonb, jsonb, text[], text[], boolean, text
) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Job completion helpers (20260922050131 / 20260922183000): internal to
-- complete_job_to_inventory. SECURITY INVOKER, then EXECUTE back to the API
-- roles.
-- ---------------------------------------------------------------------------

ALTER FUNCTION terminal_job_operations(TEXT) SECURITY INVOKER;
ALTER FUNCTION complete_job_remaining_quantities(TEXT, NUMERIC, TEXT) SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION terminal_job_operations(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_job_remaining_quantities(TEXT, NUMERIC, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
