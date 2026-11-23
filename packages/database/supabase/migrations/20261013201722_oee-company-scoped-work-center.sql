-- machineStateChange and unattributedMachineTime carry the work center the
-- sync read from the device. Their FKs carry the company too, like
-- workCenterDevice's (20261013191915). Each REPLACES the single-column FK:
-- two FKs to workCenter would make PostgREST embeds ambiguous (PGRST201).
ALTER TABLE "machineStateChange"
  DROP CONSTRAINT IF EXISTS "machineStateChange_workCenterId_fkey";
ALTER TABLE "machineStateChange"
  ADD CONSTRAINT "machineStateChange_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

ALTER TABLE "unattributedMachineTime"
  DROP CONSTRAINT IF EXISTS "unattributedMachineTime_workCenterId_fkey";
ALTER TABLE "unattributedMachineTime"
  ADD CONSTRAINT "unattributedMachineTime_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter" ("id", "companyId") ON DELETE CASCADE;

-- Every FK has an index.
CREATE INDEX IF NOT EXISTS "workCenterDevice_updatedBy_idx"
  ON "workCenterDevice" ("updatedBy");
CREATE INDEX IF NOT EXISTS "unattributedMachineTime_updatedBy_idx"
  ON "unattributedMachineTime" ("updatedBy");

-- ("companyId", "startTime" DESC) from 20261013170425 covers it.
DROP INDEX IF EXISTS "unattributedMachineTime_companyId_idx";
