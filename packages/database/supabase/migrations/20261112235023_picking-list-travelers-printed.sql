-- Travelers print once per picking list. The pick that sets
-- "travelersPrintedAt" (a conditional UPDATE ... WHERE "travelersPrintedAt" IS
-- NULL) is the one that prints, so two picks at the same moment cannot both
-- print, and a list that goes from Draft straight to Completed still prints.
-- The manual Print travelers button does not read it, so a reprint still works.

ALTER TABLE "pickingList"
  ADD COLUMN IF NOT EXISTS "travelersPrintedAt" TIMESTAMP WITH TIME ZONE;

-- A list that has left Draft already had its travelers printed (or was picked
-- before travelers existed): do not print them again on its next pick.
--
-- The backfill is data, not a change anyone made: app.sync_in_progress keeps
-- dispatch_event_batch from queueing an UPDATE event per row (for the first
-- row's company only). The lock timeout makes the migration fail and run
-- again behind a long transaction, instead of queueing every picker behind it.
SET lock_timeout = '5s';
SET LOCAL "app.sync_in_progress" = 'true';

UPDATE "pickingList"
SET "travelersPrintedAt" = COALESCE("updatedAt", "createdAt")
WHERE "status" <> 'Draft'
  AND "travelersPrintedAt" IS NULL;

RESET lock_timeout;
