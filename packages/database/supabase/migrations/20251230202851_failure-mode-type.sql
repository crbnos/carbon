DROP VIEW IF EXISTS "activeMaintenanceDispatchesByLocation";
DROP FUNCTION IF EXISTS get_maintenance_dispatches_by_location;

-- Add temporary text column to store current values
ALTER TABLE "maintenanceDispatch" ADD COLUMN "severity_temp" TEXT;

-- Copy existing values to temporary column
UPDATE "maintenanceDispatch" SET "severity_temp" = "severity"::TEXT;

-- Drop the severity column (this will also drop the enum if no other columns use it)
ALTER TABLE "maintenanceDispatch" DROP COLUMN "severity";

DROP TYPE IF EXISTS "maintenanceSeverity";

-- Recreate the enum with the new values
CREATE TYPE "maintenanceSeverity" AS ENUM (
  'Preventive',
  'Operator Performed',
  'Support Required',
  'OEM Required'
);

-- Add the severity column back with the new enum type
ALTER TABLE "maintenanceDispatch" ADD COLUMN "severity" "maintenanceSeverity";

-- Update the new column, mapping old values to new ones
UPDATE "maintenanceDispatch" SET "severity" = 
  CASE 
    WHEN "severity_temp" = 'Maintenance Required' THEN 'Support Required'
    ELSE "severity_temp"::"maintenanceSeverity"
  END;

-- Make the column NOT NULL if it was before
ALTER TABLE "maintenanceDispatch" ALTER COLUMN "severity" SET NOT NULL;

-- Drop the temporary column
ALTER TABLE "maintenanceDispatch" DROP COLUMN "severity_temp";


CREATE TYPE "maintenanceFailureModeType" AS ENUM (
  'Maintenance',
  'Quality',
  'Operations',
  'Other'
);

ALTER TABLE "maintenanceFailureMode" ADD COLUMN "type" "maintenanceFailureModeType" NOT NULL DEFAULT 'Maintenance';

-- Add notification group columns for maintenance dispatch failure mode types
ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "maintenanceDispatchNotificationGroup" text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "qualityDispatchNotificationGroup" text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "operationsDispatchNotificationGroup" text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "otherDispatchNotificationGroup" text[] DEFAULT '{}';

-- View for active maintenance dispatches by location (for MES dashboard)
DROP VIEW IF EXISTS "activeMaintenanceDispatchesByLocation";
CREATE OR REPLACE VIEW "activeMaintenanceDispatchesByLocation" WITH (security_invoker = true) AS
SELECT
  md.id,
  md."maintenanceDispatchId",
  md.content,
  md.status,
  md.priority,
  md.source,
  md.severity,
  md."oeeImpact",
  md."workCenterId",
  md."maintenanceScheduleId",
  md."suspectedFailureModeId",
  md."actualFailureModeId",
  md."plannedStartTime",
  md."plannedEndTime",
  md."actualStartTime",
  md."actualEndTime",
  md.duration,
  md."nonConformanceId",
  md."completedAt",
  md.assignee,
  md."companyId",
  md."createdBy",
  md."createdAt",
  md."updatedBy",
  md."updatedAt",
  wc."locationId",
  wc.name AS "workCenterName",
  l.name AS "locationName",
  assignee."fullName" AS "assigneeName",
  assignee."avatarUrl" AS "assigneeAvatarUrl",
  sfm.name AS "suspectedFailureModeName",
  afm.name AS "actualFailureModeName"
FROM "maintenanceDispatch" md
LEFT JOIN "workCenter" wc ON md."workCenterId" = wc.id
LEFT JOIN "location" l ON wc."locationId" = l.id
LEFT JOIN "user" assignee ON md.assignee = assignee.id
LEFT JOIN "maintenanceFailureMode" sfm ON md."suspectedFailureModeId" = sfm.id
LEFT JOIN "maintenanceFailureMode" afm ON md."actualFailureModeId" = afm.id
WHERE md.status IN ('Open', 'Assigned', 'In Progress');


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
