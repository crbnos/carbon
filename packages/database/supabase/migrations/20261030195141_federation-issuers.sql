-- Identity federation, Claude Console parity
-- (.ai/specs/2026-10-30-workload-identity-federation.md, Addendum 2026-10-31).
-- The issuer becomes its own record with its key source and token checks,
-- rules and issuers are archived instead of deleted, and every exchange
-- attempt is logged. RLS for the new tables lives in the authz manifest.

ALTER TYPE "federationProvider" ADD VALUE IF NOT EXISTS 'Kubernetes' BEFORE 'Custom OIDC';

DO $$
BEGIN
  CREATE TYPE "federationJwksSource" AS ENUM (
    'OIDC Discovery',
    'JWKS URL',
    'Inline JWKS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE "federationExchangeOutcome" AS ENUM ('Succeeded', 'Refused');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS "federationIssuer" (
  "id" TEXT NOT NULL DEFAULT id('fedi'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" "federationProvider" NOT NULL,
  -- The `iss` claim, compared exactly.
  "issuer" TEXT NOT NULL,
  "jwksSource" "federationJwksSource" NOT NULL DEFAULT 'OIDC Discovery',
  -- OIDC Discovery: read here instead of the issuer URL when set.
  "discoveryUrl" TEXT,
  -- JWKS URL: the key set itself.
  "jwksUrl" TEXT,
  -- Inline JWKS: the key set, pasted; never fetched.
  "jwks" JSONB,
  -- A PEM CA for the TLS of the discovery and key-set fetches.
  "caCertificate" TEXT,
  -- On: every token must carry a `jti`, usable once.
  "requireUniqueJti" BOOLEAN NOT NULL DEFAULT TRUE,
  -- The longest `exp - iat` a token may claim.
  "maxTokenLifetimeHours" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "federationIssuer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "federationIssuer_id_key" UNIQUE ("id"),
  CONSTRAINT "federationIssuer_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "federationIssuer_name_check"
    CHECK ("name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("name") <= 64),
  CONSTRAINT "federationIssuer_maxTokenLifetime_check"
    CHECK ("maxTokenLifetimeHours" BETWEEN 1 AND 24),
  CONSTRAINT "federationIssuer_jwksSource_check" CHECK (
    ("jwksSource" <> 'JWKS URL' OR "jwksUrl" IS NOT NULL)
    AND ("jwksSource" <> 'Inline JWKS' OR "jwks" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "federationIssuer_companyId_name_active_key"
  ON "federationIssuer" ("companyId", "name")
  WHERE "archivedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "federationIssuer_createdBy_idx"
  ON "federationIssuer" ("createdBy");
CREATE INDEX IF NOT EXISTS "federationIssuer_updatedBy_idx"
  ON "federationIssuer" ("updatedBy");

ALTER TABLE "federationIssuer" ENABLE ROW LEVEL SECURITY;

-- Rules reference an issuer, carry a description, and are archived.
ALTER TABLE "federationRule" ADD COLUMN IF NOT EXISTS "issuerId" TEXT;
ALTER TABLE "federationRule" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "federationRule"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE;

-- Names become slugs; a slug two rules share gets the rule id's tail.
WITH named AS (
  SELECT
    "id",
    coalesce(
      nullif(
        trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
        ''
      ),
      'rule'
    ) AS slug,
    "companyId"
  FROM "federationRule"
  WHERE "name" !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
),
counted AS (
  SELECT "id", slug, count(*) OVER (PARTITION BY "companyId", slug) AS n
  FROM named
)
UPDATE "federationRule" r
SET "name" = c.slug || CASE
  WHEN c.n > 1 THEN '-' || lower(substr(r."id", length(r."id") - 4))
  ELSE ''
END
FROM counted c
WHERE r."id" = c."id";

-- One issuer per existing rule, carrying the rule's issuer URL and provider.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'federationRule' AND column_name = 'issuer'
  ) THEN
    INSERT INTO "federationIssuer" (
      "id", "companyId", "name", "provider", "issuer", "createdBy"
    )
    SELECT
      'fedi_' || substr(r."id", 6),
      r."companyId",
      'issuer-' || lower(substr(r."id", length(r."id") - 7)),
      r."provider",
      r."issuer",
      r."createdBy"
    FROM "federationRule" r
    WHERE r."issuerId" IS NULL
    ON CONFLICT DO NOTHING;

    UPDATE "federationRule"
    SET "issuerId" = 'fedi_' || substr("id", 6)
    WHERE "issuerId" IS NULL;
  END IF;
END;
$$;

ALTER TABLE "federationRule" ALTER COLUMN "issuerId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'federationRule_issuerId_fkey'
  ) THEN
    ALTER TABLE "federationRule"
      ADD CONSTRAINT "federationRule_issuerId_fkey"
      FOREIGN KEY ("issuerId", "companyId")
      REFERENCES "federationIssuer"("id", "companyId")
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "federationRule_issuerId_idx"
  ON "federationRule" ("issuerId");

-- The issuer moved to its own table, and the attempt log replaces the
-- last-exchange columns. The shared-issuer CHECK named the issuer column; the
-- federation operations, the only writers, now apply it.
ALTER TABLE "federationRule" DROP CONSTRAINT IF EXISTS "federationRule_sharedIssuer_check";
ALTER TABLE "federationRule" DROP COLUMN IF EXISTS "issuer";
ALTER TABLE "federationRule" DROP COLUMN IF EXISTS "provider";
ALTER TABLE "federationRule" DROP COLUMN IF EXISTS "lastExchangeAt";
ALTER TABLE "federationRule" DROP COLUMN IF EXISTS "lastFailureAt";
ALTER TABLE "federationRule" DROP COLUMN IF EXISTS "lastFailureReason";

ALTER TABLE "federationRule" DROP CONSTRAINT IF EXISTS "federationRule_name_companyId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "federationRule_companyId_name_active_key"
  ON "federationRule" ("companyId", "name")
  WHERE "archivedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'federationRule_name_check'
  ) THEN
    ALTER TABLE "federationRule"
      ADD CONSTRAINT "federationRule_name_check"
      CHECK ("name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("name") <= 64);
  END IF;
END;
$$;

-- One row per exchange attempt for a known rule.
CREATE TABLE IF NOT EXISTS "federationExchange" (
  "id" TEXT NOT NULL DEFAULT id('fedx'),
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "issuerId" TEXT NOT NULL,
  "outcome" "federationExchangeOutcome" NOT NULL,
  "reason" TEXT,
  -- From a token whose signature verified; never attacker text.
  "subject" TEXT,
  "clientIp" TEXT,
  -- The minted key; no FK, the key is purged a day after it expires.
  "apiKeyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "federationExchange_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "federationExchange_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "federationExchange_ruleId_fkey" FOREIGN KEY ("ruleId", "companyId")
    REFERENCES "federationRule"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "federationExchange_issuerId_fkey" FOREIGN KEY ("issuerId", "companyId")
    REFERENCES "federationIssuer"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "federationExchange_companyId_createdAt_idx"
  ON "federationExchange" ("companyId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "federationExchange_ruleId_createdAt_idx"
  ON "federationExchange" ("ruleId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "federationExchange_issuerId_idx"
  ON "federationExchange" ("issuerId");

ALTER TABLE "federationExchange" ENABLE ROW LEVEL SECURITY;

-- 30 days of attempts, as the audit log keeps.
CREATE OR REPLACE FUNCTION util.purge_federation_exchanges()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "federationExchange"
  WHERE "createdAt" < NOW() - INTERVAL '30 days';
$$;

REVOKE ALL ON FUNCTION util.purge_federation_exchanges() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'federation-exchange-retention'
  ) THEN
    PERFORM cron.unschedule('federation-exchange-retention');
  END IF;
  PERFORM cron.schedule(
    'federation-exchange-retention',
    '43 4 * * *',
    'SELECT util.purge_federation_exchanges();'
  );
END;
$$;
