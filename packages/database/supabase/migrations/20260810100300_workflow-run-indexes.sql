-- Workflow run indexes: add the two the hot read paths actually need, drop the
-- two nothing reads. Both added indexes were verified absent and both dropped
-- indexes verified consumer-less against the branch, not inferred from history.
--
-- NOTE: plain CREATE INDEX takes a SHARE lock, blocking writes while the index
-- builds. That matches every other index migration in this repo. For a
-- zero-downtime apply, split these into CREATE INDEX CONCURRENTLY statements run
-- outside a transaction.

-- 1. The global run log ------------------------------------------------------
-- `/x/workflows/runs` filters on companyId alone and sorts createdAt DESC
-- (getWorkflowRuns in workflows.service.ts). The closest existing index,
-- workflowRun_companyId_workflowId_idx, orders by workflowId before createdAt,
-- so an unfiltered company-wide list still has to sort — a scan plus sort of the
-- company's entire 90-day run history on every page load.
CREATE INDEX IF NOT EXISTS "workflowRun_companyId_createdAt_idx"
  ON "workflowRun" ("companyId", "createdAt" DESC);

-- 2. The scheduler's in-flight check -----------------------------------------
-- hasActiveRun (packages/jobs/src/workflows/scheduler.ts) runs once per due
-- workflow per scheduler wake. Partial, because the non-terminal runs are a tiny
-- fraction of the table and this keeps the index small enough to stay hot.
CREATE INDEX IF NOT EXISTS "workflowRun_active_idx"
  ON "workflowRun" ("companyId", "workflowId")
  WHERE "status" IN ('Queued', 'Running');

-- 3. Dead indexes ------------------------------------------------------------
-- workflowRun_purge_idx ("status", "completedAt") was superseded by
-- workflowRun_retention_idx and never dropped: the retention job ages runs on
-- COALESCE("completedAt", "createdAt"), which this index cannot serve, and the
-- stale reaper is served by workflowRun_stale_idx.
DROP INDEX IF EXISTS "workflowRun_purge_idx";

-- workflowStepRun_companyId_idx ("companyId") has no consumer: every query on
-- that table filters runId (covered by workflowStepRun_runId_idx, which leads on
-- runId) or id (covered by the PK). Nothing filters companyId alone. Pure write
-- cost on the highest-insert table in the subsystem.
DROP INDEX IF EXISTS "workflowStepRun_companyId_idx";
