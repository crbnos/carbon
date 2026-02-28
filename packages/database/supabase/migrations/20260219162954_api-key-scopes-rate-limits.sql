-- API Key Scopes, Key Hashing, Rate Limiting, and Expiration
-- Rate limiting uses an unlogged table with a Postgres function (check_api_key_rate_limit).
-- Scope enforcement is handled via RLS helper functions.

-- ============================================================================
-- Step 1: Add new columns to apiKey table
-- ============================================================================

ALTER TABLE "apiKey"
  ADD COLUMN "keyHash" TEXT,
  ADD COLUMN "keyPreview" TEXT,
  ADD COLUMN "scopes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "rateLimit" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "rateLimitWindow" TEXT NOT NULL DEFAULT '1h',
  ADD COLUMN "expiresAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "lastUsedAt" TIMESTAMP WITH TIME ZONE;

-- Backfill keyHash from existing plaintext keys
UPDATE "apiKey"
SET "keyHash" = encode(digest("key"::bytea, 'sha256'::text), 'hex');

-- Make keyHash NOT NULL and add unique index
ALTER TABLE "apiKey" ALTER COLUMN "keyHash" SET NOT NULL;
CREATE UNIQUE INDEX "apiKey_keyHash_key" ON "apiKey"("keyHash");

-- ============================================================================
-- Step 2: Update SQL functions to use keyHash BEFORE dropping the key column
-- ============================================================================

-- Update get_company_id_from_api_key() to use hash lookup
-- Note: lastUsedAt is updated at the application layer (middleware), not here,
-- because this function runs inside RLS policy evaluation (read-only transaction).
CREATE OR REPLACE FUNCTION get_company_id_from_api_key() RETURNS TEXT
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public, extensions
  AS $$
  DECLARE
    company_id TEXT;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT "companyId" INTO company_id
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    RETURN company_id;
  END;
$$;

-- Update has_valid_api_key_for_company() to use hash lookup
CREATE OR REPLACE FUNCTION has_valid_api_key_for_company(company TEXT) RETURNS "bool"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public, extensions
  AS $$
  DECLARE
    has_valid_key boolean;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN FALSE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "apiKey"
      WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
        AND "companyId" = company
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    ) INTO has_valid_key;

    RETURN has_valid_key;
  END;
$$;

-- ============================================================================
-- Step 3: Drop and recreate the RLS policy on "user" that directly references
-- "apiKey"."key", replacing it with get_company_id_from_api_key()
-- ============================================================================

DROP POLICY IF EXISTS "Requests with an API key can select users from their company" ON "user";

CREATE POLICY "Requests with an API key can select users from their company" ON "user"
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM "userToCompany"
    WHERE "userToCompany"."userId" = "user"."id"::text
    AND "userToCompany"."companyId" = get_company_id_from_api_key()
  )
);

-- ============================================================================
-- Step 4: Backfill keyPreview from plaintext key (last 5 chars)
-- ============================================================================

UPDATE "apiKey" SET "keyPreview" = RIGHT("key", 5);

-- ============================================================================
-- Step 5: Now safe to drop the plaintext key column
-- ============================================================================

ALTER TABLE "apiKey" DROP CONSTRAINT "apiKey_key_key";
ALTER TABLE "apiKey" DROP COLUMN "key";

-- ============================================================================
-- Step 6: Backfill existing API keys with full access scopes
-- ============================================================================

UPDATE "apiKey"
SET "scopes" = (
  SELECT jsonb_object_agg(perm, jsonb_build_array(ak."companyId"))
  FROM (
    SELECT unnest(ARRAY[
      'sales_view', 'sales_create', 'sales_update', 'sales_delete',
      'inventory_view', 'inventory_create', 'inventory_update', 'inventory_delete',
      'accounting_view', 'accounting_create', 'accounting_update', 'accounting_delete',
      'purchasing_view', 'purchasing_create', 'purchasing_update', 'purchasing_delete',
      'parts_view', 'parts_create', 'parts_update', 'parts_delete',
      'production_view', 'production_create', 'production_update', 'production_delete',
      'resources_view', 'resources_create', 'resources_update', 'resources_delete',
      'people_view', 'people_create', 'people_update', 'people_delete',
      'invoicing_view', 'invoicing_create', 'invoicing_update', 'invoicing_delete',
      'quality_view', 'quality_create', 'quality_update', 'quality_delete',
      'settings_view', 'settings_create', 'settings_update', 'settings_delete',
      'documents_view', 'documents_create', 'documents_update', 'documents_delete',
      'users_create', 'users_update', 'users_delete'
    ]) as perm
  ) perms
)
FROM "apiKey" ak
WHERE "apiKey"."id" = ak."id";

-- ============================================================================
-- Step 7: New function for scope checking
-- ============================================================================

-- Get API key scopes from the current request
CREATE OR REPLACE FUNCTION get_api_key_scopes() RETURNS JSONB
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public, extensions
  AS $$
  DECLARE
    scopes JSONB;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT "apiKey"."scopes" INTO scopes
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    RETURN scopes;
  END;
$$;
-- ============================================================================
-- Step 8: Unlogged table + function for rate limiting
-- Unlogged tables skip WAL for performance; data is ephemeral (lost on crash,
-- which is acceptable for rate limit counters).
-- ============================================================================

CREATE UNLOGGED TABLE "apiKeyRateLimit" (
  "apiKeyId" TEXT NOT NULL REFERENCES "apiKey"("id") ON DELETE CASCADE,
  "windowStart" TIMESTAMPTZ NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("apiKeyId", "windowStart")
);

CREATE OR REPLACE FUNCTION check_api_key_rate_limit(
  p_api_key_id TEXT,
  p_limit INTEGER,
  p_window TEXT  -- '1m', '1h', '1d'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_interval INTERVAL;
  v_count INTEGER;
BEGIN
  v_interval := CASE p_window
    WHEN '1m' THEN INTERVAL '1 minute'
    WHEN '1h' THEN INTERVAL '1 hour'
    WHEN '1d' THEN INTERVAL '1 day'
    ELSE INTERVAL '1 hour'
  END;

  v_window_start := date_trunc(
    CASE p_window
      WHEN '1m' THEN 'minute'
      WHEN '1h' THEN 'hour'
      WHEN '1d' THEN 'day'
      ELSE 'hour'
    END,
    NOW()
  );

  -- Atomic upsert: insert or increment counter in one statement
  INSERT INTO "apiKeyRateLimit" ("apiKeyId", "windowStart", "requestCount")
  VALUES (p_api_key_id, v_window_start, 1)
  ON CONFLICT ("apiKeyId", "windowStart")
  DO UPDATE SET "requestCount" = "apiKeyRateLimit"."requestCount" + 1
  RETURNING "requestCount" INTO v_count;

  -- Probabilistic cleanup: ~1% of requests clean up expired windows
  IF random() < 0.01 THEN
    DELETE FROM "apiKeyRateLimit"
    WHERE "apiKeyId" = p_api_key_id
      AND "windowStart" < v_window_start;
  END IF;

  RETURN jsonb_build_object(
    'success', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'remaining', GREATEST(p_limit - v_count, 0),
    'resetAt', EXTRACT(EPOCH FROM (v_window_start + v_interval))::BIGINT * 1000
  );
END;
$$;

-- ============================================================================
-- Step 9: Update RLS helper functions for scope checking
-- Rate limiting is NOT done in RLS (read-only transaction context).
-- It is called explicitly from application middleware and edge functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_companies_with_any_role() RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text;

  RETURN user_companies;
END;
$$;

CREATE OR REPLACE FUNCTION get_companies_with_employee_role() RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    RETURN ARRAY[api_key_company];
  END IF;

  SELECT array_agg("companyId"::text)
  INTO user_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  RETURN user_companies;
END;
$$;

CREATE OR REPLACE FUNCTION get_companies_with_employee_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
  api_key_scopes JSONB;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    -- Get scopes for this API key
    api_key_scopes := get_api_key_scopes();

    -- NULL or empty scopes = no access
    IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
      RETURN '{}';
    END IF;

    -- Check if the requested permission exists in scopes
    IF (api_key_scopes ? permission)
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    ELSE
      RETURN '{}';
    END IF;
  END IF;

  -- Normal user permission flow (unchanged)
  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
  INTO permission_companies
  FROM public."userPermission"
  WHERE id::text = auth.uid()::text;

  IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(employee_companies);
  ELSE
    permission_companies := '{}';
  END IF;

  IF permission_companies IS NOT NULL AND '0'::text = ANY(permission_companies) THEN
    SELECT array_agg(id::text)
    INTO permission_companies
    FROM company
    WHERE id::text = ANY(employee_companies);
  END IF;

  RETURN permission_companies;
END;
$$;