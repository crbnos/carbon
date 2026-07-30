-- Model slides: a BOP step slide can be a 3D model (modelUpload) instead of a picture.
-- A slide is image XOR model — "imagePath" is relaxed to nullable and a CHECK enforces
-- that at least one of "imagePath" / "modelUploadId" is set. The FK cascades: a model
-- slide without its model is meaningless (image slides are unaffected — their
-- "modelUploadId" is NULL). STEP uploads are converted to GLB by the assembler service
-- via the existing assembly-convert pipeline; other viewer-supported formats render
-- directly from "modelUpload"."modelPath".
-- See .ai/specs/2026-07-14-mes-execution-views.md §4 (this consciously supersedes the
-- "no 3D model slides" non-goal) and .ai/plans/2026-07-19-step-model-slides.md.
-- IF EXISTS / IF NOT EXISTS guards mirror the mes-assembly-view migration so a re-run
-- on a shared dev volume is a no-op.

-- 1. Template slides
ALTER TABLE "methodOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE CASCADE;
ALTER TABLE "methodOperationStepSlide"
  ALTER COLUMN "imagePath" DROP NOT NULL;
ALTER TABLE "methodOperationStepSlide"
  DROP CONSTRAINT IF EXISTS "methodOperationStepSlide_content_check";
ALTER TABLE "methodOperationStepSlide"
  ADD CONSTRAINT "methodOperationStepSlide_content_check"
    CHECK ("imagePath" IS NOT NULL OR "modelUploadId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "methodOperationStepSlide_modelUploadId_idx"
  ON "methodOperationStepSlide" ("modelUploadId");

-- 2. Job slides
ALTER TABLE "jobOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE CASCADE;
ALTER TABLE "jobOperationStepSlide"
  ALTER COLUMN "imagePath" DROP NOT NULL;
ALTER TABLE "jobOperationStepSlide"
  DROP CONSTRAINT IF EXISTS "jobOperationStepSlide_content_check";
ALTER TABLE "jobOperationStepSlide"
  ADD CONSTRAINT "jobOperationStepSlide_content_check"
    CHECK ("imagePath" IS NOT NULL OR "modelUploadId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "jobOperationStepSlide_modelUploadId_idx"
  ON "jobOperationStepSlide" ("modelUploadId");

-- 3. Quote slides
ALTER TABLE "quoteOperationStepSlide"
  ADD COLUMN IF NOT EXISTS "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE CASCADE;
ALTER TABLE "quoteOperationStepSlide"
  ALTER COLUMN "imagePath" DROP NOT NULL;
ALTER TABLE "quoteOperationStepSlide"
  DROP CONSTRAINT IF EXISTS "quoteOperationStepSlide_content_check";
ALTER TABLE "quoteOperationStepSlide"
  ADD CONSTRAINT "quoteOperationStepSlide_content_check"
    CHECK ("imagePath" IS NOT NULL OR "modelUploadId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "quoteOperationStepSlide_modelUploadId_idx"
  ON "quoteOperationStepSlide" ("modelUploadId");
