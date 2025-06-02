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
    "quantityOnHand" NUMERIC,
    "quantityOnSalesOrder" NUMERIC,
    "quantityOnPurchaseOrder" NUMERIC,
    "quantityOnProductionOrder" NUMERIC
  ) AS $$
  BEGIN
    RETURN QUERY
    
WITH
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
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
      sol."itemId" AS "salesOrderItemId",
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
  open_jobs AS (
    SELECT 
      j."itemId" AS "jobItemId",
      SUM(j."productionQuantity" + j."scrapQuantity" - j."quantityReceivedToInventory" - j."quantityShipped") AS "quantityOnProductionOrder"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused'
    )
    GROUP BY j."itemId"
  ),
  item_ledgers AS (
    SELECT "itemId" AS "ledgerItemId", SUM("quantity") AS "quantityOnHand"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
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
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(jo."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder"
FROM
  "jobMaterial" jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN item_ledgers il ON i."id" = il."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs jo ON i."id" = jo."jobItemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
WHERE
  jm."jobId" = job_id;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
