-- get_job_quantity_on_hand: per-material on-hand, demand, and incoming supply for
-- one job's materials, scoped to the job's company + location. Feeds the Materials
-- page (on-hand/incoming/required columns) and the order-status badge/shortfall.
--
-- This revision:
--  1. NULL storage unit: a ledger/demand row with NULL storageUnitId now counts in
--     the "not in storage unit" bucket (was dropped, reporting 0 -> false
--     "needs ordering"). Added `x.storageUnitId IS NULL OR` to both "not in" joins.
--  2. open_jobs (production supply): include 'Planned' jobs and scope to
--     company + location. Was Ready/In Progress/Paused and unscoped, so planned
--     (MRP) supply was ignored while planned demand counted, and other locations'
--     production leaked in.
--  3. open_purchase_orders: include planned/pending POs ('Planned',
--     'Needs Approval', 'To Review') with COALESCE(conversionFactor, 1). Replaces
--     app-side PENDING_PO_SUPPLY_STATUSES so the Incoming column and shortfall
--     agree and the purchase-unit conversion is applied.

DROP FUNCTION IF EXISTS get_job_quantity_on_hand;
CREATE OR REPLACE FUNCTION get_job_quantity_on_hand(job_id TEXT, company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "id" TEXT,
    "jobMaterialItemId" TEXT,
    "jobMakeMethodId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "methodType" "methodType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityPerParent" NUMERIC,
    "estimatedQuantity" NUMERIC,
    "quantityIssued" NUMERIC,
    "quantityOnHandInStorageUnit" NUMERIC,
    "quantityOnHandNotInStorageUnit" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC,
    "quantityFromProductionOrderInStorageUnit" NUMERIC,
    "quantityFromProductionOrderNotInStorageUnit" NUMERIC,
    "quantityInTransitToStorageUnit" NUMERIC,
    "storageUnitId" TEXT,
    "storageUnitName" TEXT
  ) AS $$
  BEGIN
    RETURN QUERY

WITH
  job_materials AS (
    SELECT
      jm."id",
      jm."itemId",
      jm."jobMakeMethodId",
      jm."description",
      jm."methodType",
      jm."quantity",
      jm."estimatedQuantity",
      jm."quantityIssued",
      jm."storageUnitId"
    FROM
      "jobMaterial" jm
    WHERE
      jm."jobId" = job_id
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * COALESCE(pol."conversionFactor", 1)) AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
      INNER JOIN job_materials jm
        ON jm."itemId" = pol."itemId"
    WHERE
      po."status" IN (
        'Planned',
        'Needs Approval',
        'To Review',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId"
  ),
  open_stock_transfers_to AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferTo"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_materials jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_stock_transfers_from AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferFrom"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_materials jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  stock_transfers_in_transit AS (
    SELECT
      COALESCE(stt."itemId", stf."itemId") AS "itemId",
      COALESCE(stt."storageUnitId", stf."storageUnitId") AS "storageUnitId",
      COALESCE(stt."quantityOnStockTransferTo", 0) - COALESCE(stf."quantityOnStockTransferFrom", 0) AS "quantityInTransit"
    FROM open_stock_transfers_to stt
    FULL OUTER JOIN open_stock_transfers_from stf ON stt."itemId" = stf."itemId" AND stt."storageUnitId" = stf."storageUnitId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId" AS "salesOrderItemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
      INNER JOIN job_materials jm
        ON jm."itemId" = sol."itemId"
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
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
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
  open_job_requirements AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    INNER JOIN job_materials jmat
      ON jmat."itemId" = jm."itemId"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_materials jm
      ON jm."itemId" = ojr."itemId" AND jm."storageUnitId" = ojr."storageUnitId"
    GROUP BY ojr."itemId"
  ),
  open_job_requirements_not_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandNotInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_materials jm
      ON jm."itemId" = ojr."itemId" AND (jm."storageUnitId" IS NULL OR ojr."storageUnitId" IS NULL OR jm."storageUnitId" != ojr."storageUnitId")
    GROUP BY ojr."itemId"
  ),
  item_ledgers AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      -- quantityOnHand excludes only Rejected tracked entities. On Hold
      -- units are still physically in the warehouse and count toward
      -- on-hand. Rows with no tracked entity always count.
      SUM(il."quantity") FILTER (
        WHERE il."trackedEntityStatus" IS NULL
           OR il."trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand"
    FROM "itemLedger" il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."itemId"
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."ledgerItemId" AND jm."storageUnitId" = il."storageUnitId"
    GROUP BY il."ledgerItemId"
  ),
  item_ledgers_not_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandNotInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_materials jm
      ON jm."itemId" = il."ledgerItemId" AND (jm."storageUnitId" IS NULL OR il."storageUnitId" IS NULL OR jm."storageUnitId" != il."storageUnitId")
    GROUP BY il."ledgerItemId"
  )

SELECT
  jm."id",
  jm."itemId" AS "jobMaterialItemId",
  jm."jobMakeMethodId",
  i."readableId" AS "itemReadableId",
  i."name",
  jm."description",
  i."itemTrackingType",
  jm."methodType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  jm."quantity" as "quantityPerParent",
  jm."estimatedQuantity",
  jm."quantityIssued",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ilns."quantityOnHandNotInStorageUnit", 0) AS "quantityOnHandNotInStorageUnit",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(oj."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) AS "quantityFromProductionOrderInStorageUnit",
  COALESCE(ojns."quantityOnProductionDemandNotInStorageUnit", 0) AS "quantityFromProductionOrderNotInStorageUnit",
  COALESCE(stit."quantityInTransit", 0) AS "quantityInTransitToStorageUnit",
  jm."storageUnitId",
  s."name" AS "storageUnitName"
FROM
  job_materials jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = jm."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId"
  LEFT JOIN item_ledgers_not_in_storage_unit ilns ON i."id" = ilns."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId"
  LEFT JOIN open_job_requirements_not_in_storage_unit ojns ON i."id" = ojns."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN stock_transfers_in_transit stit ON jm."itemId" = stit."itemId" AND jm."storageUnitId" = stit."storageUnitId";
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
