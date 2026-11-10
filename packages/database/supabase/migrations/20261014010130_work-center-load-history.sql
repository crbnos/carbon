-- Which operation was loaded on a work center, and when. The pointer
-- workCenter."loadedJobOperationId" holds only the current load, so a sensor
-- run reported after the load changed could not be given to the operation
-- loaded when it ran. The load and unload interceptors write this history;
-- the OEE sync reads it. Rows are deleted 7 days after they are unloaded.
--
-- "jobOperationId" has no foreign key, like the pointer: a table with keys to
-- both workCenter and jobOperation can make PostgREST embeds between the two
-- ambiguous (PGRST201).
CREATE TABLE IF NOT EXISTS "workCenterLoad" (
  "id" TEXT NOT NULL DEFAULT id('wcl'),
  "companyId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL,
  "jobOperationId" TEXT NOT NULL,
  "loadedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "unloadedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "workCenterLoad_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "workCenterLoad_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterLoad_workCenterId_fkey"
    FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "workCenterLoad_companyId_idx"
  ON "workCenterLoad" ("companyId");
CREATE INDEX IF NOT EXISTS "workCenterLoad_workCenter_loadedAt_idx"
  ON "workCenterLoad" ("workCenterId", "loadedAt");
CREATE INDEX IF NOT EXISTS "workCenterLoad_jobOperation_open_idx"
  ON "workCenterLoad" ("jobOperationId") WHERE "unloadedAt" IS NULL;

-- The loads in place now start the history.
INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt")
SELECT w."companyId", w."id", w."loadedJobOperationId", w."loadedAt"
FROM "workCenter" w
WHERE w."loadedJobOperationId" IS NOT NULL
  AND w."loadedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "workCenterLoad" l
    WHERE l."workCenterId" = w."id"
      AND l."companyId" = w."companyId"
      AND l."unloadedAt" IS NULL
  );

CREATE OR REPLACE FUNCTION util.purge_work_center_loads()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "workCenterLoad"
  WHERE "unloadedAt" < NOW() - INTERVAL '7 days';
$$;

REVOKE ALL ON FUNCTION util.purge_work_center_loads() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'work-center-load-retention'
  ) THEN
    PERFORM cron.unschedule('work-center-load-retention');
  END IF;
  PERFORM cron.schedule(
    'work-center-load-retention',
    '35 4 * * *',
    'SELECT util.purge_work_center_loads();'
  );
END;
$$;
