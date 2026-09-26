-- A First Article Inspection Report is a quality record that outlives the job
-- that produced it. RESTRICT on its job / job make method blocked deleting the
-- job and blocked Get Method from rebuilding a sub-assembly (which deletes and
-- re-inserts jobMakeMethod rows). The report keeps its own snapshot of the part
-- (partNumber, partName, revisions, manufacturingProcessReference), so losing
-- the link loses nothing the report prints.

ALTER TABLE "firstArticleInspection"
  ALTER COLUMN "jobId" DROP NOT NULL,
  ALTER COLUMN "jobMakeMethodId" DROP NOT NULL;

ALTER TABLE "firstArticleInspection"
  DROP CONSTRAINT IF EXISTS "firstArticleInspection_jobId_fkey",
  DROP CONSTRAINT IF EXISTS "firstArticleInspection_jobMakeMethodId_fkey";

ALTER TABLE "firstArticleInspection"
  ADD CONSTRAINT "firstArticleInspection_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "firstArticleInspection_jobMakeMethodId_fkey"
    FOREIGN KEY ("jobMakeMethodId") REFERENCES "jobMakeMethod"("id") ON DELETE SET NULL;

-- A feature cannot take its bonus tolerance from its own size.
ALTER TABLE "inspectionFeature"
  DROP CONSTRAINT IF EXISTS "inspectionFeature_sizeFeatureId_not_self";
ALTER TABLE "inspectionFeature"
  ADD CONSTRAINT "inspectionFeature_sizeFeatureId_not_self"
    CHECK ("sizeFeatureId" IS NULL OR "sizeFeatureId" <> "id");
