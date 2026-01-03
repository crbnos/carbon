-- OEE Impact enum for maintenance dispatches
-- Determines how maintenance affects work center availability
DO $$ BEGIN
    CREATE TYPE "oeeImpact" AS ENUM (
      'Down',       -- Machine is completely down, blocks all work
      'Planned',    -- Planned maintenance, blocks all work
      'Impact',     -- Maintenance affects performance but doesn't block
      'No Impact'   -- Maintenance does not affect work center
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add OEE Impact column to maintenanceDispatch
ALTER TABLE "maintenanceDispatch"
  ADD COLUMN IF NOT EXISTS "oeeImpact" "oeeImpact" NOT NULL DEFAULT 'No Impact';

-- Create index for efficient blocking status queries
CREATE INDEX IF NOT EXISTS "maintenanceDispatch_oeeImpact_idx"
  ON "maintenanceDispatch" ("oeeImpact");

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

-- View for work centers with blocking status
DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
CREATE OR REPLACE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;
