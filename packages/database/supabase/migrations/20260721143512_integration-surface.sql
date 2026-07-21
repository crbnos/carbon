-- Integration Surface (#1059): idempotency keys, webhook registrations,
-- journal source attribution, and event triggers for accounting webhook topics.
--
-- Additive only. See .ai/specs/2026-07-04-integration-surface.md.
-- NOTE: applied against a live DB via `pnpm db:migrate` (regenerates types).

-- ---------------------------------------------------------------------------
-- 1. Idempotency keys for the controlled JE import API.
--    Infrastructure rows, not user data: RLS enabled with NO policies, so only
--    the service role can read/write them.
-- ---------------------------------------------------------------------------
CREATE TABLE "apiIdempotencyKey" (
    "id" TEXT NOT NULL DEFAULT id('idem'),
    "companyId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL REFERENCES "apiKey"("id") ON DELETE CASCADE,
    "idempotencyKey" TEXT NOT NULL,
    -- sha256 of the canonicalized request body
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_flight'
        CHECK ("status" IN ('in_flight', 'completed')),
    "responseStatus" INTEGER,
    -- stored per-entry results, replayed verbatim on a matching retry
    "responseBody" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() + INTERVAL '30 days',

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "apiIdempotencyKey_unique"
        UNIQUE ("companyId", "apiKeyId", "idempotencyKey")
);

CREATE INDEX "apiIdempotencyKey_companyId_idx" ON "apiIdempotencyKey" ("companyId");
CREATE INDEX "apiIdempotencyKey_apiKeyId_idx" ON "apiIdempotencyKey" ("apiKeyId");
CREATE INDEX "apiIdempotencyKey_expiresAt_idx" ON "apiIdempotencyKey" ("expiresAt");

-- Service-role only: enable RLS but define no policies (denies all client access).
ALTER TABLE "public"."apiIdempotencyKey" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Webhook endpoint registrations. The per-topic fan-out lives in
--    eventSystemSubscription; this table holds the endpoint + signing secret.
--    Reads are gated on settings_view; the "secret" must never round-trip to a
--    browser, so client reads go through the "webhookRegistrations" view below.
-- ---------------------------------------------------------------------------
CREATE TABLE "webhookRegistration" (
    "id" TEXT NOT NULL DEFAULT id('wh'),
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    -- HMAC signing secret; returned once at creation, never re-exposed
    "secret" TEXT NOT NULL,
    "topics" TEXT[] NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP WITH TIME ZONE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "webhookRegistration_companyId_idx" ON "webhookRegistration" ("companyId");
CREATE INDEX "webhookRegistration_createdBy_idx" ON "webhookRegistration" ("createdBy");

ALTER TABLE "public"."webhookRegistration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."webhookRegistration"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."webhookRegistration"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."webhookRegistration"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."webhookRegistration"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

-- Secret-free projection for any client-side read.
CREATE VIEW "webhookRegistrations" WITH (SECURITY_INVOKER = true) AS
  SELECT
    "id",
    "companyId",
    "url",
    "description",
    "topics",
    "active",
    "failureCount",
    "lastFailureAt",
    "createdBy",
    "createdAt",
    "updatedBy",
    "updatedAt"
  FROM "webhookRegistration";

-- ---------------------------------------------------------------------------
-- 3. Journal source attribution for the controlled import path. Distinguishes
--    "landed via integration X" from "keyed by a user".
-- ---------------------------------------------------------------------------
ALTER TABLE "journal"
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceApiKeyId" TEXT;

CREATE INDEX IF NOT EXISTS "journal_externalId_idx"
  ON "journal" ("companyId", "externalId");

-- ---------------------------------------------------------------------------
-- 4. Event triggers for the accounting webhook topics. None of these tables
--    have async event triggers today; attach the async statement-level
--    triggers so INSERT/UPDATE/DELETE fan out through the event system.
-- ---------------------------------------------------------------------------
SELECT attach_event_trigger('journal');
SELECT attach_event_trigger('accountingPeriod');
SELECT attach_event_trigger('approvalRequest');
