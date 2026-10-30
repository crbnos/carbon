-- Workload identity federation (.ai/specs/2026-10-30-workload-identity-federation.md).
-- A federation rule trusts the OIDC JWTs one issuer signs for one workload.
-- `/token` exchanges such a JWT for an ordinary apiKey row that expires in
-- minutes, so the carbon-key path (RLS helpers, rate limit, scopes) is unchanged.
-- RLS for the new table lives in the authz manifest, not here.

DO $$
BEGIN
  CREATE TYPE "federationProvider" AS ENUM (
    'GitHub Actions',
    'AWS',
    'Google Cloud',
    'Microsoft Entra ID',
    'Custom OIDC'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS "federationRule" (
  "id" TEXT NOT NULL DEFAULT id('fedr'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" "federationProvider" NOT NULL,
  "issuer" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  -- Exact, or a prefix when it ends in `*`. NULL when claims alone match.
  "subject" TEXT,
  -- Top-level claim name -> exact string value.
  "claimConditions" JSONB NOT NULL DEFAULT '{}',
  -- The minted key's scopes, the same shape as "apiKey"."scopes".
  "scopes" JSONB NOT NULL DEFAULT '{}',
  "tokenLifetimeMinutes" INTEGER NOT NULL DEFAULT 15,
  "lastExchangeAt" TIMESTAMP WITH TIME ZONE,
  "lastFailureAt" TIMESTAMP WITH TIME ZONE,
  "lastFailureReason" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "federationRule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "federationRule_id_key" UNIQUE ("id"),
  CONSTRAINT "federationRule_name_companyId_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "federationRule_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A rule must name a workload, never only an issuer: GitHub and Google sign
  -- tokens for every customer.
  CONSTRAINT "federationRule_condition_check"
    CHECK ("subject" IS NOT NULL OR "claimConditions" <> '{}'::jsonb),
  CONSTRAINT "federationRule_subject_check"
    CHECK ("subject" IS NULL OR ("subject" <> '' AND "subject" <> '*')),
  CONSTRAINT "federationRule_tokenLifetime_check"
    CHECK ("tokenLifetimeMinutes" BETWEEN 5 AND 60)
);

CREATE INDEX IF NOT EXISTS "federationRule_companyId_idx"
  ON "federationRule" ("companyId");
CREATE INDEX IF NOT EXISTS "federationRule_createdBy_idx"
  ON "federationRule" ("createdBy");

ALTER TABLE "federationRule" ENABLE ROW LEVEL SECURITY;

-- The rule that minted a key. Deleting the rule deletes its keys.
ALTER TABLE "apiKey" ADD COLUMN IF NOT EXISTS "federationRuleId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apiKey_federationRuleId_fkey'
  ) THEN
    ALTER TABLE "apiKey"
      ADD CONSTRAINT "apiKey_federationRuleId_fkey"
      FOREIGN KEY ("federationRuleId") REFERENCES "federationRule"("id")
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "apiKey_federationRuleId_expiresAt_idx"
  ON "apiKey" ("federationRuleId", "expiresAt")
  WHERE "federationRuleId" IS NOT NULL;

-- Minted keys live minutes; keep a day of them for the admin, then drop them.
CREATE OR REPLACE FUNCTION util.purge_expired_federated_api_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "apiKey"
  WHERE "federationRuleId" IS NOT NULL
    AND "expiresAt" < NOW() - INTERVAL '1 day';
$$;

REVOKE ALL ON FUNCTION util.purge_expired_federated_api_keys() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'federated-api-key-retention'
  ) THEN
    PERFORM cron.unschedule('federated-api-key-retention');
  END IF;
  PERFORM cron.schedule(
    'federated-api-key-retention',
    '41 4 * * *',
    'SELECT util.purge_expired_federated_api_keys();'
  );
END;
$$;
