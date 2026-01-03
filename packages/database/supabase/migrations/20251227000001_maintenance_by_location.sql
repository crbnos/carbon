-- RPC function to get maintenance dispatches by location
-- This joins maintenanceDispatch with workCenter to filter by locationId
CREATE OR REPLACE FUNCTION get_maintenance_dispatches_by_location(
  p_company_id TEXT,
  p_location_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "maintenanceDispatchId" TEXT,
  "content" JSON,
  "status" "maintenanceDispatchStatus",
  "priority" "maintenanceDispatchPriority",
  "source" "maintenanceSource",
  "severity" "maintenanceSeverity",
  "oeeImpact" "oeeImpact",
  "workCenterId" TEXT,
  "maintenanceScheduleId" TEXT,
  "suspectedFailureModeId" TEXT,
  "actualFailureModeId" TEXT,
  "plannedStartTime" TIMESTAMP WITH TIME ZONE,
  "plannedEndTime" TIMESTAMP WITH TIME ZONE,
  "actualStartTime" TIMESTAMP WITH TIME ZONE,
  "actualEndTime" TIMESTAMP WITH TIME ZONE,
  "duration" INTEGER,
  "nonConformanceId" TEXT,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "assignee" TEXT,
  "companyId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "locationId" TEXT,
  "workCenterName" TEXT,
  "locationName" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    md."id",
    md."maintenanceDispatchId",
    md."content",
    md."status",
    md."priority",
    md."source",
    md."severity",
    md."oeeImpact",
    md."workCenterId",
    md."maintenanceScheduleId",
    md."suspectedFailureModeId",
    md."actualFailureModeId",
    md."plannedStartTime",
    md."plannedEndTime",
    md."actualStartTime",
    md."actualEndTime",
    md."duration",
    md."nonConformanceId",
    md."completedAt",
    md."assignee",
    md."companyId",
    md."createdBy",
    md."createdAt",
    md."updatedBy",
    md."updatedAt",
    wc."locationId",
    wc."name" AS "workCenterName",
    l."name" AS "locationName"
  FROM "maintenanceDispatch" md
  INNER JOIN "workCenter" wc ON md."workCenterId" = wc."id"
  INNER JOIN "location" l ON wc."locationId" = l."id"
  WHERE md."companyId" = p_company_id
    AND wc."locationId" = p_location_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- RPC function to get maintenance schedules by location
-- This uses the maintenanceSchedules view which already joins with workCenter and location
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
  "daysOfWeek" INTEGER[],
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
    ms."daysOfWeek",
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
