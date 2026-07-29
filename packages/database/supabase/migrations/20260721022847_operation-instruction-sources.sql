-- Operation Instruction Sources
-- Spec: .ai/specs/2026-07-21-operation-instruction-sources.md
--
-- Per-operation instruction-source pointers, keyed on operationType:
--   Process    -> procedureId            (existing, all three tables)
--   Assembly   -> assemblyInstructionId  (existing on methodOperation/jobOperation;
--                                         added to quoteOperation here)
--   Inspection -> inspectionDocumentId   (new on all three tables — the explicit
--                                         plan link accepted in the MES execution
--                                         views PRD §5.4; resolve-by-item only
--                                         scopes the picker, the FK is the truth)
--
-- All FKs are ON DELETE SET NULL (deleting a source never deletes operations),
-- matching the assemblyInstructionId precedent. Guarded so a deploy-runner retry
-- over partially-committed state is a no-op.

-- 1. Assembly pointer for quote operations
ALTER TABLE "quoteOperation" ADD COLUMN IF NOT EXISTS "assemblyInstructionId" TEXT;
DO $$ BEGIN
  ALTER TABLE "quoteOperation"
    ADD CONSTRAINT "quoteOperation_assemblyInstructionId_fkey"
    FOREIGN KEY ("assemblyInstructionId") REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "quoteOperation_assemblyInstructionId_idx"
  ON "quoteOperation"("assemblyInstructionId");

-- 2. Inspection plan link on all three operation tables
ALTER TABLE "methodOperation" ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;
DO $$ BEGIN
  ALTER TABLE "methodOperation"
    ADD CONSTRAINT "methodOperation_inspectionDocumentId_fkey"
    FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "methodOperation_inspectionDocumentId_idx"
  ON "methodOperation"("inspectionDocumentId");

ALTER TABLE "quoteOperation" ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;
DO $$ BEGIN
  ALTER TABLE "quoteOperation"
    ADD CONSTRAINT "quoteOperation_inspectionDocumentId_fkey"
    FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "quoteOperation_inspectionDocumentId_idx"
  ON "quoteOperation"("inspectionDocumentId");

ALTER TABLE "jobOperation" ADD COLUMN IF NOT EXISTS "inspectionDocumentId" TEXT;
DO $$ BEGIN
  ALTER TABLE "jobOperation"
    ADD CONSTRAINT "jobOperation_inspectionDocumentId_fkey"
    FOREIGN KEY ("inspectionDocumentId") REFERENCES "inspectionDocument"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "jobOperation_inspectionDocumentId_idx"
  ON "jobOperation"("inspectionDocumentId");
