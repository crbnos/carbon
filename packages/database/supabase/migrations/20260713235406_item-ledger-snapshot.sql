-- ============================================================
-- itemLedgerSnapshot: snapshot + delta for on-hand quantity reads.
--
-- get_inventory_quantities and get_inventory_value_by_location aggregated the
-- full itemLedger history on every call. This adds a materialized snapshot so
-- live reads scan only (a) tracked-entity rows and (b) rows newer than the
-- snapshot cutoff — both small, indexed subsets — while remaining EXACT:
--
--   * Only untracked rows ("trackedEntityId" IS NULL) are snapshotted. They
--     are append-only and immutable. Tracked rows are ALWAYS computed live,
--     because sync_item_ledger_on_tracked_entity_status_change (20260420112047)
--     rewrites their "trackedEntityStatus" in place and the status-aware sums
--     (Rejected / On Hold) must never be stale.
--   * The snapshot cuts off at now() - 1 hour ("snapshotCutoff" column) rather
--     than at a max entryNumber. SERIAL values don't respect commit order, so
--     an entryNumber watermark can permanently miss a row that committed after
--     the refresh with a lower sequence value. "createdAt" is the transaction
--     start time, so any row with createdAt older than the cutoff is committed
--     and visible by refresh time — as long as no write transaction runs
--     longer than 1 hour (posting transactions run for seconds).
--   * Readers partition exactly: snapshot rows have createdAt < cutoff, the
--     live delta takes createdAt >= cutoff. A company with no snapshot rows
--     (cutoff NULL) falls back to the full live scan — identical behavior.
--
-- itemStockQuantities (the UI item-store matview consumed by
-- RealtimeDataProvider) is intentionally untouched — it remains the
-- approximate, consumer-facing total. This matview is a private building
-- block for the SECURITY DEFINER read functions, hence the REVOKEs.
-- ============================================================

-- Tracked rows are always read live; give those scans their own partial index.
CREATE INDEX IF NOT EXISTS "itemLedger_tracked_companyId_locationId_itemId_idx"
  ON "itemLedger" ("companyId", "locationId", "itemId")
  WHERE "trackedEntityId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-item-ledger-snapshot') THEN
    PERFORM cron.unschedule('refresh-item-ledger-snapshot');
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS "itemLedgerSnapshot";

CREATE MATERIALIZED VIEW "itemLedgerSnapshot" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") AS "quantity",
  SUM(CASE
    WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
    AND "createdAt" >= CURRENT_DATE - INTERVAL '30 days'
    THEN -"quantity"
    ELSE 0
  END) AS "consumed30",
  SUM(CASE
    WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
    AND "createdAt" >= CURRENT_DATE - INTERVAL '90 days'
    THEN -"quantity"
    ELSE 0
  END) AS "consumed90",
  ARRAY_AGG(DISTINCT "storageUnitId") FILTER (WHERE "storageUnitId" IS NOT NULL) AS "storageUnitIds",
  now() - INTERVAL '1 hour' AS "snapshotCutoff"
FROM "itemLedger"
WHERE "trackedEntityId" IS NULL
  AND "createdAt" < now() - INTERVAL '1 hour'
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

CREATE UNIQUE INDEX "itemLedgerSnapshot_itemId_companyId_locationId_idx"
  ON "itemLedgerSnapshot" ("itemId", "companyId", "locationId");

CREATE INDEX "itemLedgerSnapshot_companyId_locationId_idx"
  ON "itemLedgerSnapshot" ("companyId", "locationId");

-- Matviews don't support RLS; this one is only read inside SECURITY DEFINER
-- functions, so keep it out of PostgREST entirely.
REVOKE ALL ON "itemLedgerSnapshot" FROM anon, authenticated;

SELECT
  cron.schedule(
    'refresh-item-ledger-snapshot',
    '*/30 * * * *',
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY "itemLedgerSnapshot";
    $$
  );

-- ---------------------------------------------------------------------------
-- get_inventory_quantities: snapshot + delta.
-- Forked from 20260713231142_inventory-quantities-item-filter.sql. Only the
-- item_ledgers / item_storage_types / item_storage_units CTEs changed: each
-- now combines three arms — the snapshot, live tracked rows, and the live
-- untracked delta past the snapshot cutoff.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_inventory_quantities(TEXT, TEXT);
DROP FUNCTION IF EXISTS get_inventory_quantities(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_inventory_quantities(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)
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
    "storageTypeIds" TEXT[],
    "storageUnitIds" TEXT[]
  ) AS $$
  DECLARE
    v_cutoff TIMESTAMPTZ;
  BEGIN
    SELECT MAX("snapshotCutoff") INTO v_cutoff
    FROM "itemLedgerSnapshot"
    WHERE "companyId" = company_id;

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
      AND (item_id IS NULL OR pol."itemId" = item_id)
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
      AND (item_id IS NULL OR sol."itemId" = item_id)
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
    AND (item_id IS NULL OR jm."itemId" = item_id)
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
    AND (item_id IS NULL OR j."itemId" = item_id)
    GROUP BY j."itemId"
  ),
  -- Snapshot (immutable untracked rows) + live tracked rows + live untracked
  -- rows past the snapshot cutoff. With no snapshot (v_cutoff NULL) the third
  -- arm is the full untracked history — the pre-snapshot behavior.
  item_ledgers AS (
    SELECT
      combined."itemId",
      SUM(combined."quantityOnHand") AS "quantityOnHand",
      SUM(combined."quantityOnHold") AS "quantityOnHold",
      SUM(combined."quantityRejected") AS "quantityRejected",
      SUM(combined."consumed30") / 30 AS "usageLast30Days",
      SUM(combined."consumed90") / 90 AS "usageLast90Days"
    FROM (
      SELECT
        s."itemId",
        s."quantity" AS "quantityOnHand",
        0::NUMERIC AS "quantityOnHold",
        0::NUMERIC AS "quantityRejected",
        s."consumed30",
        s."consumed90"
      FROM "itemLedgerSnapshot" s
      WHERE s."companyId" = company_id
        AND s."locationId" = location_id
        AND (item_id IS NULL OR s."itemId" = item_id)

      UNION ALL

      SELECT
        il."itemId",
        CASE WHEN il."trackedEntityStatus" IS NULL
               OR il."trackedEntityStatus" != 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'On Hold'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
             THEN -il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '90 days'
             THEN -il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT
        il."itemId",
        CASE WHEN il."trackedEntityStatus" IS NULL
               OR il."trackedEntityStatus" != 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'On Hold'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected'
             THEN il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
             THEN -il."quantity" ELSE 0 END,
        CASE WHEN il."entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
               AND il."createdAt" >= CURRENT_DATE - INTERVAL '90 days'
             THEN -il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NULL
        AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
    ) combined
    GROUP BY combined."itemId"
  ),
  -- Distinct storage units the item is stocked in: snapshot arrays plus the
  -- same live arms. NULL storageUnitId rows are excluded.
  item_storage_units AS (
    SELECT
      u."itemId",
      ARRAY_AGG(DISTINCT u."storageUnitId") AS "storageUnitIds"
    FROM (
      SELECT s."itemId", su_id AS "storageUnitId"
      FROM "itemLedgerSnapshot" s
      CROSS JOIN LATERAL unnest(s."storageUnitIds") AS su_id
      WHERE s."companyId" = company_id
        AND s."locationId" = location_id
        AND (item_id IS NULL OR s."itemId" = item_id)

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND il."trackedEntityId" IS NULL
        AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
    ) u
    GROUP BY u."itemId"
  ),
  -- Distinct storage types, derived from the merged storage-unit ids.
  item_storage_types AS (
    SELECT
      isu."itemId",
      ARRAY_AGG(DISTINCT t) AS "storageTypeIds"
    FROM item_storage_units isu
    INNER JOIN "storageUnit" su
      ON su."id" = ANY(isu."storageUnitIds")
     AND su."companyId" = company_id
    CROSS JOIN LATERAL unnest(su."storageTypeIds") AS t
    GROUP BY isu."itemId"
  ),
  demand_forecast AS (
    SELECT combined."itemId", SUM(qty) AS "demandForecast"
    FROM (
      SELECT da."itemId", da."actualQuantity" AS qty
      FROM "demandActual" da
      WHERE da."companyId" = company_id AND da."locationId" = location_id
        AND (item_id IS NULL OR da."itemId" = item_id)
      UNION ALL
      SELECT df."itemId", df."forecastQuantity" AS qty
      FROM "demandForecast" df
      WHERE df."companyId" = company_id AND df."locationId" = location_id
        AND (item_id IS NULL OR df."itemId" = item_id)
    ) combined
    GROUP BY combined."itemId"
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
  COALESCE(ist."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds",
  COALESCE(isu."storageUnitIds", ARRAY[]::TEXT[]) AS "storageUnitIds"
FROM
  "item" i
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN item_storage_types ist ON i."id" = ist."itemId"
  LEFT JOIN item_storage_units isu ON i."id" = isu."itemId"
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
  i."itemTrackingType" <> 'Non-Inventory' AND i."companyId" = company_id
  AND (item_id IS NULL OR i."id" = item_id);
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- get_inventory_value_by_location: snapshot + delta.
-- Forked from 20260325031223_inventory-value-report.sql. The original summed
-- ALL rows regardless of tracked-entity status, so all three arms sum plain
-- quantity here.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_inventory_value_by_location;

CREATE OR REPLACE FUNCTION get_inventory_value_by_location(company_id TEXT)
RETURNS TABLE (
  "locationName" TEXT,
  "itemReadableId" TEXT,
  "itemName" TEXT,
  "replenishmentSystem" "itemReplenishmentSystem",
  "unitOfMeasureCode" TEXT,
  "quantityOnHand" NUMERIC,
  "unitCost" NUMERIC,
  "totalValue" NUMERIC
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  RETURN QUERY
  WITH item_ledgers AS (
    SELECT
      combined."itemId",
      combined."locationId",
      SUM(combined."quantity") AS "quantityOnHand"
    FROM (
      SELECT s."itemId", NULLIF(s."locationId", '') AS "locationId", s."quantity"
      FROM "itemLedgerSnapshot" s
      WHERE s."companyId" = company_id

      UNION ALL

      SELECT il."itemId", il."locationId", il."quantity"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT il."itemId", il."locationId", il."quantity"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NULL
        AND (v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
    ) combined
    GROUP BY combined."itemId", combined."locationId"
    HAVING SUM(combined."quantity") <> 0
  )
  SELECT
    l."name" AS "locationName",
    i."readableIdWithRevision" AS "itemReadableId",
    i."name" AS "itemName",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    il."quantityOnHand",
    COALESCE(ic."unitCost", 0) AS "unitCost",
    il."quantityOnHand" * COALESCE(ic."unitCost", 0) AS "totalValue"
  FROM item_ledgers il
  INNER JOIN "item" i ON il."itemId" = i."id"
  INNER JOIN "location" l ON il."locationId" = l."id"
  LEFT JOIN "itemCost" ic ON i."id" = ic."itemId"
  WHERE i."companyId" = company_id
  ORDER BY l."name", i."readableId";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
