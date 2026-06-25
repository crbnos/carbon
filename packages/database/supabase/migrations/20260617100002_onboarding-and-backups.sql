-- Onboarding industry picker + the backup-template bucket.
--   1. The industry list + the industry / data-choice fields on the company shell.
--   2. The shared bucket holding the backup templates onboarding provisions from.

-- ─── 1. Industry catalog + onboarding fields on company ─────────────────────
-- Industries are data, not an enum, so the picker list can be curated
-- (added / renamed) without a migration. Companies FK to it by id; a NULL
-- industryId means "custom" (free-text in customIndustryDescription). The
-- onboarding demo template for an industry is a repo-committed backup file
-- (packages/database/supabase/backups/<industryId>.carbon.json.gz), published to
-- the company-templates bucket by a manual step (ci/src/upload-backup-templates.ts)
-- — it is not tracked on this table.

CREATE TABLE "industry" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "iconName"    TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
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
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "company_industryId_idx" ON "company"("industryId");

-- ─── 2. Backup-template bucket ──────────────────────────────────────────────
-- Shared, env-agnostic, private bucket holding the onboarding demo templates
-- (one repo-committed backup per industry, uploaded at deploy). A per-company
-- bucket can't serve these (onboarding runs outside the target company, and
-- tenants can't read each other's buckets). Access is service-role only: the
-- manual publish script writes here, the onboarding consume step reads here.
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-templates', 'company-templates', FALSE);
