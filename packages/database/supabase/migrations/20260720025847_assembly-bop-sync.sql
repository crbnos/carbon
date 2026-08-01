-- Assembly → BOP sync: provenance marker linking a BOP step to the
-- assemblyInstructionStep it was synced from. Re-sync uses it to update/delete only
-- the steps it created, leaving hand-authored steps (NULL marker) untouched. ON DELETE
-- SET NULL: deleting the instruction (or a step of it) demotes synced BOP steps to
-- hand-authored rather than deleting the operator's work instructions.
-- See .ai/plans/2026-07-19-step-model-slides.md (Status → follow-up) and
-- .ai/specs/2026-07-14-mes-execution-views.md §4.

ALTER TABLE "methodOperationStep"
  ADD COLUMN IF NOT EXISTS "assemblyInstructionStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "methodOperationStep_assemblyInstructionStepId_idx"
  ON "methodOperationStep" ("assemblyInstructionStepId");

ALTER TABLE "jobOperationStep"
  ADD COLUMN IF NOT EXISTS "assemblyInstructionStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "jobOperationStep_assemblyInstructionStepId_idx"
  ON "jobOperationStep" ("assemblyInstructionStepId");
