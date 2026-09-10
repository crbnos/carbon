-- Add the production-impact / offline flag to the PM plan, mirroring
-- maintenanceDispatch."takesWorkCenterOffline".
ALTER TABLE "maintenanceSchedule"
  ADD COLUMN IF NOT EXISTS "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "maintenanceSchedule"."takesWorkCenterOffline" IS
  'When true, PM dispatches generated from this schedule are created with takesWorkCenterOffline = true and a bounded plannedEndTime (plannedStartTime + estimatedDuration), so the finite scheduler subtracts that window from the work center''s capacity. Requires estimatedDuration to be set.';

-- Recreate the view so its expanded column list picks up the new column.
-- (A view's "ms.*" is frozen to an explicit column list at CREATE time, so the
-- prior definition never gained the schedule's own "locationId"/"procedureId"/
-- "takesWorkCenterOffline" columns added since 20260101163359.)
-- Forked from 20260101163359_maintenance-security-definer-views.sql, but the
-- "wc.locationId" alias is dropped: "maintenanceSchedule" now has its own
-- "locationId" column (surfaced by ms.*), which would otherwise be a duplicate.
-- "locationName" still resolves through the work center's location.
DROP VIEW IF EXISTS "maintenanceSchedules";
CREATE OR REPLACE VIEW "maintenanceSchedules"
WITH (security_invoker = true) AS
SELECT
  ms.*,
  wc."name" AS "workCenterName",
  l."name" AS "locationName"
FROM "maintenanceSchedule" ms
LEFT JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
LEFT JOIN "location" l ON wc."locationId" = l."id";

-- Recreate the by-location RPC, adding "takesWorkCenterOffline" to both the
-- RETURNS TABLE and the SELECT. Forked verbatim from
-- 20251231003301_scheduled-maintenance-fix.sql (only the new column added;
-- pre-existing omissions of skipHolidays/procedureId left as-is — out of scope).
DROP FUNCTION IF EXISTS get_maintenance_schedules_by_location(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_maintenance_schedules_by_location(
  p_company_id TEXT,
  p_location_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "name" TEXT,
  "description" TEXT,
  "workCenterId" TEXT,
  "frequency" "maintenanceFrequency",
  "priority" "maintenanceDispatchPriority",
  "estimatedDuration" INTEGER,
  "takesWorkCenterOffline" BOOLEAN,
  "active" BOOLEAN,
  "lastGeneratedAt" TIMESTAMP WITH TIME ZONE,
  "nextDueAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "monday" BOOLEAN,
  "tuesday" BOOLEAN,
  "wednesday" BOOLEAN,
  "thursday" BOOLEAN,
  "friday" BOOLEAN,
  "saturday" BOOLEAN,
  "sunday" BOOLEAN,
  "locationId" TEXT,
  "workCenterName" TEXT,
  "locationName" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ms."id",
    ms."name",
    ms."description",
    ms."workCenterId",
    ms."frequency",
    ms."priority",
    ms."estimatedDuration",
    ms."takesWorkCenterOffline",
    ms."active",
    ms."lastGeneratedAt",
    ms."nextDueAt",
    ms."companyId",
    ms."createdBy",
    ms."createdAt",
    ms."updatedBy",
    ms."updatedAt",
    ms."monday",
    ms."tuesday",
    ms."wednesday",
    ms."thursday",
    ms."friday",
    ms."saturday",
    ms."sunday",
    wc."locationId",
    wc."name" AS "workCenterName",
    l."name" AS "locationName"
  FROM "maintenanceSchedule" ms
  INNER JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
  INNER JOIN "location" l ON wc."locationId" = l."id"
  WHERE ms."companyId" = p_company_id
    AND wc."locationId" = p_location_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
