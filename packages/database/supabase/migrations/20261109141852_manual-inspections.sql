-- Manual inspections: an inspection of specific tracked entities, created by
-- hand, with an optional work center (where it is done) and assignee (who does
-- it). The shop floor lists open inspections by work center.

ALTER TABLE "inspection"
  ADD COLUMN IF NOT EXISTS "workCenterId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignee" TEXT REFERENCES "user"("id") ON DELETE SET NULL;

ALTER TABLE "inspection"
  ADD CONSTRAINT "inspection_workCenterId_fkey"
    FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId") ON DELETE SET NULL ("workCenterId");

CREATE INDEX IF NOT EXISTS "inspection_workCenterId_idx" ON "inspection" ("workCenterId");
CREATE INDEX IF NOT EXISTS "inspection_assignee_companyId_idx" ON "inspection" ("assignee", "companyId");

-- The tracked entities a manual inspection covers. Receipt lots find theirs
-- through the receipt line; a manual lot has no source document, so it lists
-- them here.
CREATE TABLE "inspectionTrackedEntity" (
  "id" TEXT NOT NULL DEFAULT id(),
  "inspectionId" TEXT NOT NULL REFERENCES "inspection"("id") ON DELETE CASCADE,
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId")
);

ALTER TABLE "inspectionTrackedEntity"
  ADD CONSTRAINT "inspectionTrackedEntity_inspectionId_trackedEntityId_key"
  UNIQUE ("inspectionId", "trackedEntityId");

CREATE INDEX "inspectionTrackedEntity_companyId_idx" ON "inspectionTrackedEntity" ("companyId");
CREATE INDEX "inspectionTrackedEntity_trackedEntityId_idx" ON "inspectionTrackedEntity" ("trackedEntityId");
CREATE INDEX "inspectionTrackedEntity_createdBy_idx" ON "inspectionTrackedEntity" ("createdBy");
CREATE INDEX "inspectionTrackedEntity_updatedBy_idx" ON "inspectionTrackedEntity" ("updatedBy");

ALTER TABLE "inspectionTrackedEntity" ENABLE ROW LEVEL SECURITY;
