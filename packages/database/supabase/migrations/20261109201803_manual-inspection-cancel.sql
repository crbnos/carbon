-- A manual inspection can be cancelled: a terminal status that takes it off the
-- shop floor queue, with whatever it recorded kept as history. Cancelling (or
-- deleting an untouched one) gives each held entity back the status it had
-- before the inspection, so the lot remembers it.

ALTER TYPE "inspectionStatusType" ADD VALUE IF NOT EXISTS 'Cancelled';

ALTER TABLE "inspectionTrackedEntity"
  ADD COLUMN IF NOT EXISTS "previousStatus" "trackedEntityStatus";
