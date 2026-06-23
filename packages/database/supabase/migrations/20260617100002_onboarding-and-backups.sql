-- Onboarding industry fields + the reusable-environment demo catalog.
--   1. The industry list (each industry carries its own demo backup) + the
--      industry / demo-choice fields on the company shell.
--   2. The shared bucket holding the demo artifacts.

-- ─── 1. Industry catalog + onboarding fields on company ─────────────────────
-- Industries are data, not an enum, so the demo-environment list can be curated
-- (added / renamed) without a migration. Companies FK to it by id; a NULL
-- industryId means "custom" (free-text in customIndustryDescription). Each
-- industry also carries its one demo backup (the columns below), so onboarding
-- provisions a new company straight from industry.artifactPath.

CREATE TABLE "industry" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "iconName"    TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  -- The demo backup onboarding provisions a new company from (all NULL until a
  -- demo is published for this industry). `sourceCompanyId` is the persistent
  -- company the refresh job re-exports after each migration; `artifactPath`
  -- points into the company-templates bucket; `schemaVersion` records the
  -- artifact's schema for the import compatibility guard.
  "sourceCompanyId"   TEXT REFERENCES "company"("id") ON DELETE SET NULL,
  "sourceCompanyName" TEXT,
  "artifactPath"      TEXT,
  "schemaVersion"     TEXT,
  "includesStorage"   BOOLEAN NOT NULL DEFAULT FALSE,
  "rowCount"          INTEGER,
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE
);

INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder")
VALUES
  ('robotics_oem', 'Robotics OEM',
   'Original Equipment Manufacturer building robots and automation systems',
   'bot', 1),
  ('precision_manufacturing', 'Precision Manufacturing',
   'Contract manufacturer — CNC machining and sheet-metal fabrication',
   'cog', 2),
  ('automotive_precision', 'Motor Assembly',
   'Manufacturer producing precision motor assemblies and components',
   'wrench', 3);

ALTER TABLE "industry" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view industries"
  ON "industry" FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_industryId_fkey";
ALTER TABLE "company" DROP COLUMN IF EXISTS "industryId";

ALTER TABLE "company"
  ADD COLUMN "industryId" TEXT REFERENCES "industry"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "customIndustryDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedModules" TEXT[],
  ADD COLUMN IF NOT EXISTS "featureRequests" TEXT,
  ADD COLUMN IF NOT EXISTS "seedDemoData" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "company_industryId_idx" ON "company"("industryId");

-- ─── 2. Demo artifact bucket ────────────────────────────────────────────────
-- The demo catalog lives on the `industry` table above (one demo per industry,
-- in its sourceCompanyId / artifactPath / schemaVersion columns). Those demo
-- columns are written only by the service role (the publish + refresh jobs);
-- the industry SELECT policy gives end users read access to the metadata.

-- Shared, env-agnostic, private bucket holding every published artifact. A
-- per-company bucket can't back a catalog (onboarding runs outside the target
-- company, and tenants can't read each other's buckets). Access is service-role
-- only: the service role writes here, the onboarding consume step reads here.
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-templates', 'company-templates', FALSE);
