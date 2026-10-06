-- Serial-number timing: when a produced unit's serial number is drawn from the
-- item's `itemSerialSequence`.
--
-- 'jobCreation' (default, current behavior) reserves N numbers the moment the job
-- is created, via the assign-serial-numbers server function. Numbers are burned on
-- jobs that are later cancelled or reduced, and they run in planning order rather
-- than production order.
--
-- 'production' leaves the job's tracked entities unnumbered at creation and draws
-- a number the first time a unit is actually touched — its first production event,
-- its first operation completion, or its scrap, whichever comes first. Each
-- allocation site guards on `readableId IS NULL`, so flipping this setting never
-- renumbers work already in flight, and a unit nothing was ever done to stays
-- unnumbered.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "serialNumberTiming" TEXT NOT NULL DEFAULT 'jobCreation'
  CHECK ("serialNumberTiming" IN ('jobCreation', 'production'));
