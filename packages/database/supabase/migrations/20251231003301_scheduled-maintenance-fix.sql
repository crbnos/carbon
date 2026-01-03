DROP FUNCTION get_maintenance_schedules_by_location;
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
