-- Cut lists build ON Job Operation Batching (issue #1010), not beside it.
-- Link a cut list to its backing jobOperationBatch and retire the
-- completion-driver columns on cutListLine that the batch now owns.
-- See .ai/plans/2026-08-11-cut-lists-on-operation-batching.md (Task 1).

-- 1. cutList → jobOperationBatch (nullable; a standalone cut list has no batch).
-- Composite FK because both tables key on ("id", "companyId").
ALTER TABLE "cutList" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "cutList" ADD CONSTRAINT "cutList_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "cutList_jobOperationBatchId_idx"
  ON "cutList" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 2. Retire the completion-driver columns. Operation membership and per-operation
-- completion now live on the batch (jobOperation.jobOperationBatchId +
-- batch-operations `complete`), so the cut list no longer carries them. jobId and
-- jobMaterialId stay — the cut list still needs them for the material cost split
-- and lot traceability.
ALTER TABLE "cutListLine" DROP CONSTRAINT IF EXISTS "cutListLine_jobOperationId_fkey";
DROP INDEX IF EXISTS "cutListLine_jobOperationId_idx";
ALTER TABLE "cutListLine" DROP COLUMN IF EXISTS "jobOperationId";

ALTER TABLE "cutListLine" DROP CONSTRAINT IF EXISTS "cutListLine_piecesPerParent_check";
ALTER TABLE "cutListLine" DROP COLUMN IF EXISTS "piecesPerParent";
