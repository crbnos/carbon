-- Projects Phase 1b: capital projects (the Capitalize treatment).
-- A project names the fixed asset class of its CIP assets; each final-asset element
-- holds one CIP asset, created on release. fixedAssetCipCost gains the project cost
-- sources and the project and element a cost row belongs to.
-- Spec: .ai/specs/2026-10-03-projects.md (Capital projects)

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id"),
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");

ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isFinalAsset" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");

ALTER TABLE "fixedAssetCipCost" DROP CONSTRAINT IF EXISTS "fixedAssetCipCost_sourceType_check";
ALTER TABLE "fixedAssetCipCost"
  ADD CONSTRAINT "fixedAssetCipCost_sourceType_check" CHECK ("sourceType" IN
    ('Purchase Invoice', 'Receipt', 'Job', 'Manual', 'Timesheet', 'Project Issue', 'Charge', 'Reimbursement')),
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "postCapitalization" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "fixedAssetCipCost"
  ADD CONSTRAINT "fixedAssetCipCost_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "fixedAssetCipCost_projectElement_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE SET NULL ("projectElementId");

CREATE INDEX IF NOT EXISTS "project_fixedAssetClassId_idx" ON "project" ("fixedAssetClassId");
CREATE INDEX IF NOT EXISTS "project_fixedAssetId_idx" ON "project" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "projectElement_fixedAssetId_idx" ON "projectElement" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_projectId_idx" ON "fixedAssetCipCost" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_projectElementId_idx" ON "fixedAssetCipCost" ("projectElementId", "companyId");
