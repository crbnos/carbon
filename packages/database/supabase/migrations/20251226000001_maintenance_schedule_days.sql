-- Add day-of-week columns to maintenanceSchedule for daily frequency
-- These columns control which days of the week maintenance should run
ALTER TABLE "maintenanceSchedule"
  ADD COLUMN IF NOT EXISTS "monday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "tuesday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "wednesday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "thursday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "friday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "saturday" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sunday" BOOLEAN NOT NULL DEFAULT true;

-- Add skipHolidays column to skip maintenance on company holidays
ALTER TABLE "maintenanceSchedule"
  ADD COLUMN IF NOT EXISTS "skipHolidays" BOOLEAN NOT NULL DEFAULT true;

-- Update the maintenanceSchedules view to include new columns
DROP VIEW IF EXISTS "maintenanceSchedules";

CREATE OR REPLACE VIEW "maintenanceSchedules" AS
SELECT
  ms.*,
  wc."locationId",
  wc."name" AS "workCenterName",
  l."name" AS "locationName"
FROM "maintenanceSchedule" ms
LEFT JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
LEFT JOIN "location" l ON wc."locationId" = l."id";
