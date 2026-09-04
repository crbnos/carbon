-- v5 reconciler unification (.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md):
-- operations enqueued by the unified reconcile path carry trigger 'reconcile'
-- (state-derived — never cooldown-gated, distinct from the event/webhook
-- machine triggers in Sync Activity). Widen the CHECK constraint.
ALTER TABLE "accountingSyncOperation"
  DROP CONSTRAINT IF EXISTS "accountingSyncOperation_trigger_check";
ALTER TABLE "accountingSyncOperation"
  ADD CONSTRAINT "accountingSyncOperation_trigger_check"
  CHECK ("trigger" IN ('event','webhook','backfill','manual','posting','retry','reconcile'));
