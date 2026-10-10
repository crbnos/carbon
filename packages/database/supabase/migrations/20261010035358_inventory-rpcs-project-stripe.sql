-- Project stock (Projects Phase 2a): the inventory snapshot and the quantity
-- and valuation RPCs read stock by stripe.
--
-- 1. "itemLedgerSnapshot" (recreated from 20260811123614) groups by
--    COALESCE("projectId", '') too: '' is common stock. Its unique index
--    gains "projectId", which REFRESH ... CONCURRENTLY needs.
-- 2. get_inventory_quantities (forked from 20261006130001, the newest) takes
--    a last parameter project_id: NULL is every stripe (as before), '' common
--    stock, an id that project's stock. It filters the snapshot arm, both live
--    arms and the storage-unit arms. It still returns one row per item.
-- 3. get_inventory_valuation (forked from 20261010002941, which keeps the
--    adjustment-child fix of Field Service Phase C) returns "projectId" and one
--    row per (location, item, stripe). FIFO / LIFO carrying cost averages the
--    open base layers of the row's stripe. A signature change, so it is dropped
--    first.
--
-- get_inventory_tie_out, get_item_ledger_balance and
-- get_inventory_value_by_location need no change: each sums every snapshot
-- and ledger row of an item, so a snapshot row per stripe sums as before, and
-- a plpgsql body holds no dependency on the functions or the view.
--
-- Each function keeps its SECURITY setting, search_path and
-- assert_company_access call. With no project stock every result equals the
-- result before this migration.

DROP MATERIALIZED VIEW IF EXISTS "itemLedgerSnapshot";

CREATE MATERIALIZED VIEW "itemLedgerSnapshot" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  COALESCE("projectId", '') AS "projectId",
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
GROUP BY "itemId", "companyId", COALESCE("locationId", ''), COALESCE("projectId", '');

CREATE UNIQUE INDEX "itemLedgerSnapshot_itemId_companyId_locationId_projectId_idx"
  ON "itemLedgerSnapshot" ("itemId", "companyId", "locationId", "projectId");

CREATE INDEX "itemLedgerSnapshot_companyId_locationId_idx"
  ON "itemLedgerSnapshot" ("companyId", "locationId");

-- Matviews don't support RLS; this one is only read inside SECURITY DEFINER
-- functions, so keep it out of PostgREST entirely.
REVOKE ALL ON "itemLedgerSnapshot" FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.get_inventory_quantities(text, text, text);

CREATE OR REPLACE FUNCTION public.get_inventory_quantities(company_id text, location_id text, item_id text DEFAULT NULL::text, project_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, "readableId" text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "materialSubstanceId" text, "materialFormId" text, "dimensionId" text, dimension text, "finishId" text, finish text, "gradeId" text, grade text, "materialType" text, "materialTypeId" text, "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "maximumInventoryQuantity" numeric, "orderMultiple" integer, "quantityOnHand" numeric, "quantityOnHold" numeric, "quantityRejected" numeric, "quantityOnSalesOrder" numeric, "quantityOnPurchaseOrder" numeric, "quantityOnProductionOrder" numeric, "quantityOnProductionDemand" numeric, "demandForecast" numeric, "usageLast30Days" numeric, "usageLast90Days" numeric, "daysRemaining" numeric, "storageTypeIds" text[], "storageUnitIds" text[], tags text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 -- CREATE OR REPLACE drops the pin 20261003224019 set on this function.
 SET search_path = public, extensions
AS $function$
  DECLARE
    v_cutoff TIMESTAMPTZ;
  BEGIN
  PERFORM assert_company_access(company_id);

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
        AND (project_id IS NULL OR s."projectId" = project_id)

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
        AND (project_id IS NULL OR COALESCE(il."projectId", '') = project_id)
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
        AND (project_id IS NULL OR COALESCE(il."projectId", '') = project_id)
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
        AND (project_id IS NULL OR s."projectId" = project_id)

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND (project_id IS NULL OR COALESCE(il."projectId", '') = project_id)
        AND il."trackedEntityId" IS NOT NULL

      UNION ALL

      SELECT il."itemId", il."storageUnitId"
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."locationId" = location_id
        AND il."storageUnitId" IS NOT NULL
        AND (item_id IS NULL OR il."itemId" = item_id)
        AND (project_id IS NULL OR COALESCE(il."projectId", '') = project_id)
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
      UNION ALL
      -- Planner-entered projections, net of forecast consumption. Previously
      -- omitted entirely, so a top-level item whose only demand was a
      -- projection showed zero forecast demand on the Inventory screen.
      -- Current and future weeks only: MRP re-nets a projection's consumption
      -- only inside its window, so a past week kept its last leftover and,
      -- unfiltered, every week that passed added to this total for good.
      SELECT dp."itemId", GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0) AS qty
      FROM "demandProjection" dp
      INNER JOIN "period" pr ON pr."id" = dp."periodId"
      WHERE dp."companyId" = company_id AND dp."locationId" = location_id
        AND (item_id IS NULL OR dp."itemId" = item_id)
        AND pr."endDate" >= location_today(location_id, company_id)
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
  COALESCE(isu."storageUnitIds", ARRAY[]::TEXT[]) AS "storageUnitIds",
  COALESCE(m."tags", p."tags", t."tags", c."tags") AS "tags"
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
  LEFT JOIN part p ON i."readableId" = p."id" AND p."companyId" = company_id
  LEFT JOIN tool t ON i."readableId" = t."id" AND t."companyId" = company_id
  LEFT JOIN consumable c ON i."readableId" = c."id" AND c."companyId" = company_id
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
$function$;


DROP FUNCTION IF EXISTS public.get_inventory_valuation(text, date, text);

CREATE OR REPLACE FUNCTION public.get_inventory_valuation(company_id text, as_of_date date DEFAULT NULL::date, location_id text DEFAULT NULL::text)
 RETURNS TABLE("locationId" text, "locationName" text, "itemId" text, "readableIdWithRevision" text, name text, "thumbnailPath" text, type "itemType", "replenishmentSystem" "itemReplenishmentSystem", "unitOfMeasureCode" text, "costingMethod" "itemCostingMethod", "quantityOnHand" numeric, "quantityOnHold" numeric, "quantityRejected" numeric, "unitCost" numeric, "totalValue" numeric, "projectId" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_dated BOOLEAN := as_of_date IS NOT NULL AND as_of_date < CURRENT_DATE;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT MAX("snapshotCutoff") INTO v_cutoff
  FROM "itemLedgerSnapshot"
  WHERE "companyId" = company_id;

  RETURN QUERY
  WITH quantities AS (
    SELECT
      combined."itemId",
      combined."locationId",
      combined."projectId",
      SUM(combined."quantity") AS "quantityOnHand",
      SUM(combined."onHold") AS "quantityOnHold",
      SUM(combined."rejected") AS "quantityRejected"
    FROM (
      -- Arm 1: snapshot (untracked, immutable). Skipped on dated queries —
      -- the snapshot has no postingDate grain.
      SELECT
        s."itemId",
        NULLIF(s."locationId", '') AS "locationId",
        NULLIF(s."projectId", '') AS "projectId",
        s."quantity",
        0::NUMERIC AS "onHold",
        0::NUMERIC AS "rejected"
      FROM "itemLedgerSnapshot" s
      WHERE NOT v_dated
        AND s."companyId" = company_id
        AND (location_id IS NULL OR s."locationId" = location_id)

      UNION ALL

      -- Arm 2: tracked rows, always live (status flips in place).
      SELECT
        il."itemId",
        il."locationId",
        il."projectId",
        il."quantity",
        CASE WHEN il."trackedEntityStatus" = 'On Hold' THEN il."quantity" ELSE 0 END,
        CASE WHEN il."trackedEntityStatus" = 'Rejected' THEN il."quantity" ELSE 0 END
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NOT NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)

      UNION ALL

      -- Arm 3: untracked delta past the cutoff (current path) OR the full
      -- untracked history filtered by postingDate (dated path / no snapshot).
      SELECT
        il."itemId",
        il."locationId",
        il."projectId",
        il."quantity",
        0::NUMERIC,
        0::NUMERIC
      FROM "itemLedger" il
      WHERE il."companyId" = company_id
        AND il."trackedEntityId" IS NULL
        AND (location_id IS NULL OR il."locationId" = location_id)
        AND (v_dated OR v_cutoff IS NULL OR il."createdAt" >= v_cutoff)
        AND (NOT v_dated OR il."postingDate" <= as_of_date)
    ) combined
    GROUP BY combined."itemId", combined."locationId", combined."projectId"
    HAVING SUM(combined."quantity") <> 0
  ),
  carrying AS (
    -- Company-level effective unit cost per item and stock stripe, by costing
    -- method. FIFO / LIFO average the open layers of the stripe; Standard and
    -- Average are one cost for every stripe.
    SELECT
      ic."itemId",
      st."projectId",
      ic."costingMethod",
      CASE ic."costingMethod"
        WHEN 'Standard' THEN ic."standardCost"
        WHEN 'Average' THEN ic."unitCost"
        ELSE COALESCE(layers."layerUnitCost", ic."unitCost")
      END AS "unitCost"
    FROM "itemCost" ic
    CROSS JOIN LATERAL (
      SELECT DISTINCT q."projectId"
      FROM quantities q
      WHERE q."itemId" = ic."itemId"
    ) st
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          cl."remainingQuantity" * cl."cost" / NULLIF(cl."quantity", 0)
          + COALESCE(adj."remainingCost", 0)
        ) / NULLIF(SUM(cl."remainingQuantity"), 0) AS "layerUnitCost"
      FROM "costLedger" cl
      -- The open children of this layer: the cost calculateCOGS has yet to
      -- relieve with it.
      LEFT JOIN LATERAL (
        SELECT SUM(a."cost" * a."remainingQuantity" / NULLIF(a."quantity", 0)) AS "remainingCost"
        FROM "costLedger" a
        WHERE a."appliesToCostLedgerId" = cl."id"
          AND a."companyId" = cl."companyId"
          AND a."remainingQuantity" > 0
      ) adj ON TRUE
      WHERE cl."itemId" = ic."itemId"
        AND cl."companyId" = ic."companyId"
        AND cl."remainingQuantity" > 0
        AND cl."projectId" IS NOT DISTINCT FROM st."projectId"
        -- Only base layers are layers; a child is costed with its parent.
        AND cl."adjustment" = false
        AND cl."appliesToCostLedgerId" IS NULL
    ) layers ON ic."costingMethod" IN ('FIFO', 'LIFO')
    WHERE ic."companyId" = company_id
  )
  SELECT
    l."id" AS "locationId",
    l."name" AS "locationName",
    i."id" AS "itemId",
    i."readableIdWithRevision",
    i."name",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."type",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    c."costingMethod",
    q."quantityOnHand",
    q."quantityOnHold",
    q."quantityRejected",
    COALESCE(c."unitCost", 0) AS "unitCost",
    q."quantityOnHand" * COALESCE(c."unitCost", 0) AS "totalValue",
    q."projectId"
  FROM quantities q
  INNER JOIN "item" i ON q."itemId" = i."id" AND i."companyId" = company_id
  INNER JOIN "location" l ON q."locationId" = l."id" AND l."companyId" = company_id
  LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId" AND mu."companyId" = company_id
  LEFT JOIN carrying c
    ON c."itemId" = q."itemId"
   AND c."projectId" IS NOT DISTINCT FROM q."projectId"
  ORDER BY l."name", i."readableIdWithRevision", q."projectId" NULLS FIRST;
END;
$function$;
