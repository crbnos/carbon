ALTER TABLE "itemPlanning" DROP COLUMN "demandReschedulingPeriod";
ALTER TABLE "itemPlanning" DROP COLUMN "safetyStockQuantity";
ALTER TABLE "itemPlanning" DROP COLUMN "safetyStockLeadTime";
ALTER TABLE "itemPlanning" DROP COLUMN "reorderMaximumInventory";
ALTER TABLE "itemPlanning" ADD COLUMN "maximumInventoryQuantity" NUMERIC NOT NULL DEFAULT 0;


-- Add indexes for supply and demand tables
CREATE INDEX IF NOT EXISTS "supplyActual_companyId_locationId_idx" ON "supplyActual" ("companyId", "locationId");
CREATE INDEX IF NOT EXISTS "supplyForecast_companyId_locationId_idx" ON "supplyForecast" ("companyId", "locationId");
CREATE INDEX IF NOT EXISTS "demandActual_companyId_locationId_idx" ON "demandActual" ("companyId", "locationId");
CREATE INDEX IF NOT EXISTS "demandForecast_companyId_locationId_idx" ON "demandForecast" ("companyId", "locationId");

DROP FUNCTION IF EXISTS get_production_planning;
CREATE OR REPLACE FUNCTION get_production_planning(company_id TEXT, location_id TEXT, periods TEXT[])
  RETURNS TABLE (
    "id" TEXT,
    "readableIdWithRevision" TEXT,
    "name" TEXT,
    "active" BOOLEAN,
    "type" "itemType",
    "itemTrackingType" "itemTrackingType",
    "replenishmentSystem" "itemReplenishmentSystem",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "leadTime" INTEGER,
    "manufacturingBlocked" BOOLEAN,
    "lotSize" INTEGER,
    "reorderingPolicy" "itemReorderingPolicy",
    "demandAccumulationPeriod" INTEGER,
    "demandAccumulationIncludesInventory" BOOLEAN,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "minimumOrderQuantity" INTEGER,
    "maximumOrderQuantity" INTEGER,
    "orderMultiple" INTEGER,
    "quantityOnHand" NUMERIC,
    "maximumInventoryQuantity" NUMERIC,
    "week1" NUMERIC,
    "week2" NUMERIC,
    "week3" NUMERIC,
    "week4" NUMERIC,
    "week5" NUMERIC,
    "week6" NUMERIC,
    "week7" NUMERIC,
    "week8" NUMERIC,
    "week9" NUMERIC,
    "week10" NUMERIC,
    "week11" NUMERIC,
    "week12" NUMERIC,
    "week13" NUMERIC,
    "week14" NUMERIC,
    "week15" NUMERIC,
    "week16" NUMERIC,
    "week17" NUMERIC,
    "week18" NUMERIC,
    "week19" NUMERIC,
    "week20" NUMERIC,
    "week21" NUMERIC,
    "week22" NUMERIC,
    "week23" NUMERIC,
    "week24" NUMERIC,
    "week25" NUMERIC,
    "week26" NUMERIC,
    "week27" NUMERIC,
    "week28" NUMERIC,
    "week29" NUMERIC,
    "week30" NUMERIC,
    "week31" NUMERIC,
    "week32" NUMERIC,
    "week33" NUMERIC,
    "week34" NUMERIC,
    "week35" NUMERIC,
    "week36" NUMERIC,
    "week37" NUMERIC,
    "week38" NUMERIC,
    "week39" NUMERIC,
    "week40" NUMERIC,
    "week41" NUMERIC,
    "week42" NUMERIC,
    "week43" NUMERIC,
    "week44" NUMERIC,
    "week45" NUMERIC,
    "week46" NUMERIC,
    "week47" NUMERIC,
    "week48" NUMERIC,
    "week49" NUMERIC,
    "week50" NUMERIC,
    "week51" NUMERIC,
    "week52" NUMERIC
  ) AS $$
  WITH RECURSIVE
  -- Pre-aggregate supply and demand data
  supply_data AS (
    SELECT
      "itemId",
      "periodId",
      SUM(COALESCE("actualQuantity", 0) + COALESCE("forecastQuantity", 0)) AS "supply"
    FROM (
      SELECT "itemId", "periodId", "actualQuantity", NULL as "forecastQuantity"
      FROM "supplyActual"
      WHERE "companyId" = company_id 
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
      UNION ALL
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
      FROM "supplyForecast"
      WHERE "companyId" = company_id 
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
  demand_data AS (
    SELECT
      "itemId",
      "periodId",
      SUM(COALESCE("actualQuantity", 0) + COALESCE("forecastQuantity", 0)) AS "demand"
    FROM (
      SELECT "itemId", "periodId", "actualQuantity", NULL as "forecastQuantity"
      FROM "demandActual"
      WHERE "companyId" = company_id 
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
      UNION ALL
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
      FROM "demandForecast"
      WHERE "companyId" = company_id 
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
  -- Base data for items with early filtering
  base_items AS (
    SELECT DISTINCT ON (i."id")
      i."id",
      i."readableIdWithRevision",
      i."name",
      i."active",
      i."type",
      i."itemTrackingType",
      i."replenishmentSystem",
      CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END AS "thumbnailPath",
      i."unitOfMeasureCode",
      ir."leadTime",
      ir."manufacturingBlocked",
      ir."lotSize",
      ip."reorderingPolicy",
      ip."demandAccumulationPeriod",
      ip."demandAccumulationIncludesInventory",
      ip."reorderPoint",
      ip."reorderQuantity",
      ip."minimumOrderQuantity",
      ip."maximumOrderQuantity",
      ip."orderMultiple",
      ip."maximumInventoryQuantity",
      COALESCE((
        SELECT SUM("quantity")
        FROM "itemLedger"
        WHERE "companyId" = company_id
          AND "locationId" = location_id
          AND "itemId" = i."id"
      ), 0) AS "quantityOnHand"
    FROM "item" i
    INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
    INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId"
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
    WHERE i."companyId" = company_id
      AND i."replenishmentSystem" = 'Make'
      AND i."active" = TRUE
      AND EXISTS (
        SELECT 1 FROM demand_data d 
        WHERE d."itemId" = i."id"
      )
      AND COALESCE((
        SELECT SUM("quantity")
        FROM "itemLedger"
        WHERE "companyId" = company_id
          AND "locationId" = location_id
          AND "itemId" = i."id"
      ), 0) >= 0
  ),
  -- Recursive calculation of projections with optimized joins
  projections AS (
    -- Base case: first period
    SELECT
      bi.*,
      periods[1] as "periodId",
      bi."quantityOnHand" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      1 as period_index
    FROM base_items bi
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."periodId" = periods[1]
    
    UNION ALL
    
    -- Recursive case: subsequent periods
    SELECT
      p."id",
      p."readableIdWithRevision",
      p."name",
      p."active",
      p."type",
      p."itemTrackingType",
      p."replenishmentSystem",
      p."thumbnailPath",
      p."unitOfMeasureCode",
      p."leadTime",
      p."manufacturingBlocked",
      p."lotSize",
      p."reorderingPolicy",
      p."demandAccumulationPeriod",
      p."demandAccumulationIncludesInventory",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."maximumInventoryQuantity",
      p."quantityOnHand",
      periods[p.period_index + 1] as "periodId",
      p."projection" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      p.period_index + 1 as period_index
    FROM projections p
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  )
  -- Final result with optimized pivot
  SELECT DISTINCT ON (p."id")
    p."id",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."manufacturingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationIncludesInventory",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    MAX(CASE WHEN p."periodId" = periods[1] THEN p."projection" END) AS "week1",
    MAX(CASE WHEN p."periodId" = periods[2] THEN p."projection" END) AS "week2",
    MAX(CASE WHEN p."periodId" = periods[3] THEN p."projection" END) AS "week3",
    MAX(CASE WHEN p."periodId" = periods[4] THEN p."projection" END) AS "week4",
    MAX(CASE WHEN p."periodId" = periods[5] THEN p."projection" END) AS "week5",
    MAX(CASE WHEN p."periodId" = periods[6] THEN p."projection" END) AS "week6",
    MAX(CASE WHEN p."periodId" = periods[7] THEN p."projection" END) AS "week7",
    MAX(CASE WHEN p."periodId" = periods[8] THEN p."projection" END) AS "week8",
    MAX(CASE WHEN p."periodId" = periods[9] THEN p."projection" END) AS "week9",
    MAX(CASE WHEN p."periodId" = periods[10] THEN p."projection" END) AS "week10",
    MAX(CASE WHEN p."periodId" = periods[11] THEN p."projection" END) AS "week11",
    MAX(CASE WHEN p."periodId" = periods[12] THEN p."projection" END) AS "week12",
    MAX(CASE WHEN p."periodId" = periods[13] THEN p."projection" END) AS "week13",
    MAX(CASE WHEN p."periodId" = periods[14] THEN p."projection" END) AS "week14",
    MAX(CASE WHEN p."periodId" = periods[15] THEN p."projection" END) AS "week15",
    MAX(CASE WHEN p."periodId" = periods[16] THEN p."projection" END) AS "week16",
    MAX(CASE WHEN p."periodId" = periods[17] THEN p."projection" END) AS "week17",
    MAX(CASE WHEN p."periodId" = periods[18] THEN p."projection" END) AS "week18",
    MAX(CASE WHEN p."periodId" = periods[19] THEN p."projection" END) AS "week19",
    MAX(CASE WHEN p."periodId" = periods[20] THEN p."projection" END) AS "week20",
    MAX(CASE WHEN p."periodId" = periods[21] THEN p."projection" END) AS "week21",
    MAX(CASE WHEN p."periodId" = periods[22] THEN p."projection" END) AS "week22",
    MAX(CASE WHEN p."periodId" = periods[23] THEN p."projection" END) AS "week23",
    MAX(CASE WHEN p."periodId" = periods[24] THEN p."projection" END) AS "week24",
    MAX(CASE WHEN p."periodId" = periods[25] THEN p."projection" END) AS "week25",
    MAX(CASE WHEN p."periodId" = periods[26] THEN p."projection" END) AS "week26",
    MAX(CASE WHEN p."periodId" = periods[27] THEN p."projection" END) AS "week27",
    MAX(CASE WHEN p."periodId" = periods[28] THEN p."projection" END) AS "week28",
    MAX(CASE WHEN p."periodId" = periods[29] THEN p."projection" END) AS "week29",
    MAX(CASE WHEN p."periodId" = periods[30] THEN p."projection" END) AS "week30",
    MAX(CASE WHEN p."periodId" = periods[31] THEN p."projection" END) AS "week31",
    MAX(CASE WHEN p."periodId" = periods[32] THEN p."projection" END) AS "week32",
    MAX(CASE WHEN p."periodId" = periods[33] THEN p."projection" END) AS "week33",
    MAX(CASE WHEN p."periodId" = periods[34] THEN p."projection" END) AS "week34",
    MAX(CASE WHEN p."periodId" = periods[35] THEN p."projection" END) AS "week35",
    MAX(CASE WHEN p."periodId" = periods[36] THEN p."projection" END) AS "week36",
    MAX(CASE WHEN p."periodId" = periods[37] THEN p."projection" END) AS "week37",
    MAX(CASE WHEN p."periodId" = periods[38] THEN p."projection" END) AS "week38",
    MAX(CASE WHEN p."periodId" = periods[39] THEN p."projection" END) AS "week39",
    MAX(CASE WHEN p."periodId" = periods[40] THEN p."projection" END) AS "week40",
    MAX(CASE WHEN p."periodId" = periods[41] THEN p."projection" END) AS "week41",
    MAX(CASE WHEN p."periodId" = periods[42] THEN p."projection" END) AS "week42",
    MAX(CASE WHEN p."periodId" = periods[43] THEN p."projection" END) AS "week43",
    MAX(CASE WHEN p."periodId" = periods[44] THEN p."projection" END) AS "week44",
    MAX(CASE WHEN p."periodId" = periods[45] THEN p."projection" END) AS "week45",
    MAX(CASE WHEN p."periodId" = periods[46] THEN p."projection" END) AS "week46",
    MAX(CASE WHEN p."periodId" = periods[47] THEN p."projection" END) AS "week47",
    MAX(CASE WHEN p."periodId" = periods[48] THEN p."projection" END) AS "week48",
    MAX(CASE WHEN p."periodId" = periods[49] THEN p."projection" END) AS "week49",
    MAX(CASE WHEN p."periodId" = periods[50] THEN p."projection" END) AS "week50",
    MAX(CASE WHEN p."periodId" = periods[51] THEN p."projection" END) AS "week51",
    MAX(CASE WHEN p."periodId" = periods[52] THEN p."projection" END) AS "week52"
  FROM projections p
  GROUP BY
    p."id",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."manufacturingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationIncludesInventory",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity";
$$ LANGUAGE sql SECURITY DEFINER;

-- add deadlineType and jobId to openProductionOrders
DROP VIEW IF EXISTS "openProductionOrders";
CREATE OR REPLACE VIEW "openProductionOrders" AS (
  SELECT 
    j."id",
    j."itemId",
    j."jobId",
    j."productionQuantity" - j."quantityReceivedToInventory" AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem", 
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    j."deadlineType"
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

-- add parentMaterialId, jobMakeMethodId, and jobReadableId to openJobMaterialLines
DROP VIEW IF EXISTS "openJobMaterialLines";
CREATE OR REPLACE VIEW "openJobMaterialLines" AS (
  SELECT 
    jm."id",
    jm."jobId",
    jmm."parentMaterialId",
    jm."jobMakeMethodId",
    j."jobId" as "jobReadableId",
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
  INNER JOIN "jobMakeMethod" jmm ON jm."jobMakeMethodId" = jmm."id"
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


CREATE OR REPLACE FUNCTION public.create_item_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  VALUES (new.id, 'USD', new."createdBy", new."companyId");

  -- Insert itemPlanning records for each location
  INSERT INTO public."itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT 
    new.id,
    l.id,
    new."createdBy",
    new."companyId"
  FROM public."location" l
  WHERE l."companyId" = new."companyId";
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert missing itemPlanning records for existing items and locations
INSERT INTO public."itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
SELECT DISTINCT
  i.id AS "itemId",
  l.id AS "locationId", 
  i."createdBy",
  i."companyId",
  NOW(),
  NOW()
FROM public."item" i
CROSS JOIN public."location" l
WHERE 
  l."companyId" = i."companyId"
  AND NOT EXISTS (
    SELECT 1 
    FROM public."itemPlanning" ip 
    WHERE ip."itemId" = i.id 
    AND ip."locationId" = l.id
  );



DROP TRIGGER IF EXISTS create_location ON public."location";
DROP FUNCTION IF EXISTS public.create_posting_groups_for_location;
CREATE OR REPLACE FUNCTION public.create_related_records_for_location()
RETURNS TRIGGER AS $$
DECLARE
  item_posting_group RECORD;
  account_defaults RECORD;
BEGIN
  -- create itemPlanning records for the new location
  INSERT INTO public."itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT 
    i.id AS "itemId",
    new.id AS "locationId", 
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM public."item" i
  WHERE i."companyId" = new."companyId";

  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR item_posting_group IN SELECT "id" FROM "itemPostingGroup"
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId",
      "locationId", 
      "costOfGoodsSoldAccount",
      "inventoryAccount",
      "inventoryInterimAccrualAccount",
      "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount",
      "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount",
      "directCostAppliedAccount",
      "overheadCostAppliedAccount",
      "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount",
      "materialVarianceAccount",
      "capacityVarianceAccount",
      "overheadAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      item_posting_group."id",
      new."id",
      account_defaults."costOfGoodsSoldAccount",
      account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount",
      account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount",
      account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount",
      account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount",
      account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount",
      account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount",
      account_defaults."overheadAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId",
    "locationId",
    "costOfGoodsSoldAccount",
    "inventoryAccount",
    "inventoryInterimAccrualAccount",
    "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount",
    "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount",
    "directCostAppliedAccount",
    "overheadCostAppliedAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "capacityVarianceAccount",
    "overheadAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    NULL,
    new."id",
    account_defaults."costOfGoodsSoldAccount",
    account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount",
    account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount",
    account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount",
    account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount",
    account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount",
    account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount",
    account_defaults."overheadAccount",
    new."companyId",
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_location
  AFTER INSERT on public."location"
  FOR EACH ROW EXECUTE PROCEDURE public.create_related_records_for_location();
