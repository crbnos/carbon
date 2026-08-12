-- Run history: per-node diagnostics, retention indexes, and a last-run view.

-- Diagnostics only. Node data lives in "output"; this is why a node did what it did.
ALTER TABLE "workflowStepRun" ADD COLUMN "detail" JSONB;

COMMENT ON COLUMN "workflowStepRun"."detail" IS
  'Diagnostics only (per-clause condition evaluation). Never node data - that is "output".';

-- The stale-run reaper needs the non-terminal runs, ordered by age.
CREATE INDEX "workflowRun_stale_idx" ON "workflowRun" ("createdAt")
  WHERE "status" IN ('Queued', 'Running');

-- Blocked and Skipped runs never set "completedAt", so every retention pass ages
-- terminal runs on COALESCE("completedAt", "createdAt") and needs it indexed.
CREATE INDEX "workflowRun_retention_idx"
  ON "workflowRun" (COALESCE("completedAt", "createdAt"))
  WHERE "status" IN ('Succeeded', 'Failed', 'Blocked', 'Skipped');

-- Latest run per workflow. PostgREST cannot express latest-per-group. Test runs are
-- excluded: a test is the author's own experiment, not the workflow's health.
CREATE VIEW "workflowLastRun" WITH (security_invoker = true) AS
SELECT DISTINCT ON ("companyId", "workflowId")
  "companyId",
  "workflowId",
  "id" AS "runId",
  "status",
  "statusReason",
  "createdAt",
  "startedAt",
  "completedAt",
  "durationMs"
FROM "workflowRun"
WHERE "isTest" = FALSE
ORDER BY "companyId", "workflowId", "createdAt" DESC;
