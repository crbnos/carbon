-- Add new foreign key columns to nonConformance table for custom types/actions
ALTER TABLE "nonConformance" 
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
  JOIN "nonConformanceInvestigationType" ict ON ict."name" = inv_type.name AND ict."companyId" = "nonConformance"."companyId"
)
WHERE "investigationTypes" IS NOT NULL AND ARRAY_LENGTH("investigationTypes", 1) > 0;

UPDATE "nonConformance" 
SET "requiredActionIds" = (
  SELECT ARRAY_AGG(rac."id")
  FROM UNNEST("requiredActions") AS req_action(name)
  JOIN "nonConformanceRequiredAction" rac ON rac."name" = req_action.name AND rac."companyId" = "nonConformance"."companyId"
)
WHERE "requiredActions" IS NOT NULL AND ARRAY_LENGTH("requiredActions", 1) > 0;

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
WHERE rac."name" = "nonConformanceActionTask"."actionType"::text 
  AND rac."companyId" = "nonConformanceActionTask"."companyId"
  AND "nonConformanceActionTask"."actionType" IS NOT NULL;