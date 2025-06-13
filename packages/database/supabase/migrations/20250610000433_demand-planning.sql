ALTER TABLE "jobOperation" ADD COLUMN "startDate" DATE;
ALTER TABLE "jobOperation" ADD COLUMN "dueDate" DATE;

ALTER TABLE "itemReplenishment" ADD COLUMN "leadTime" INTEGER NOT NULL DEFAULT 7;
UPDATE "itemReplenishment" 
SET "leadTime" = "purchasingLeadTime"
WHERE "purchasingLeadTime" IS NOT NULL;

-- Drop purchasingLeadTime column
ALTER TABLE "itemReplenishment" DROP COLUMN "purchasingLeadTime";


-- Demand Planning Tables

-- Enum types
CREATE TYPE "demandPeriodType" AS ENUM ('Week', 'Day', 'Month');
CREATE TYPE "demandSourceType" AS ENUM ('Sales Order', 'Job Material');

-- Time periods table for flexible bucketing (weeks initially, days in future)
CREATE TABLE "demandPeriod" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "periodType" "demandPeriodType" NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "demandPeriod_pkey" PRIMARY KEY ("id")
);

-- Demand forecasts table for estimates
CREATE TABLE "demandForecast" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "demandPeriodId" TEXT NOT NULL,
  "forecastQuantity" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "forecastMethod" TEXT, -- 'manual', 'statistical', 'ml', etc.
  "confidence" NUMERIC(3,2), -- 0.00 to 1.00
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandForecast_pkey" PRIMARY KEY ("itemId", "locationId", "demandPeriodId"),
  CONSTRAINT "demandForecast_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_demandPeriodId_fkey" FOREIGN KEY ("demandPeriodId") REFERENCES "demandPeriod"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandForecast_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

-- Demand actuals table for historical data
CREATE TABLE "demandActual" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "demandPeriodId" TEXT NOT NULL,
  "actualQuantity" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "sourceType" "demandSourceType" NOT NULL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandActual_pkey" PRIMARY KEY ("itemId", "locationId", "demandPeriodId", "sourceType"),
  CONSTRAINT "demandActual_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_demandPeriodId_fkey" FOREIGN KEY ("demandPeriodId") REFERENCES "demandPeriod"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandActual_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

-- Indexes for performance
CREATE INDEX "demandPeriod_startDate_endDate_idx" ON "demandPeriod" ("periodType", "startDate", "endDate");

CREATE INDEX "demandPeriod_startDate_idx" ON "demandPeriod" ("periodType","startDate");
CREATE INDEX "demandPeriod_endDate_idx" ON "demandPeriod" ("periodType", "endDate");

CREATE INDEX "demandForecast_itemId_locationId_demandPeriodId_idx" ON "demandForecast" ("itemId", "locationId", "demandPeriodId");
CREATE INDEX "demandForecast_createdAt_idx" ON "demandForecast" ("createdAt");

CREATE INDEX "demandActual_itemId_locationId_demandPeriodId_idx" ON "demandActual" ("itemId", "locationId", "demandPeriodId");
CREATE INDEX "demandActual_createdAt_idx" ON "demandActual" ("createdAt");

-- Unique constraints to prevent duplicate forecasts/actuals for same item/location/period
CREATE UNIQUE INDEX "demandForecast_unique_item_location_period_idx" ON "demandForecast" ("itemId", COALESCE("locationId", ''), "demandPeriodId");

CREATE OR REPLACE VIEW "openSalesOrderLines" AS (
  SELECT 
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    sol."quantityToSend",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem", 
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE 
    sol."salesOrderLineType" != 'Service'
    AND sol."methodType" != 'Make'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);

CREATE OR REPLACE VIEW "openJobMaterialLines" AS (
  SELECT 
    jm."id",
    jm."jobId",
    jm."itemId",
    jm."quantityToIssue",
    jm."unitOfMeasureCode",
    jm."companyId",
    i1."replenishmentSystem", 
    i1."itemTrackingType",
    ir1."leadTime" + ir2."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate"
  FROM "jobMaterial" jm
  INNER JOIN "job" j ON jm."jobId" = j."id"
  INNER JOIN "item" i1 ON jm."itemId" = i1."id"
  INNER JOIN "itemReplenishment" ir1 ON i1."id" = ir1."itemId"
  INNER JOIN "item" i2 ON j."itemId" = i2."id"
  INNER JOIN "itemReplenishment" ir2 ON i2."id" = ir2."itemId"
  WHERE j."status" IN (
      'Draft',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make'
);


DROP FUNCTION IF EXISTS get_inventory_quantities;
CREATE OR REPLACE FUNCTION get_inventory_quantities(company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "readableId" TEXT,
    "readableIdWithRevision" TEXT,
    "name" TEXT,
    "active" BOOLEAN,
    "type" "itemType",
    "itemTrackingType" "itemTrackingType",
    "replenishmentSystem" "itemReplenishmentSystem",
    "materialSubstanceId" TEXT,
    "materialFormId" TEXT,
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHand" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC,
    "quantityOnProductionDemand" NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY
    
WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityOnPurchaseOrder" 
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder" 
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
    WHERE
      so."status" IN (
        'Confirmed',
        'To Ship and Invoice',
        'To Ship',
        'To Invoice',
        'In Progress'
      )
      AND so."companyId" = company_id
      AND sol."locationId" = location_id
    GROUP BY sol."itemId"
  ),
  open_job_requirements AS (
    SELECT 
    jm."itemId",
    SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Draft',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make'
    GROUP BY jm."itemId"
  ),
  open_jobs AS (
    SELECT 
      j."itemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Draft',
      'Ready',
      'In Progress',
      'Paused'
    )
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT "itemId", SUM("quantity") AS "quantityOnHand"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
  )
  
SELECT
  i."id",
  i."readableId",
  i."readableIdWithRevision",
  i."name",
  i."active",
  i."type",
  i."itemTrackingType",
  i."replenishmentSystem",
  m."materialSubstanceId",
  m."materialFormId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(jr."quantityOnProductionDemand", 0) AS "quantityOnProductionDemand"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."itemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."itemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."itemId"
  LEFT JOIN open_job_requirements jr ON i."id" = jr."itemId"
  LEFT JOIN material m ON i."readableId" = m."id"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
WHERE
  i."itemTrackingType" <> 'Non-Inventory' AND i."companyId" = company_id;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
