-- Author review status for assembly instruction steps:
--   Todo   = newly added manual step, no content yet
--   Review = planner-generated, not yet validated by an author
--   Done   = author-validated
CREATE TYPE "assemblyStepStatus" AS ENUM ('Todo', 'Review', 'Done');

ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN "status" "assemblyStepStatus" NOT NULL DEFAULT 'Todo';

-- Existing planner-generated steps start in Review; manual steps stay Todo
UPDATE "assemblyInstructionStep"
  SET "status" = 'Review'
  WHERE "planConfidence" IN ('high', 'low');
