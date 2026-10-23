-- Issue sync: the outbound Linear and Jira push runs on its own event-system
-- handler type, ISSUE_SYNC (.ai/specs/2026-10-17-issue-tracker-sync.md).
-- The list below restates the newest CHECK (20260326120000) plus ISSUE_SYNC.

ALTER TABLE "eventSystemSubscription"
  DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";

ALTER TABLE "eventSystemSubscription"
  ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
  CHECK ("handlerType" IN (
    'WEBHOOK', 'WORKFLOW', 'SYNC', 'SEARCH', 'AUDIT', 'EMBEDDING', 'ISSUE_SYNC'
  ));
