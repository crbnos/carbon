-- Add `storageTypeIds TEXT[]` to get_inventory_quantities so the Inventory
-- table can filter items by the storage types they're stocked in.
--
-- Aggregation: collect distinct storageType ids across every storageUnit that
-- has a non-zero ledger row for the (item, location). An item appears in the
-- filter for type T if any of its current stock sits in a storageUnit tagged
-- with T. Empty array when the item has no storageUnit-bound ledger rows.
--
-- Body otherwise identical to 20260420112047_inventory-quantity-status-aware.sql
-- (the prior latest definition) — only the new CTE + return column differ.

DROP FUNCTION IF EXISTS get_inventory_quantities(TEXT, TEXT);

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
    "dimensionId" TEXT,
    "dimension" TEXT,
    "finishId" TEXT,
    "finish" TEXT,
    "gradeId" TEXT,
    "grade" TEXT,
    "materialType" TEXT,
    "materialTypeId" TEXT,
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "leadTime" INTEGER,
    "lotSize" INTEGER,
    "reorderingPolicy" "itemReorderingPolicy",
    "demandAccumulationPeriod" INTEGER,
    "demandAccumulationSafetyStock" NUMERIC,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "minimumOrderQuantity" INTEGER,
    "maximumOrderQuantity" INTEGER,
    "maximumInventoryQuantity" NUMERIC,
    "orderMultiple" INTEGER,
    "quantityOnHand" NUMERIC,
    "quantityOnHold" NUMERIC,
    "quantityRejected" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC,
    "quantityOnProductionDemand" NUMERIC,
    "demandForecast" NUMERIC,
    "usageLast30Days" NUMERIC,
    "usageLast90Days" NUMERIC,
    "daysRemaining" NUMERIC,
    "storageTypeIds" TEXT[]
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
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
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
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT
      "itemId",
      SUM("quantity") FILTER (
        WHERE "trackedEntityStatus" IS NULL
           OR "trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand",
      SUM("quantity") FILTER (WHERE "trackedEntityStatus" = 'On Hold')
        AS "quantityOnHold",
      SUM("quantity") FILTER (WHERE "trackedEntityStatus" = 'Rejected')
        AS "quantityRejected",
      SUM(CASE
        WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
        AND "createdAt" >= CURRENT_DATE - INTERVAL '30 days'
        THEN -"quantity"
        ELSE 0
      END) / 30 AS "usageLast30Days",
      SUM(CASE
        WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
        AND "createdAt" >= CURRENT_DATE - INTERVAL '90 days'
        THEN -"quantity"
        ELSE 0
      END) / 90 AS "usageLast90Days"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
  ),
  -- Distinct storage types the item is stocked in, joined via the storage
  -- units referenced by its ledger rows. NULL storageUnitId rows are
  -- excluded — they don't belong to any unit so they can't carry types.
  item_storage_types AS (
    SELECT
      il."itemId",
      ARRAY_AGG(DISTINCT t) AS "storageTypeIds"
    FROM "itemLedger" il
    INNER JOIN "storageUnit" su
      ON su."id" = il."storageUnitId"
     AND su."companyId" = company_id
    CROSS JOIN LATERAL unnest(su."storageTypeIds") AS t
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId"
  ),
  demand_forecast AS (
    SELECT "itemId", SUM(qty) AS "demandForecast"
    FROM (
      SELECT "itemId", "actualQuantity" AS qty
      FROM "demandActual"
      WHERE "companyId" = company_id AND "locationId" = location_id
      UNION ALL
      SELECT "itemId", "forecastQuantity" AS qty
      FROM "demandForecast"
      WHERE "companyId" = company_id AND "locationId" = location_id
    ) combined
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
  m."dimensionId",
  md."name" AS "dimension",
  m."finishId",
  mf."name" AS "finish",
  m."gradeId",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialTypeId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  ir."leadTime",
  ir."lotSize",
  ip."reorderingPolicy",
  ip."demandAccumulationPeriod",
  ip."demandAccumulationSafetyStock",
  ip."reorderPoint",
  ip."reorderQuantity",
  ip."minimumOrderQuantity",
  ip."maximumOrderQuantity",
  ip."maximumInventoryQuantity",
  ip."orderMultiple",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(il."quantityOnHold", 0) AS "quantityOnHold",
  COALESCE(il."quantityRejected", 0) AS "quantityRejected",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(jr."quantityOnProductionDemand", 0) AS "quantityOnProductionDemand",
  COALESCE(df."demandForecast", 0) AS "demandForecast",
  COALESCE(il."usageLast30Days", 0) AS "usageLast30Days",
  COALESCE(il."usageLast90Days", 0) AS "usageLast90Days",
  CASE
    WHEN COALESCE(il."usageLast30Days", 0) > 0
    THEN ROUND(COALESCE(il."quantityOnHand", 0) / il."usageLast30Days", 2)
    ELSE NULL
  END AS "daysRemaining",
  COALESCE(ist."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN item_storage_types ist ON i."id" = ist."itemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."itemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."itemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."itemId"
  LEFT JOIN open_job_requirements jr ON i."id" = jr."itemId"
  LEFT JOIN demand_forecast df ON i."id" = df."itemId"
  LEFT JOIN material m ON i."readableId" = m."id" AND m."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mf ON m."finishId" = mf."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemReplenishment" ir ON i."id" = ir."itemId" AND ir."companyId" = company_id
  LEFT JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
WHERE
  i."itemTrackingType" <> 'Non-Inventory' AND i."companyId" = company_id;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
