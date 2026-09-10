-- A placeholder reservation surfaces an operation the scheduler could NOT place
-- (no qualified operator for its ability, no feasible slot, horizon-exhausted) on
-- the Forecast so the job no longer silently "hangs" after its last placeable op.
-- It is display-only: excluded from the live-reservation snapshot (getLiveReservations)
-- so it never holds capacity against other jobs or the next regen.
ALTER TABLE "capacityReservation"
  ADD COLUMN IF NOT EXISTS "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "capacityReservation"."isPlaceholder" IS
  'true = a non-binding placeholder for an operation the scheduler could not place. Shown on the Forecast (flagged) but excluded from capacity so it never blocks other jobs.';
