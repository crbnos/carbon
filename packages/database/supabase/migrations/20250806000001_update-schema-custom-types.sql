-- Add new foreign key columns to nonConformance table for custom types/actions
ALTER TABLE "nonConformance" 
ADD COLUMN "investigationTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requiredActionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "nonConformanceWorkflow" 
ADD COLUMN "investigationTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "requiredActionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add new foreign key columns to task tables
ALTER TABLE "nonConformanceInvestigationTask" 
ADD COLUMN "investigationTypeId" TEXT;

ALTER TABLE "nonConformanceActionTask" 
ADD COLUMN "actionTypeId" TEXT;

-- Add foreign key constraints
ALTER TABLE "nonConformanceInvestigationTask"
ADD CONSTRAINT "nonConformanceInvestigationTask_investigationTypeId_fkey" 
FOREIGN KEY ("investigationTypeId") REFERENCES "nonConformanceInvestigationType"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "nonConformanceActionTask"
ADD CONSTRAINT "nonConformanceActionTask_actionTypeId_fkey" 
FOREIGN KEY ("actionTypeId") REFERENCES "nonConformanceRequiredAction"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Create indexes for the new foreign key columns
CREATE INDEX "nonConformanceInvestigationTask_investigationTypeId_idx" ON "nonConformanceInvestigationTask" ("investigationTypeId");
CREATE INDEX "nonConformanceActionTask_actionTypeId_idx" ON "nonConformanceActionTask" ("actionTypeId");

-- Migrate existing data from ENUM arrays to foreign key arrays in nonConformance table
UPDATE "nonConformance" 
SET "investigationTypeIds" = (
  SELECT ARRAY_AGG(ict."id")
  FROM UNNEST("investigationTypes") AS inv_type(name)
  JOIN "nonConformanceInvestigationType" ict ON ict."name" = inv_type.name::text AND ict."companyId" = "nonConformance"."companyId"
)
WHERE "investigationTypes" IS NOT NULL AND ARRAY_LENGTH("investigationTypes", 1) > 0;

UPDATE "nonConformance" 
SET "requiredActionIds" = (
  SELECT ARRAY_AGG(rac."id")
  FROM UNNEST("requiredActionTypes") AS req_action(name)
  JOIN "nonConformanceRequiredAction" rac ON rac."name" = req_action.name::text AND rac."companyId" = "nonConformance"."companyId"
)
WHERE "requiredActionTypes" IS NOT NULL AND ARRAY_LENGTH("requiredActionTypes", 1) > 0;

-- Migrate existing data from ENUM to foreign key in investigation task table
UPDATE "nonConformanceInvestigationTask" 
SET "investigationTypeId" = ict."id"
FROM "nonConformanceInvestigationType" ict
WHERE ict."name" = "nonConformanceInvestigationTask"."investigationType"::text 
  AND ict."companyId" = "nonConformanceInvestigationTask"."companyId"
  AND "nonConformanceInvestigationTask"."investigationType" IS NOT NULL;

-- Migrate existing data from ENUM to foreign key in action task table  
UPDATE "nonConformanceActionTask" 
SET "actionTypeId" = rac."id"
FROM "nonConformanceRequiredAction" rac
WHERE rac."name" = "nonConformanceActionTask"."requiredActionType"::text 
  AND rac."companyId" = "nonConformanceActionTask"."companyId"
  AND "nonConformanceActionTask"."requiredActionType" IS NOT NULL;

-- Migrate existing workflow data from ENUM arrays to foreign key arrays
UPDATE "nonConformanceWorkflow" 
SET "investigationTypeIds" = (
  SELECT ARRAY_AGG(ict."id")
  FROM UNNEST("investigationTypes") AS inv_type(name)
  JOIN "nonConformanceInvestigationType" ict ON ict."name" = inv_type.name::text AND ict."companyId" = "nonConformanceWorkflow"."companyId"
)
WHERE "investigationTypes" IS NOT NULL AND ARRAY_LENGTH("investigationTypes", 1) > 0;

UPDATE "nonConformanceWorkflow" 
SET "requiredActionIds" = (
  SELECT ARRAY_AGG(rac."id")
  FROM UNNEST("requiredActions") AS req_action(name)
  JOIN "nonConformanceRequiredAction" rac ON rac."name" = req_action.name::text AND rac."companyId" = "nonConformanceWorkflow"."companyId"
)
WHERE "requiredActions" IS NOT NULL AND ARRAY_LENGTH("requiredActions", 1) > 0;

DROP VIEW IF EXISTS "qualityActions";

ALTER TABLE "nonConformanceInvestigationTask" DROP COLUMN "investigationType";
ALTER TABLE "nonConformanceActionTask" DROP COLUMN "requiredActionType";

ALTER TABLE "nonConformance" DROP COLUMN "investigationTypes";
ALTER TABLE "nonConformance" DROP COLUMN "requiredActionTypes";
ALTER TABLE "nonConformanceWorkflow" DROP COLUMN "investigationTypes";
ALTER TABLE "nonConformanceWorkflow" DROP COLUMN "requiredActions";

DROP VIEW IF EXISTS "qualityActions";
CREATE OR REPLACE VIEW "qualityActions" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "nonConformanceActionTask".*,
    "nonConformanceRequiredAction"."name" AS "actionType",
    "nonConformance"."nonConformanceId" AS "readableNonConformanceId",
    "nonConformance"."name" AS "nonConformanceName",
    "nonConformance"."status" AS "nonConformanceStatus",
    "nonConformance"."openDate" AS "nonConformanceOpenDate",
    "nonConformance"."dueDate" AS "nonConformanceDueDate",
    "nonConformance"."closeDate" AS "nonConformanceCloseDate",
    "nonConformance"."itemId" AS "nonConformanceItemId",
    "nonConformanceType"."name" AS "nonConformanceTypeName"
  FROM "nonConformanceActionTask"
  INNER JOIN "nonConformance" ON "nonConformanceActionTask"."nonConformanceId" = "nonConformance"."id"
  LEFT JOIN "nonConformanceRequiredAction" ON "nonConformanceRequiredAction"."id" = "nonConformanceActionTask"."actionTypeId"
  LEFT JOIN "nonConformanceType" ON "nonConformance"."nonConformanceTypeId" = "nonConformanceType"."id";