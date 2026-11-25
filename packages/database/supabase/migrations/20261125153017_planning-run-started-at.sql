-- When the last saved planning run started reading its inputs. MRP and the
-- finite scheduler rebuild their output from scratch, and two runs can
-- overlap. Under the run's advisory lock, a run that started before the one
-- recorded here read older data and skips its save, so the newest read wins.
-- Both values are written on every saved run, so they live where no trigger
-- fires: companySettings has none, and a schedule run's start gets its own
-- table rather than a column on "location", whose events and realtime
-- broadcast would fire on every run.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "lastMrpRunStartedAt" TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN "companySettings"."lastMrpRunStartedAt" IS
  'Start of the last MRP run that saved (database clock). An MRP run that started earlier skips its save.';

CREATE TABLE IF NOT EXISTS "locationScheduleRun" (
  "locationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "lastRunStartedAt" TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT "locationScheduleRun_pkey" PRIMARY KEY ("locationId", "companyId"),
  CONSTRAINT "locationScheduleRun_locationId_fkey" FOREIGN KEY ("locationId")
    REFERENCES "location"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "locationScheduleRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "locationScheduleRun_companyId_idx"
  ON "locationScheduleRun" ("companyId");

COMMENT ON TABLE "locationScheduleRun" IS
  'Start of the last schedule run that saved each location (database clock). A run that started earlier skips its save. Written by the scheduler only.';
