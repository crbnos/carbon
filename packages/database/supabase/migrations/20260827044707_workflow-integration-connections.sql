-- Named per-company connections to third-party integration pieces (Workflows).
-- Separate from "companyIntegration": that table is one row per integration per
-- company (composite PK), so it cannot hold several named accounts.
CREATE TABLE "integrationConnection" (
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

CREATE INDEX "integrationConnection_companyId_idx" ON "integrationConnection" ("companyId");
CREATE INDEX "integrationConnection_companyId_pieceName_idx"
  ON "integrationConnection" ("companyId", "pieceName");
CREATE INDEX "integrationConnection_createdBy_idx" ON "integrationConnection" ("createdBy");
CREATE INDEX "integrationConnection_updatedBy_idx" ON "integrationConnection" ("updatedBy");

ALTER TABLE "public"."integrationConnection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."integrationConnection"
FOR SELECT
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."integrationConnection"
FOR INSERT
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."integrationConnection"
FOR UPDATE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."integrationConnection"
FOR DELETE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_delete')
    )::text[]
  )
);

-- Vault RPCs. The existing upsert/get/delete_integration_secret functions are
-- hard-wired to "companyIntegration" and the 'integration:' name prefix, so these
-- mirror them against the new table with a 'connection:' prefix.
CREATE OR REPLACE FUNCTION upsert_connection_secret(p_company_id text, p_connection_id text, p_secret jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_name text := 'connection:' || p_company_id || ':' || p_connection_id;
  v_id uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION get_connection_secret(p_company_id text, p_connection_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_ref text;
  v_secret text;
BEGIN
  SELECT "secretRef" INTO v_ref FROM "integrationConnection"
    WHERE "companyId" = p_company_id AND "id" = p_connection_id;
  IF v_ref IS NULL THEN RETURN NULL; END IF;  -- caller fails closed
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_ref::uuid;
  IF v_secret IS NULL THEN RETURN NULL; END IF;
  RETURN v_secret::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION delete_connection_secret(p_company_id text, p_connection_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets
    WHERE name = 'connection:' || p_company_id || ':' || p_connection_id;
  UPDATE "integrationConnection" SET "secretRef" = NULL
    WHERE "companyId" = p_company_id AND "id" = p_connection_id;
END;
$$;

-- Service-role only. No user client (anon/authenticated) may decrypt a token.
REVOKE ALL ON FUNCTION upsert_connection_secret(text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_connection_secret(text,text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_connection_secret(text,text)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_connection_secret(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_connection_secret(text,text)          TO service_role;
GRANT EXECUTE ON FUNCTION delete_connection_secret(text,text)       TO service_role;

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

-- The piece is an ordinary integration card, and companyIntegration.id is an FK to
-- integration.id, so the connect callback's "installed" write needs this row.
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('google-calendar', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;

NOTIFY pgrst, 'reload schema';
