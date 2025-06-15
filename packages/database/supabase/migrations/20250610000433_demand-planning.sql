ALTER TABLE "purchaseOrderLine" ADD COLUMN "promisedDate" DATE;

ALTER TABLE "jobOperation" ADD COLUMN "startDate" DATE;
ALTER TABLE "jobOperation" ADD COLUMN "dueDate" DATE;

ALTER TYPE "jobStatus" ADD VALUE 'Planned';
ALTER TYPE "purchaseOrderStatus" ADD VALUE 'Planned';
COMMIT;

ALTER TABLE "itemPlanning" ALTER COLUMN "demandAccumulationPeriod" SET DEFAULT 30;
UPDATE "itemPlanning" SET "demandAccumulationPeriod" = 30;


-- Replace purchasingLeadTime column with leadTime
ALTER TABLE "itemReplenishment" ADD COLUMN "leadTime" INTEGER NOT NULL DEFAULT 7;
UPDATE "itemReplenishment" 
SET "leadTime" = "purchasingLeadTime"
WHERE "purchasingLeadTime" IS NOT NULL;
ALTER TABLE "itemReplenishment" DROP COLUMN "purchasingLeadTime";

CREATE TYPE "periodType" AS ENUM ('Week', 'Day', 'Month');
CREATE TYPE "demandSourceType" AS ENUM ('Sales Order', 'Job Material');
CREATE TYPE "supplySourceType" AS ENUM ('Purchase Order', 'Production Order');

-- Time periods table for flexible bucketing (weeks initially, days in future)
CREATE TABLE "period" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "periodType" "periodType" NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "period" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."period"
FOR SELECT USING (
  (SELECT auth.role()) = 'authenticated'
);

-- Demand forecasts table for estimates
CREATE TABLE "demandForecast" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodId" TEXT NOT NULL,
  "forecastQuantity" NUMERIC NOT NULL DEFAULT 0,
  "forecastMethod" TEXT, -- 'manual', 'statistical', 'ml', etc.
  "confidence" NUMERIC(3,2), -- 0.00 to 1.00
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId"),
  CONSTRAINT "demandForecast_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandForecast_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

ALTER TABLE "demandForecast" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."demandForecast"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_permission ('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."demandForecast"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."demandForecast"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."demandForecast"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_delete')
    )::text[]
  )
);


-- Demand actuals table for historical data
CREATE TABLE "demandActual" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodId" TEXT NOT NULL,
  "actualQuantity" NUMERIC NOT NULL DEFAULT 0,
  "sourceType" "demandSourceType" NOT NULL,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType"),
  CONSTRAINT "demandActual_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandActual_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

ALTER TABLE "demandActual" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."demandActual"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_permission('inventory_view'))
    ))
  )
);


CREATE POLICY "INSERT" ON "public"."demandActual"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."demandActual"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."demandActual"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_delete')
    )::text[]
  )
);

  -- Supply forecasts table for estimates
CREATE TABLE "supplyForecast" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodId" TEXT NOT NULL,
  "forecastQuantity" NUMERIC NOT NULL DEFAULT 0,
  "forecastMethod" TEXT, -- 'manual', 'statistical', 'ml', etc.
  "confidence" NUMERIC(3,2), -- 0.00 to 1.00
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "supplyForecast_pkey" PRIMARY KEY ("itemId", "locationId", "periodId"),
  CONSTRAINT "supplyForecast_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyForecast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyForecast_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyForecast_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyForecast_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplyForecast_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);


ALTER TABLE "supplyForecast" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplyForecast"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_permission ('inventory_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."supplyForecast"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplyForecast"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplyForecast"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_delete')
    )::text[]
  )
);


-- Supply actuals table for historical data
CREATE TABLE "supplyActual" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodId" TEXT NOT NULL,
  "actualQuantity" NUMERIC NOT NULL DEFAULT 0,
  "sourceType" "supplySourceType" NOT NULL,
  "notes" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "supplyActual_pkey" PRIMARY KEY ("itemId", "locationId", "periodId", "sourceType"),
  CONSTRAINT "supplyActual_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyActual_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyActual_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyActual_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "supplyActual_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplyActual_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

ALTER TABLE "supplyActual" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplyActual"
FOR SELECT USING (
  "companyId" = ANY (
    SELECT DISTINCT unnest(ARRAY(
      SELECT unnest(get_companies_with_permission('parts_view'))
      UNION
      SELECT unnest(get_companies_with_permission('inventory_view'))
    ))
  )
);


CREATE POLICY "INSERT" ON "public"."supplyActual"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplyActual"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."supplyActual"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('inventory_delete')
    )::text[]
  )
);

-- Indexes for performance
CREATE INDEX "period_startDate_endDate_idx" ON "period" ("periodType", "startDate", "endDate");

CREATE INDEX "period_startDate_idx" ON "period" ("periodType","startDate");
CREATE INDEX "period_endDate_idx" ON "period" ("periodType", "endDate");

CREATE INDEX "demandForecast_itemId_locationId_periodId_idx" ON "demandForecast" ("itemId", "locationId", "periodId");

CREATE INDEX "demandForecast_companyId_idx" ON "demandForecast" ("companyId");

CREATE INDEX "demandActual_itemId_locationId_periodId_idx" ON "demandActual" ("itemId", "locationId", "periodId");
CREATE INDEX "demandActual_companyId_idx" ON "demandActual" ("companyId");

CREATE INDEX "supplyForecast_itemId_locationId_periodId_idx" ON "supplyForecast" ("itemId", "locationId", "periodId");
CREATE INDEX "supplyForecast_companyId_idx" ON "supplyForecast" ("companyId");

CREATE INDEX "supplyActual_itemId_locationId_periodId_idx" ON "supplyActual" ("itemId", "locationId", "periodId");
CREATE INDEX "supplyActual_companyId_idx" ON "supplyActual" ("companyId");

DROP VIEW IF EXISTS "openSalesOrderLines";
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

DROP VIEW IF EXISTS "openJobMaterialLines";
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
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate"
  FROM "jobMaterial" jm
  INNER JOIN "job" j ON jm."jobId" = j."id"
  INNER JOIN "item" i1 ON jm."itemId" = i1."id"
  INNER JOIN "item" i2 ON j."itemId" = i2."id"
  INNER JOIN "itemReplenishment" ir ON i2."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make'
);

DROP VIEW IF EXISTS "openProductionOrders";
CREATE OR REPLACE VIEW "openProductionOrders" AS (
  SELECT 
    j."id",
    j."itemId",
    j."productionQuantity" - j."quantityReceivedToInventory" AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem", 
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate"
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND j."salesOrderId" IS NULL
);

DROP VIEW IF EXISTS "openPurchaseOrderLines";
CREATE OR REPLACE VIEW "openPurchaseOrderLines" AS (
  SELECT 
    pol."id",
    pol."purchaseOrderId",
    pol."itemId", 
    pol."quantityToReceive" * pol."conversionFactor" AS "quantityToReceive",
    i."unitOfMeasureCode",
    pol."purchaseOrderLineType",
    pol."companyId",
    pol."locationId",
    po."orderDate",
    COALESCE(pol."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "purchaseOrderLine" pol
  INNER JOIN "purchaseOrder" po ON pol."purchaseOrderId" = po."id"
  INNER JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
  INNER JOIN "item" i ON pol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    pol."purchaseOrderLineType" != 'Service'
    AND po."status" IN ('To Receive', 'To Receive and Invoice', 'Planned')
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
        'Planned',
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
        'Planned',
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
      'Planned',
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
