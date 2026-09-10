-- Surface supersession provenance + the locked scrap rate on job materials.
--
-- `jobMaterial.substitutedFromItemId` / `substitutionFactor` have been written
-- since the supersession feature shipped, and `JobMaterialsTable` already
-- renders an "substituted from X" line from the first — but this RPC backs that
-- page and returned neither column, so the indicator read `undefined` on every
-- row and has never once rendered. The cell reaches for the field through an
-- `as { substitutedFromItemId?: string | null }` cast, which asserts an OPTIONAL
-- property onto a row type that lacks it, so nothing failed to compile.
--
-- `itemScrapPercentage` is surfaced for the same reason: it is locked at job
-- creation, `recalculate` only re-derives it when the stored value is NULL (and
-- the column is NOT NULL), so a wrong value is permanent — and it was invisible
-- in the product, which is how it stayed unnoticed.
--
-- Return type changes, so this is DROP + CREATE, not CREATE OR REPLACE. The body
-- is otherwise unchanged from the definition installed by
-- 20260708204214_partial-gr-visibility-and-short-close.sql; only the two columns
-- are added (RETURNS TABLE, the job_materials CTE, and the final SELECT), plus a
-- pinned search_path on the SECURITY DEFINER declaration.

DROP FUNCTION IF EXISTS get_job_quantity_on_hand;

CREATE OR REPLACE FUNCTION public.get_job_quantity_on_hand(job_id text, company_id text, location_id text)
 RETURNS TABLE(id text, "jobMaterialItemId" text, "jobMakeMethodId" text, "itemReadableId" text, name text, description text, "itemTrackingType" "itemTrackingType", "methodType" "methodType", type "itemType", "thumbnailPath" text, "unitOfMeasureCode" text, "quantityPerParent" numeric, "estimatedQuantity" numeric, "quantityIssued" numeric, "quantityOnHandInStorageUnit" numeric, "quantityOnHandNotInStorageUnit" numeric, "quantityOnSalesOrder" numeric, "quantityOnPurchaseOrder" numeric, "quantityOnProductionOrder" numeric, "quantityFromProductionOrderInStorageUnit" numeric, "quantityFromProductionOrderNotInStorageUnit" numeric, "quantityInTransitToStorageUnit" numeric, "storageUnitId" text, "storageUnitName" text, "itemScrapPercentage" numeric, "substitutedFromItemId" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 -- SECURITY DEFINER runs as the owner and resolves unqualified names through the
 -- CALLER's search_path, so pin it: a caller-created schema must not be able to
 -- shadow the tables below. Every object this reads lives in public.
 SET search_path = public, pg_temp
AS $function$
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
      jm."storageUnitId",
      jm."itemScrapPercentage",
      jm."substitutedFromItemId"
    FROM
      "jobMaterial" jm
    WHERE
      jm."jobId" = job_id
      -- SECURITY DEFINER bypasses RLS, so the caller's company must be checked
      -- here: without it a valid job id from another tenant returns its rows.
      AND jm."companyId" = company_id
  ),
  -- Distinct item / item+unit sets used to FILTER the aggregate CTEs below.
  -- Joining the raw job_materials rows fans out (multiplies) the aggregates when
  -- an item is on more than one BoM line — these dedupe so each item is counted
  -- once.
  job_material_items AS (
    SELECT DISTINCT jm."itemId" FROM job_materials jm
  ),
  job_material_item_units AS (
    SELECT DISTINCT jm."itemId", jm."storageUnitId" FROM job_materials jm
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * COALESCE(pol."conversionFactor", 1)) AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
      INNER JOIN job_material_items jm
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
      AND pol."receivedComplete" = false
    GROUP BY pol."itemId"
  ),
  open_stock_transfers_to AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferTo"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
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
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
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
      INNER JOIN job_material_items jm
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
    INNER JOIN job_material_items jmat
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
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = ojr."itemId" AND jm."storageUnitId" = ojr."storageUnitId"
    GROUP BY ojr."itemId"
  ),
  open_job_requirements_not_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandNotInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_material_item_units jm
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
    INNER JOIN job_material_items jm
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
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = il."ledgerItemId" AND jm."storageUnitId" = il."storageUnitId"
    GROUP BY il."ledgerItemId"
  ),
  item_ledgers_not_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandNotInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_material_item_units jm
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
  s."name" AS "storageUnitName",
  jm."itemScrapPercentage",
  jm."substitutedFromItemId"
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
$function$


