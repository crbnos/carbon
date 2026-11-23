-- Named per-company connections to third-party integration pieces (Workflows).
-- Separate from "companyIntegration": that table is one row per integration per
-- company (composite PK), so it cannot hold several named accounts.
CREATE TABLE IF NOT EXISTS "integrationConnection" (
    "id" TEXT NOT NULL DEFAULT id('icn'),
    "companyId" TEXT NOT NULL,
    "pieceName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'OAUTH2',
    "accountLabel" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "refreshingAt" TIMESTAMP WITH TIME ZONE,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "lastError" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "integrationConnection_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "integrationConnection_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "integrationConnection_status_check"
      CHECK ("status" IN ('Active', 'Expired', 'Revoked')),
    CONSTRAINT "integrationConnection_name_unique" UNIQUE ("companyId", "pieceName", "name")
);

CREATE INDEX IF NOT EXISTS "integrationConnection_companyId_idx" ON "integrationConnection" ("companyId");
CREATE INDEX IF NOT EXISTS "integrationConnection_companyId_pieceName_idx"
  ON "integrationConnection" ("companyId", "pieceName");
CREATE INDEX IF NOT EXISTS "integrationConnection_createdBy_idx" ON "integrationConnection" ("createdBy");
CREATE INDEX IF NOT EXISTS "integrationConnection_updatedBy_idx" ON "integrationConnection" ("updatedBy");

ALTER TABLE "public"."integrationConnection" ENABLE ROW LEVEL SECURITY;

-- Policies: authz manifest (`integrationConnection`): settings_view reads, no API-role writes.

-- Vault RPCs. The existing upsert/get/delete_integration_secret functions are
-- hard-wired to "companyIntegration" and the 'integration:' name prefix, so these
-- mirror them against the new table with a 'connection:' prefix.
--
-- A connection's token is written only while the row is Active, so a token
-- refresh still running when someone disconnects the account (or uninstalls its
-- card) cannot write a fresh secret onto the Revoked row and bring it back.
--
-- The row is locked before the vault write, so a concurrent `revoke_connections`
-- either commits first (the row is no longer Active here, and the write is
-- refused with no_data_found) or waits and deletes the secret written here.
-- `save_connection` and the Slack backfill set the row Active before they call it.
CREATE OR REPLACE FUNCTION upsert_connection_secret(p_company_id text, p_connection_id text, p_secret jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'connection:' || p_company_id || ':' || p_connection_id;
  v_id uuid;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'upsert_connection_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM "integrationConnection"
    WHERE "companyId" = p_company_id AND "id" = p_connection_id
      AND "status" = 'Active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection % is not active.', p_connection_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration connection secret');
  ELSE
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, p_secret::text);
  END IF;
  UPDATE "integrationConnection" SET "secretRef" = v_id::text
    WHERE "companyId" = p_company_id AND "id" = p_connection_id;
  RETURN v_id::text;
END;
$$;

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

CREATE OR REPLACE FUNCTION delete_connection_secret(p_company_id text, p_connection_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'delete_connection_secret is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM vault.secrets
    WHERE name = 'connection:' || p_company_id || ':' || p_connection_id;
  UPDATE "integrationConnection" SET "secretRef" = NULL
    WHERE "companyId" = p_company_id AND "id" = p_connection_id;
END;
$$;

-- Service-role only, enforced by each body's first statement: REVOKE EXECUTE on a
-- public function segfaults this Postgres image when anon/authenticated call it
-- (see 20260924192316_api-function-guards-not-revokes.sql).

-- Revoke workflow integration connections in ONE statement: drop each one's vault
-- secret and mark its row Revoked together. Two separate writes could fail between
-- them and leave an Active row with no secret: an account every surface lists as
-- usable and every use fails.
--
-- With `p_connection_id`, that one connection of the piece (Disconnect). Without
-- it, every connection of the piece that is not already Revoked (Uninstall). The
-- row survives either way: a saved workflow node references its id. The secret is
-- deleted by its NAME, the way `upsert_connection_secret` stores it and
-- `get_connection_secret` reads it, never by `secretRef`.
CREATE OR REPLACE FUNCTION revoke_connections(
  p_company_id text,
  p_piece_name text,
  p_updated_by text,
  p_connection_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'revoke_connections is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH revoked AS (
    UPDATE "integrationConnection"
    SET "status" = 'Revoked',
        "secretRef" = NULL,
        "updatedBy" = p_updated_by,
        "updatedAt" = NOW()
    WHERE "companyId" = p_company_id
      AND "pieceName" = p_piece_name
      AND CASE
        WHEN p_connection_id IS NULL THEN "status" <> 'Revoked'
        ELSE "id" = p_connection_id
      END
    RETURNING "id"
  )
  DELETE FROM vault.secrets s
    USING revoked r
    WHERE s.name = 'connection:' || p_company_id || ':' || r."id";
END;
$$;

-- Save a workflow integration connection and its vault secret in ONE statement.
-- As two writes, a failed row update on Reconnect left a Revoked or Expired row
-- holding a live secret, and a failed vault write left an Active row with none.
--
-- With `p_connection_id`, the consent revives that row: the caller has already
-- checked that the same account signed in. Without it, a new row is inserted, and
-- the unique `(companyId, pieceName, name)` index refuses a taken name with 23505.
-- `p_metadata` NULL on a revive keeps the stored metadata.
CREATE OR REPLACE FUNCTION save_connection(
  p_company_id text,
  p_piece_name text,
  p_name text,
  p_auth_type text,
  p_secret jsonb,
  p_user_id text,
  p_account_label text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_connection_id text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_id text;
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'save_connection is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_connection_id IS NULL THEN
    INSERT INTO "integrationConnection" (
      "companyId", "pieceName", "name", "authType", "accountLabel",
      "metadata", "expiresAt", "status", "createdBy"
    )
    VALUES (
      p_company_id, p_piece_name, p_name, p_auth_type, p_account_label,
      COALESCE(p_metadata, '{}'::jsonb), p_expires_at, 'Active', p_user_id
    )
    RETURNING "id" INTO v_id;
  ELSE
    UPDATE "integrationConnection"
    SET "authType" = p_auth_type,
        -- No label (the account lookup failed) keeps the stored one: without it
        -- the same-account check passes for anyone on the next Reconnect.
        "accountLabel" = COALESCE(p_account_label, "accountLabel"),
        "metadata" = COALESCE(p_metadata, "metadata"),
        "expiresAt" = p_expires_at,
        "refreshingAt" = NULL,
        "status" = 'Active',
        "lastError" = NULL,
        "updatedBy" = p_user_id,
        "updatedAt" = NOW()
    WHERE "companyId" = p_company_id
      AND "pieceName" = p_piece_name
      AND "id" = p_connection_id
    RETURNING "id" INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Connection % was not found.', p_connection_id
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  -- Same name and secretRef as every other connection secret: the vault write and
  -- the row write above commit or roll back together.
  PERFORM upsert_connection_secret(p_company_id, v_id, p_secret);
  RETURN v_id;
END;
$$;

-- Cascade: vault.secrets does not cascade on its own.
CREATE OR REPLACE FUNCTION drop_connection_secret_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets
    WHERE name = 'connection:' || OLD."companyId" || ':' || OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_drop_connection_secret ON "integrationConnection";
CREATE TRIGGER trg_drop_connection_secret
  AFTER DELETE ON "integrationConnection"
  FOR EACH ROW EXECUTE FUNCTION drop_connection_secret_on_delete();

-- A piece is an ordinary integration card whose id IS the piece name, and
-- companyIntegration.id is an FK to integration.id — so the connect callback's
-- "installed" write (markIntegrationInstalled) needs one row per piece here.
-- Without it the callback fails AFTER the token is already in the vault.
INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('google-calendar', '{"type": "object", "properties": {}}'::json),
  ('gmail', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;

NOTIFY pgrst, 'reload schema';
