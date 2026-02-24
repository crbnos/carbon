ALTER TABLE "maintenanceSchedule"
ADD COLUMN IF NOT EXISTS "locationId" TEXT;

UPDATE "maintenanceSchedule"
SET "locationId" = (
  SELECT "locationId" FROM "workCenter" WHERE "id" = "maintenanceSchedule"."workCenterId"
) WHERE "locationId" IS NULL AND "workCenterId" IS NOT NULL;

UPDATE "maintenanceDispatch"
SET "locationId" = (
  SELECT "locationId" FROM "workCenter" WHERE "id" = "maintenanceDispatch"."workCenterId"
) WHERE "locationId" IS NULL AND "workCenterId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'maintenanceSchedule_locationId_fkey'
    AND table_name = 'maintenanceSchedule'
  ) THEN
    ALTER TABLE "maintenanceSchedule"
    ADD CONSTRAINT "maintenanceSchedule_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "location"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "maintenanceSchedule_locationId_idx" ON "maintenanceSchedule" ("locationId");

ALTER TABLE "maintenanceSchedule"
ADD COLUMN IF NOT EXISTS "procedureId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'maintenanceSchedule_procedureId_fkey'
    AND table_name = 'maintenanceSchedule'
  ) THEN
    ALTER TABLE "maintenanceSchedule"
    ADD CONSTRAINT "maintenanceSchedule_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "procedure"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "maintenanceSchedule_procedureId_idx" ON "maintenanceSchedule" ("procedureId");

ALTER TABLE "maintenanceDispatch"
ADD COLUMN IF NOT EXISTS "procedureId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'maintenanceDispatch_procedureId_fkey'
    AND table_name = 'maintenanceDispatch'
  ) THEN
    ALTER TABLE "maintenanceDispatch"
    ADD CONSTRAINT "maintenanceDispatch_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "procedure"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "maintenanceDispatch_procedureId_idx" ON "maintenanceDispatch" ("procedureId");
