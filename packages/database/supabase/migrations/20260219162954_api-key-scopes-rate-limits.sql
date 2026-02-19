-- API Key Scopes, Rate Limiting, Key Hashing, and Expiration
-- This migration adds granular permission scopes, rate limiting, key hashing,
-- and expiration support to API keys.

-- ============================================================================
-- Step 1: Add new columns to apiKey table
-- ============================================================================

ALTER TABLE "apiKey"
  ADD COLUMN "keyHash" TEXT,
  ADD COLUMN "scopes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "rateLimit" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "rateLimitWindow" TEXT NOT NULL DEFAULT '1h',
  ADD COLUMN "expiresAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "lastUsedAt" TIMESTAMP WITH TIME ZONE;

-- Backfill keyHash from existing plaintext keys using pgcrypto (already enabled)
UPDATE "apiKey"
SET "keyHash" = encode(digest("key"::bytea, 'sha256'), 'hex');

-- Make keyHash NOT NULL and add unique index
ALTER TABLE "apiKey" ALTER COLUMN "keyHash" SET NOT NULL;
CREATE UNIQUE INDEX "apiKey_keyHash_key" ON "apiKey"("keyHash");

-- ============================================================================
-- Step 2: Update SQL functions to use keyHash BEFORE dropping the key column
-- ============================================================================

-- Update get_company_id_from_api_key() to use hash lookup
CREATE OR REPLACE FUNCTION get_company_id_from_api_key() RETURNS TEXT
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public
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
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    -- Update lastUsedAt
    IF company_id IS NOT NULL THEN
      UPDATE "apiKey"
      SET "lastUsedAt" = NOW()
      WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'), 'hex');
    END IF;

    RETURN company_id;
  END;
$$;

-- Update has_valid_api_key_for_company() to use hash lookup
CREATE OR REPLACE FUNCTION has_valid_api_key_for_company(company TEXT) RETURNS "bool"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public
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
      WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'), 'hex')
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
-- Step 4: Now safe to drop the plaintext key column
-- ============================================================================

ALTER TABLE "apiKey" DROP CONSTRAINT "apiKey_key_key";
ALTER TABLE "apiKey" DROP COLUMN "key";

-- ============================================================================
-- Step 5: Backfill existing API keys with full access scopes
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
      'users_create', 'users_update', 'users_delete',
      'maintenance_update', 'maintenance_delete'
    ]) as perm
  ) perms
)
FROM "apiKey" ak
WHERE "apiKey"."id" = ak."id";

-- ============================================================================
-- Step 6: Rate limit tracking table
-- ============================================================================

CREATE TABLE "apiKeyRateLimit" (
  "apiKeyId" TEXT NOT NULL,
  "windowStart" TIMESTAMP WITH TIME ZONE NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "lastRequestId" TEXT,
  CONSTRAINT "apiKeyRateLimit_pkey" PRIMARY KEY ("apiKeyId", "windowStart"),
  CONSTRAINT "apiKeyRateLimit_apiKeyId_fkey" FOREIGN KEY ("apiKeyId")
    REFERENCES "apiKey"("id") ON DELETE CASCADE
);

CREATE INDEX "apiKeyRateLimit_windowStart_idx" ON "apiKeyRateLimit" ("windowStart");

-- Cleanup old rate limit entries every hour (pg_cron already enabled)
SELECT cron.schedule(
  'cleanup-api-rate-limits',
  '0 * * * *',
  $$DELETE FROM "apiKeyRateLimit" WHERE "windowStart" < NOW() - INTERVAL '2 days'$$
);

-- ============================================================================
-- Step 7: New functions for scopes and rate limiting
-- ============================================================================

-- Get API key scopes from the current request
CREATE OR REPLACE FUNCTION get_api_key_scopes() RETURNS JSONB
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    scopes JSONB;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT "scopes" INTO scopes
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    RETURN COALESCE(scopes, '{}'::jsonb);
  END;
$$;

-- Check API key rate limit using request.id to avoid double-counting
-- when RLS functions are called multiple times per request.
CREATE OR REPLACE FUNCTION check_api_key_rate_limit() RETURNS BOOLEAN
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    api_key_id TEXT;
    api_key_rate_limit INTEGER;
    api_key_window TEXT;
    current_window_start TIMESTAMP WITH TIME ZONE;
    current_request_id TEXT;
    current_count INTEGER;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN TRUE;
    END IF;

    SELECT "id", "rateLimit", "rateLimitWindow"
    INTO api_key_id, api_key_rate_limit, api_key_window
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'), 'hex');

    IF api_key_id IS NULL THEN
      RETURN TRUE;
    END IF;

    current_request_id := current_setting('request.id', true);

    current_window_start := date_trunc(
      CASE api_key_window
        WHEN '1m' THEN 'minute'
        WHEN '1h' THEN 'hour'
        WHEN '1d' THEN 'day'
        ELSE 'hour'
      END,
      NOW()
    );

    INSERT INTO "apiKeyRateLimit" ("apiKeyId", "windowStart", "requestCount", "lastRequestId")
    VALUES (api_key_id, current_window_start, 1, current_request_id)
    ON CONFLICT ("apiKeyId", "windowStart") DO UPDATE
    SET
      "requestCount" = CASE
        WHEN "apiKeyRateLimit"."lastRequestId" = current_request_id THEN "apiKeyRateLimit"."requestCount"
        ELSE "apiKeyRateLimit"."requestCount" + 1
      END,
      "lastRequestId" = current_request_id
    RETURNING "requestCount" INTO current_count;

    IF current_count > api_key_rate_limit THEN
      RAISE EXCEPTION 'Rate limit exceeded for API key' USING ERRCODE = 'P0429';
    END IF;

    RETURN TRUE;
  END;
$$;

-- ============================================================================
-- Step 8: Update RLS helper functions for scope + rate limit checking
-- ============================================================================

CREATE OR REPLACE FUNCTION get_companies_with_any_role() RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  user_companies text[];
  api_key_company text;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    PERFORM check_api_key_rate_limit();
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
    PERFORM check_api_key_rate_limit();
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
    PERFORM check_api_key_rate_limit();

    api_key_scopes := get_api_key_scopes();

    -- Empty scopes = full access (backward compatibility)
    IF api_key_scopes = '{}'::jsonb OR api_key_scopes IS NULL THEN
      RETURN ARRAY[api_key_company];
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
