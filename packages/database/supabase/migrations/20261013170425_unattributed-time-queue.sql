-- Unattributed time is a review queue, not a record. A row leaves the queue
-- when a supervisor assigns it (it becomes a Machine productionEvent, which is
-- the record), when they dismiss it, or 30 days after the machine stopped. So
-- the row needs no status, and nothing points back at the event.

-- Rows already answered leave the queue now.
DELETE FROM "unattributedMachineTime" WHERE "status" <> 'Open';

DROP INDEX IF EXISTS "unattributedMachineTime_open_idx";
DROP INDEX IF EXISTS "unattributedMachineTime_productionEventId_idx";

ALTER TABLE "unattributedMachineTime"
  DROP CONSTRAINT IF EXISTS "unattributedMachineTime_dismiss_check",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "productionEventId",
  DROP COLUMN IF EXISTS "dismissReason",
  DROP COLUMN IF EXISTS "resolvedBy",
  DROP COLUMN IF EXISTS "resolvedAt";

DROP TYPE IF EXISTS "unattributedMachineTimeStatus";

-- The queue reads newest first per company; retention reads the stop time.
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_companyId_startTime_idx"
  ON "unattributedMachineTime" ("companyId", "startTime" DESC);
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_endTime_idx"
  ON "unattributedMachineTime" ("endTime")
  WHERE "endTime" IS NOT NULL;

-- Retention, daily. A row still running has no endTime and stays: the sync
-- owns it until the machine stops.
CREATE OR REPLACE FUNCTION util.purge_unattributed_machine_time()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "unattributedMachineTime"
  WHERE "endTime" < NOW() - INTERVAL '30 days';
$$;

REVOKE ALL ON FUNCTION util.purge_unattributed_machine_time() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'unattributed-machine-time-retention'
  ) THEN
    PERFORM cron.unschedule('unattributed-machine-time-retention');
  END IF;
  PERFORM cron.schedule(
    'unattributed-machine-time-retention',
    '23 4 * * *',
    'SELECT util.purge_unattributed_machine_time();'
  );
END;
$$;
