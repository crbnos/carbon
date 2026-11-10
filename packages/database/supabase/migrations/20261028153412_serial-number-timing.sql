-- Serial-number timing: when a produced unit's serial number is drawn from the
-- item's `itemSerialSequence`.
--
-- 'jobCreation' (default, current behavior) reserves N numbers the moment the job
-- is created (assignSerialNumbers). Numbers are burned on jobs that are later
-- cancelled or reduced, and they run in planning order rather than production
-- order.
--
-- 'jobRelease' reserves them when the job is released to the shop floor
-- (releaseCheckedJobs), so travelers can still be printed before work starts
-- while a Draft or Planned job that is resized or cancelled uses no numbers.
--
-- 'production' leaves the job's tracked entities unnumbered at creation and draws
-- a number the first time a unit is touched: its first production event, its
-- first operation completion, its scrap, or the ERP completion that receives it
-- (completeJob splits and numbers the units it takes before
-- complete_job_to_inventory runs). Each allocation site guards on
-- `readableId IS NULL`, so flipping this setting never renumbers work already in
-- flight, and a unit nothing was ever done to stays unnumbered.
--
-- The company setting is the default. An item's serial sequence can override it
-- (`itemSerialSequence."serialNumberTiming"`, NULL follows the company), since
-- one plant can mark a machined part at its first operation and label an
-- assembly at the end of the line.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "serialNumberTiming" TEXT NOT NULL DEFAULT 'jobCreation'
  CHECK ("serialNumberTiming" IN ('jobCreation', 'jobRelease', 'production'));

ALTER TABLE "itemSerialSequence"
  ADD COLUMN IF NOT EXISTS "serialNumberTiming" TEXT
  CHECK ("serialNumberTiming" IN ('jobCreation', 'jobRelease', 'production'));

-- The view expanded iss.* when it was created, so it is rebuilt to carry the
-- new column (a new column inside iss.* moves the joined ones, which CREATE OR
-- REPLACE refuses).
DROP VIEW IF EXISTS "itemSerialSequences";
CREATE VIEW "itemSerialSequences" WITH(SECURITY_INVOKER=true) AS
SELECT
  iss.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."itemTrackingType"
FROM "itemSerialSequence" iss
INNER JOIN "item" i ON i."id" = iss."itemId";
