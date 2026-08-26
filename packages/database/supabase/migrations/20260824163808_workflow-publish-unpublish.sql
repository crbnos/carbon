-- Publishing is now the only on-off switch: workflow."publishedVersionId" set means the
-- workflow runs that version, NULL means it is a draft and nothing fires. The old "active"
-- boolean was a second switch for the same idea, and it is what leaked the word "active"
-- into the UI beside the pointer column that means something else.

-- A workflow that was published but switched OFF is deliberately paused. Collapsing the two
-- flags would silently resume it, so unpublish it while "active" still records that intent.
UPDATE "workflow" SET "activeVersionId" = NULL WHERE "active" = FALSE;

-- ...and its dispatch rows with it, matching what syncWorkflowTriggers does on unpublish.
-- Must run BEFORE the column is dropped.
DELETE FROM "workflowTriggerEvent" te
 USING "workflow" w
 WHERE te."workflowId" = w."id"
   AND te."companyId" = w."companyId"
   AND w."active" = FALSE;

-- Postgres silently drops any index whose predicate names a dropped column, and
-- "workflow_due_idx" is partial on "active" = TRUE. Rebuild it below, or the scheduler
-- loses its due-workflow index with no error anywhere.
DROP INDEX IF EXISTS "workflow_due_idx";

ALTER TABLE "workflow" DROP COLUMN "active";
ALTER TABLE "workflow" RENAME COLUMN "activeVersionId" TO "publishedVersionId";

-- A column rename does not rename its constraint.
ALTER TABLE "workflow"
    RENAME CONSTRAINT "workflow_activeVersionId_fkey" TO "workflow_publishedVersionId_fkey";

-- Both predicate halves still matter: deleting the published version leaves "nextRunAt" set.
CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
    WHERE "nextRunAt" IS NOT NULL AND "publishedVersionId" IS NOT NULL;
