-- Shop time under DCAA timekeeping (spec D38) writes a Draft timesheet entry
-- per production event. The entry names the job operation it was worked on,
-- so My Time and the MES timesheet show it, and the production event, so an
-- edit or a delete of the event updates its Draft entry. A correction pair
-- copies both, so the event's hours stay the sum of its linked entries.

ALTER TABLE "timesheetEntry" ADD COLUMN IF NOT EXISTS "jobOperationId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timesheetEntry_jobOperation_fkey'
  ) THEN
    ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_jobOperation_fkey"
      FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "timesheetEntry_jobOperationId_idx"
  ON "timesheetEntry" ("jobOperationId", "companyId");
COMMENT ON COLUMN "timesheetEntry"."jobOperationId" IS
  'The job operation whose shop time wrote this entry (DCAA timekeeping); NULL for time logged by hand.';

ALTER TABLE "timesheetEntry" ADD COLUMN IF NOT EXISTS "productionEventId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timesheetEntry_productionEvent_fkey'
  ) THEN
    ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_productionEvent_fkey"
      FOREIGN KEY ("productionEventId") REFERENCES "productionEvent"("id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "timesheetEntry_productionEventId_idx"
  ON "timesheetEntry" ("productionEventId", "companyId");
COMMENT ON COLUMN "timesheetEntry"."productionEventId" IS
  'The production event whose hours this entry holds (DCAA timekeeping). post-production-event keeps a Draft entry in step with the event; a correction copies the link.';
