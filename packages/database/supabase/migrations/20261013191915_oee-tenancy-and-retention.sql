-- A device maps to a work center of its OWN company. The single-column FK let
-- a caller-supplied work center id from another company through, and the
-- sync would then write Machine events and unattributed time against that
-- foreign work center. workCenter has UNIQUE (id, companyId), so the FK can
-- carry the company. It REPLACES the old one: two FKs to workCenter would
-- give PostgREST two relationships and make embeds ambiguous (PGRST201).
ALTER TABLE "workCenterDevice"
  DROP CONSTRAINT IF EXISTS "workCenterDevice_workCenterId_fkey";
ALTER TABLE "workCenterDevice"
  ADD CONSTRAINT "workCenterDevice_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

-- machineStateChange keeps every state change the sync reads. The engine
-- only reads rows after the device's appliedThrough, so old rows are dead
-- data, and a remap or unmap leaves the old device's rows with no device.
CREATE INDEX IF NOT EXISTS "machineStateChange_changedAt_idx"
  ON "machineStateChange" ("changedAt");

-- Retention, daily, next to the unattributed time purge. 30 days is far past
-- anything a sync re-reads (the cursor overlap is 10 minutes, a first sync
-- reaches 24 hours back).
CREATE OR REPLACE FUNCTION util.purge_machine_state_changes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "machineStateChange" m
  WHERE m."changedAt" < NOW() - INTERVAL '30 days'
     OR NOT EXISTS (
       SELECT 1 FROM "workCenterDevice" d
       WHERE d."id" = m."workCenterDeviceId"
         AND d."companyId" = m."companyId"
     );
$$;

REVOKE ALL ON FUNCTION util.purge_machine_state_changes() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'machine-state-change-retention'
  ) THEN
    PERFORM cron.unschedule('machine-state-change-retention');
  END IF;
  PERFORM cron.schedule(
    'machine-state-change-retention',
    '29 4 * * *',
    'SELECT util.purge_machine_state_changes();'
  );
END;
$$;
