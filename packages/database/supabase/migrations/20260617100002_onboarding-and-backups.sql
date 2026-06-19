-- Onboarding industry fields + the reusable-environment "backups" demo catalog.
--   1. Industry / demo-choice fields on the company shell.
--   2. A system-level catalog of published company backups that onboarding can
--      provision a new company from.

-- ─── 1. Onboarding fields on company ────────────────────────────────────────

CREATE TYPE "onboardingIndustry" AS ENUM (
  'robotics_oem',
  'precision_manufacturing',
  'automotive_precision',
  'custom'
);

ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_industryId_fkey";
ALTER TABLE "company" DROP COLUMN IF EXISTS "industryId";

ALTER TABLE "company"
  ADD COLUMN "industryId" "onboardingIndustry",
  ADD COLUMN IF NOT EXISTS "customIndustryDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedModules" TEXT[],
  ADD COLUMN IF NOT EXISTS "featureRequests" TEXT,
  ADD COLUMN IF NOT EXISTS "seedDemoData" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "company_industryId_idx" ON "company"("industryId");

-- ─── 2. Demo / backup catalog ───────────────────────────────────────────────
-- Not tenant-scoped — a published demo is available to every company during
-- onboarding. Writes happen only via the service-role `publish-demo` job
-- (internal-only); end users get read access to metadata.

CREATE TABLE "companyTemplate" (
  "id"                TEXT PRIMARY KEY DEFAULT xid(),
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "industryId"        "onboardingIndustry",
  "sourceCompanyId"   TEXT REFERENCES "company"("id") ON DELETE SET NULL,
  "sourceCompanyName" TEXT,
  "artifactPath"      TEXT NOT NULL,
  "schemaVersion"     TEXT NOT NULL,
  "includesStorage"   BOOLEAN NOT NULL DEFAULT FALSE,
  "rowCount"          INTEGER,
  "isPublic"          BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"         TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy"         TEXT REFERENCES "user"("id"),
  "updatedAt"         TIMESTAMP WITH TIME ZONE
);

-- One canonical demo per industry: onboarding picks a demo by industry, so an
-- industry maps to at most one published demo. Publishing again for the same
-- industry replaces it (see the publish-demo job's upsert). Partial so multiple
-- untagged (NULL industry) demos remain allowed. Also serves industry lookups.
CREATE UNIQUE INDEX "companyTemplate_industryId_key"
  ON "companyTemplate" ("industryId")
  WHERE "industryId" IS NOT NULL;

ALTER TABLE "companyTemplate" ENABLE ROW LEVEL SECURITY;

-- Reads: any authenticated user (catalog metadata only — names, industry,
-- schema version; no business data lives in this table).
CREATE POLICY "Authenticated users can view company templates"
  ON "companyTemplate" FOR SELECT
  USING (auth.role() = 'authenticated');

-- Writes are performed by the service role (the publish-demo job), which
-- bypasses RLS. No INSERT/UPDATE/DELETE policies are granted to end users.

-- Shared, env-agnostic, private bucket holding every published artifact. A
-- per-company bucket can't back a catalog (onboarding runs outside the target
-- company, and tenants can't read each other's buckets). Access is service-role
-- only: the publish job writes here, the consume step reads here.
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-templates', 'company-templates', FALSE);
