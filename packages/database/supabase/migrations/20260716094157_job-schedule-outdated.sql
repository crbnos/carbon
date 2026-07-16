-- Reactive replanning: when a scheduling input changes (shift assignment,
-- qualification, work center, location timezone), affected jobs are stamped
-- as outdated so boards can show WHY the stored schedule may no longer match
-- reality, and the debounced replan wave knows its work list. Cleared by the
-- next successful reschedule of the job.
ALTER TABLE "job"
  ADD COLUMN "scheduleOutdatedReason" TEXT,
  ADD COLUMN "scheduleOutdatedAt" TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN "job"."scheduleOutdatedReason" IS
  'Why the stored schedule may be stale (e.g. "Qualification changed: Solder"). Null = schedule current.';
