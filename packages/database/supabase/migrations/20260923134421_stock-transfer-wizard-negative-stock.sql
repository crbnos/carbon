-- The stock transfer wizard lists an item/storage-unit pair only when it has
-- "activity". The ledger branch of that union required a POSITIVE balance, so a
-- storage unit driven negative (issued more than it held) vanished from the
-- wizard entirely — the strongest possible "needs stock" signal was the one
-- case it could not show. Include any non-zero ledger balance instead.
--
-- Bodies copied from 20260417000300_storage-unit-recreate-dependents.sql with
-- two changes, in both functions: `> 0` -> `<> 0` on the
-- item_ledgers_in_storage_unit branch of items_with_activity, and a company
-- guard at the top — these are SECURITY DEFINER and called straight from the
-- browser with a caller-supplied company_id, so they must refuse a company the
-- caller cannot view inventory for.

DROP FUNCTION IF EXISTS get_item_storage_unit_requirements_by_location;
CREATE OR REPLACE FUNCTION get_item_storage_unit_requirements_by_location(company_id TEXT, location_id TEXT)
  RETURNS TABLE (
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHandInStorageUnit" NUMERIC,
    "quantityRequiredByStorageUnit" NUMERIC,
    "quantityIncoming" NUMERIC,
    "storageUnitId" TEXT,
    "storageUnitName" TEXT,
    "isDefaultStorageUnit" BOOLEAN
  ) AS $$
  BEGIN
    -- Client-callable SECURITY DEFINER RPC: company_id comes from the caller,
    -- so scope it to a company the caller may view inventory for.
    IF NOT (company_id = ANY (get_companies_with_employee_permission('inventory_view'))) THEN
      RAISE EXCEPTION 'Not authorized to view inventory for company %', company_id
        USING ERRCODE = '42501';
    END IF;
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."storageUnitId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInStorageUnit"
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
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  active_stock_transfers_from_storage_unit AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromStorageUnitId" IS NOT NULL
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  active_stock_transfers_to_storage_unit AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toStorageUnitId" IS NOT NULL
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."storageUnitId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId", j."storageUnitId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."storageUnitId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
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
    GROUP BY pol."itemId", pol."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      SUM(il."quantity") AS "quantityOnHandInStorageUnit"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."storageUnitId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."storageUnitId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."storageUnitId"
      FROM item_ledgers_in_storage_unit ils
      WHERE ils."quantityOnHandInStorageUnit" <> 0

      UNION

      SELECT ojis."itemId", ojis."storageUnitId"
      FROM open_job_requirements_in_storage_unit ojis
      WHERE ojis."quantityOnProductionDemandInStorageUnit" > 0

      UNION

      SELECT astfs."itemId", astfs."storageUnitId"
      FROM active_stock_transfers_from_storage_unit astfs
      WHERE astfs."quantityOnActiveStockTransferFromStorageUnit" > 0

      UNION

      SELECT astts."itemId", astts."storageUnitId"
      FROM active_stock_transfers_to_storage_unit astts
      WHERE astts."quantityOnActiveStockTransferToStorageUnit" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."storageUnitId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."storageUnitId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0) AS "quantityRequiredByStorageUnit",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."storageUnitId",
  s."name" AS "storageUnitName",
  COALESCE(pm."defaultStorageUnitId" = ish."storageUnitId", false) AS "isDefaultStorageUnit"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = ish."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ils."storageUnitId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ojis."storageUnitId"
  LEFT JOIN active_stock_transfers_from_storage_unit astfs ON i."id" = astfs."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astfs."storageUnitId"
  LEFT JOIN active_stock_transfers_to_storage_unit astts ON i."id" = astts."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astts."storageUnitId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM oj."storageUnitId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM opo."storageUnitId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) - COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0)) ASC;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Source: 20260415000000_fix-stock-transfer-wizard-method-type.sql (latest body)
-- Renamed: get_item_shelf_requirements_by_location_and_item -> get_item_storage_unit_requirements_by_location_and_item
DROP FUNCTION IF EXISTS get_item_storage_unit_requirements_by_location_and_item;
CREATE OR REPLACE FUNCTION get_item_storage_unit_requirements_by_location_and_item(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)
  RETURNS TABLE (
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "type" "itemType",
    "thumbnailPath" TEXT,
    "unitOfMeasureCode" TEXT,
    "quantityOnHandInStorageUnit" NUMERIC,
    "quantityRequiredByStorageUnit" NUMERIC,
    "quantityIncoming" NUMERIC,
    "storageUnitId" TEXT,
    "storageUnitName" TEXT,
    "isDefaultStorageUnit" BOOLEAN
  ) AS $$
  BEGIN
    -- Client-callable SECURITY DEFINER RPC: company_id comes from the caller,
    -- so scope it to a company the caller may view inventory for.
    IF NOT (company_id = ANY (get_companies_with_employee_permission('inventory_view'))) THEN
      RAISE EXCEPTION 'Not authorized to view inventory for company %', company_id
        USING ERRCODE = '42501';
    END IF;
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."storageUnitId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInStorageUnit"
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
    AND (item_id IS NULL OR jm."itemId" = item_id)
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  active_stock_transfers_from_storage_unit AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromStorageUnitId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  active_stock_transfers_to_storage_unit AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toStorageUnitId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."storageUnitId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR j."itemId" = item_id)
    GROUP BY j."itemId", j."storageUnitId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."storageUnitId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
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
      AND (item_id IS NULL OR pol."itemId" = item_id)
    GROUP BY pol."itemId", pol."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      SUM(il."quantity") AS "quantityOnHandInStorageUnit"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
    GROUP BY il."itemId", il."storageUnitId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."storageUnitId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."storageUnitId"
      FROM item_ledgers_in_storage_unit ils
      WHERE ils."quantityOnHandInStorageUnit" <> 0

      UNION

      SELECT ojis."itemId", ojis."storageUnitId"
      FROM open_job_requirements_in_storage_unit ojis
      WHERE ojis."quantityOnProductionDemandInStorageUnit" > 0

      UNION

      SELECT astfs."itemId", astfs."storageUnitId"
      FROM active_stock_transfers_from_storage_unit astfs
      WHERE astfs."quantityOnActiveStockTransferFromStorageUnit" > 0

      UNION

      SELECT astts."itemId", astts."storageUnitId"
      FROM active_stock_transfers_to_storage_unit astts
      WHERE astts."quantityOnActiveStockTransferToStorageUnit" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."storageUnitId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."storageUnitId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0) AS "quantityRequiredByStorageUnit",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."storageUnitId",
  s."name" AS "storageUnitName",
  COALESCE(pm."defaultStorageUnitId" = ish."storageUnitId", false) AS "isDefaultStorageUnit"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = ish."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ils."storageUnitId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ojis."storageUnitId"
  LEFT JOIN active_stock_transfers_from_storage_unit astfs ON i."id" = astfs."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astfs."storageUnitId"
  LEFT JOIN active_stock_transfers_to_storage_unit astts ON i."id" = astts."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astts."storageUnitId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM oj."storageUnitId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM opo."storageUnitId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) - COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0)) DESC;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
