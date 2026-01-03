-- Add locationId column to maintenanceDispatch table
ALTER TABLE "maintenanceDispatch"
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- Add foreign key constraint
ALTER TABLE "maintenanceDispatch"
  ADD CONSTRAINT "maintenanceDispatch_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for locationId
CREATE INDEX IF NOT EXISTS "maintenanceDispatch_locationId_idx" ON "maintenanceDispatch" ("locationId");

-- Backfill locationId from work center for existing records
UPDATE "maintenanceDispatch" md
SET "locationId" = wc."locationId"
FROM "workCenter" wc
WHERE md."workCenterId" = wc."id"
  AND md."locationId" IS NULL;

-- Backfill locationId with the first location for records that still have null locationId
UPDATE "maintenanceDispatch"
SET "locationId" = (
  SELECT "id" 
  FROM "location" 
  WHERE "companyId" = "maintenanceDispatch"."companyId" 
  ORDER BY "createdAt" ASC 
  LIMIT 1
)
WHERE "locationId" IS NULL
  AND EXISTS (
    SELECT 1 
    FROM "location" 
    WHERE "companyId" = "maintenanceDispatch"."companyId"
  );


-- Update the get_maintenance_dispatches_by_location function to use maintenanceDispatch.locationId
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
    md."locationId",
    wc."name" AS "workCenterName",
    l."name" AS "locationName"
  FROM "maintenanceDispatch" md
  LEFT JOIN "workCenter" wc ON md."workCenterId" = wc."id"
  LEFT JOIN "location" l ON md."locationId" = l."id"
  WHERE md."companyId" = p_company_id
    AND md."locationId" = p_location_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
