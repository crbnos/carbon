-- Merge of main into projects-wbs-research-spec: two objects were redefined
-- on both sides since the merge base, so whichever migration ran last would
-- drop the other side's change. This migration restates each with both.
--
-- 1. "approvalRequests": main added the changeOrder document type
--    (20261008164140_change-order-approvals.sql); this branch added
--    projectChangeRequest (20261021002000_projects-baselines.sql).
-- 2. get_available_tracked_entities: this branch added p_project_ids and the
--    "projectId" column (20261021004000_stock-pickers-project-stripe.sql);
--    main added the source-bin filter p_filter_storage_unit /
--    p_storage_unit_id (20261012153000_available-tracked-entities-storage-unit.sql).
--    Each side created its own 8- or 9-argument overload, so both are dropped
--    and one function takes every parameter. Callers pass them by name.
-- 3. get_production_planning and 4. get_purchasing_planning: main's
--    20261013004600_planning-rpcs-include-open-supply plans an item with open
--    supply in the window, and pins search_path on the purchasing RPC; it
--    forked both from versions without this branch's planning segments
--    (20261021004800_planning-rpcs-segment, 20261021010900). Each body is the
--    branch's, with main's supply clause matched on the segment.
--    20261021012700_drop-purchasing-planning-before-main drops the branch's
--    purchasing function so main's CREATE OR REPLACE can apply on a new
--    database; this migration creates the merged one again.

CREATE OR REPLACE VIEW "approvalRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  ar."id",
  ar."documentType",
  ar."documentId",
  ar."status",
  ar."requestedBy",
  ar."requestedAt",
  ar."decisionBy",
  ar."decisionAt",
  ar."decisionNotes",
  ar."companyId",
  ar."createdAt",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN po."purchaseOrderId"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."name"
    WHEN ar."documentType" = 'supplier' THEN sup."name"
    WHEN ar."documentType" = 'changeOrder' THEN co."changeOrderId"
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."readableId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'changeOrder' THEN co."name"
    WHEN ar."documentType" = 'projectChangeRequest' THEN pcr."title"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "changeOrder" co ON ar."documentType" = 'changeOrder' AND ar."documentId" = co."id" AND ar."companyId" = co."companyId"
LEFT JOIN "projectChangeRequest" pcr ON ar."documentType" = 'projectChangeRequest' AND ar."documentId" = pcr."id" AND ar."companyId" = pcr."companyId";

DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
);
DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT[]
);
DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION get_available_tracked_entities(
  p_item_id TEXT,
  p_company_id TEXT,
  p_location_id TEXT,
  p_exclude_lineside BOOLEAN DEFAULT false,
  p_exclude_allocated BOOLEAN DEFAULT false,
  p_exclude_line_id TEXT DEFAULT NULL,
  p_sort_method TEXT DEFAULT 'Default',
  p_project_ids TEXT[] DEFAULT ARRAY[NULL]::TEXT[],
  p_filter_storage_unit BOOLEAN DEFAULT false,
  p_storage_unit_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "expirationDate" DATE,
  "status" TEXT,
  "projectId" TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH bin_onhand AS (
    SELECT
      il."trackedEntityId",
      il."projectId",
      il."storageUnitId",
      s."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    LEFT JOIN "storageUnit" s ON s."id" = il."storageUnitId"
    WHERE il."itemId" = p_item_id
      AND il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."trackedEntityId" IS NOT NULL
      AND COALESCE(il."projectId", '') = ANY (
        ARRAY(SELECT COALESCE(stripe, '') FROM unnest(COALESCE(p_project_ids, ARRAY[NULL]::TEXT[])) AS stripe)
      )
      AND (
        NOT p_exclude_lineside
        OR get_effective_work_center_id(il."storageUnitId") IS NULL
      )
      AND (
        NOT p_filter_storage_unit
        OR il."storageUnitId" IS NOT DISTINCT FROM p_storage_unit_id
      )
    GROUP BY il."trackedEntityId", il."projectId", il."storageUnitId", s."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "trackedEntityId", "projectId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "trackedEntityId", "projectId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId", "projectId")
      "trackedEntityId", "projectId", "storageUnitId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", "projectId", on_hand DESC
  ),
  allocated AS (
    SELECT pllte."trackedEntityId", SUM(pllte."quantity") AS allocated_qty
    FROM "pickingListLineTrackedEntity" pllte
    JOIN "pickingListLine" pll ON pll."id" = pllte."pickingListLineId"
    JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
    WHERE pl."status" <> 'Cancelled'
      AND pll."status" <> 'Cancelled'
      AND (p_exclude_line_id IS NULL OR pll."id" <> p_exclude_line_id)
    GROUP BY pllte."trackedEntityId"
  )
  SELECT
    et."trackedEntityId",
    te."readableId",
    pb."storageUnitId",
    pb.storage_unit_name AS "storageUnitName",
    et.total_on_hand
      - CASE WHEN p_exclude_allocated THEN COALESCE(a.allocated_qty, 0) ELSE 0 END
      AS "availableQuantity",
    te."createdAt",
    te."expirationDate",
    te."status",
    et."projectId"
  FROM entity_total et
  JOIN "trackedEntity" te ON te."id" = et."trackedEntityId"
  JOIN primary_bin pb
    ON pb."trackedEntityId" = et."trackedEntityId"
   AND pb."projectId" IS NOT DISTINCT FROM et."projectId"
  LEFT JOIN allocated a ON a."trackedEntityId" = et."trackedEntityId"
  WHERE te."status" = 'Available'
    AND (
      et.total_on_hand
        - CASE WHEN p_exclude_allocated THEN COALESCE(a.allocated_qty, 0) ELSE 0 END
    ) > 0
  ORDER BY
    CASE WHEN COALESCE(p_sort_method, 'Default') IN ('Default', 'FEFO')
         THEN te."expirationDate" END ASC NULLS LAST,
    CASE WHEN COALESCE(p_sort_method, 'Default') = 'LIFO'
         THEN te."createdAt" END DESC,
    te."createdAt" ASC;
$$;

-- 3. get_production_planning
DROP FUNCTION IF EXISTS get_production_planning(TEXT, TEXT, TEXT[]);
CREATE FUNCTION get_production_planning(company_id TEXT, location_id TEXT, periods TEXT[])
  RETURNS TABLE (
    "id" TEXT,
    "planningSegmentId" TEXT,
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
    "demandAccumulationSafetyStock" NUMERIC,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "minimumOrderQuantity" INTEGER,
    "maximumOrderQuantity" INTEGER,
    "orderMultiple" INTEGER,
    "quantityOnHand" NUMERIC,
    "maximumInventoryQuantity" NUMERIC,
    "quantityToOrder" NUMERIC,
    "supersessionMode" TEXT,
    "minimumReserveQuantity" NUMERIC,
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
BEGIN
  -- Tenant guard: SECURITY DEFINER bypasses RLS and PostgREST lets any caller
  -- supply an arbitrary company_id. The shared guard every SECURITY DEFINER
  -- read opens with (20260925121735_rpc-function-guards.sql), as
  -- get_purchasing_planning below does: service_role and direct connections
  -- pass, anyone else must belong to the company.
  PERFORM assert_company_access(company_id);

  RETURN QUERY
  WITH RECURSIVE
  -- Incoming supply per item/period: received quantities (supplyActual) plus
  -- planned/expected receipts (supplyForecast, e.g. MRP planned orders).
  supply_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "supply"
    FROM (
      SELECT sa."itemId", sa."planningSegmentId", sa."periodId", sa."actualQuantity", NULL as "forecastQuantity"
      FROM "supplyActual" sa
      WHERE sa."companyId" = company_id
        AND sa."locationId" = location_id
        AND sa."periodId" = ANY(periods)
      UNION ALL
      SELECT sf."itemId", sf."planningSegmentId", sf."periodId", NULL as "actualQuantity", sf."forecastQuantity"
      FROM "supplyForecast" sf
      WHERE sf."companyId" = company_id
        AND sf."locationId" = location_id
        AND sf."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  -- Demand per item/period, from three sources:
  --   1. demandActual   — real demand (sales order lines, job materials)
  --   2. demandForecast — MRP output: BOM-derived (child) demand
  --   3. demandProjection — planner-entered top-level projections (NEW in this
  --      migration; previously missing, so purely-projected items never showed)
  demand_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "demand"
    FROM (
      SELECT da."itemId", da."planningSegmentId", da."periodId", da."actualQuantity", NULL as "forecastQuantity"
      FROM "demandActual" da
      WHERE da."companyId" = company_id
        AND da."locationId" = location_id
        AND da."periodId" = ANY(periods)
      UNION ALL
      SELECT df."itemId", df."planningSegmentId", df."periodId", NULL as "actualQuantity", df."forecastQuantity"
      FROM "demandForecast" df
      WHERE df."companyId" = company_id
        AND df."locationId" = location_id
        AND df."periodId" = ANY(periods)
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (consumedQuantity), so only
      -- the unconsumed remainder still drives demand here. Without this arm a
      -- make item whose only demand is a projection never appears in
      -- production planning to create jobs.
      -- Projections are common demand only.
      SELECT dp."itemId", ''::TEXT AS "planningSegmentId", dp."periodId", NULL as "actualQuantity",
             GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection" dp
      WHERE dp."companyId" = company_id
        AND dp."locationId" = location_id
        AND dp."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  -- Which items belong on the production planning screen: active Make items
  -- with replenishment + planning settings at this location, that either have
  -- demand in the selected periods or are stock-driven (reorder point with a
  -- Fixed Reorder Quantity / Maximum Quantity policy). Supersession rules drop
  -- obsolete/phased-out items.
  base_items AS (
    SELECT DISTINCT ON (i."id", seg."planningSegmentId")
      i."id",
      seg."planningSegmentId",
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
      ip."demandAccumulationSafetyStock",
      ip."reorderPoint",
      ip."reorderQuantity",
      ip."minimumOrderQuantity",
      ip."maximumOrderQuantity",
      ip."orderMultiple",
      ip."maximumInventoryQuantity",
      -- On-hand of the row's segment: project_planning_segment maps a stripe
      -- to its project when the project has project stock, else to ''. The
      -- CASE skips the project lookup for common rows (null projectId).
      COALESCE((
        SELECT SUM(il."quantity")
        FROM "itemLedger" il
        WHERE il."companyId" = company_id
          AND il."locationId" = location_id
          AND il."itemId" = i."id"
          AND CASE
                WHEN il."projectId" IS NULL THEN ''
                ELSE project_planning_segment(il."projectId")
              END = seg."planningSegmentId"
      ), 0) AS "quantityOnHand"
    FROM "item" i
    INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
    INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
    -- One row per segment: common always, plus each project segment with
    -- demand at this location.
    CROSS JOIN LATERAL (
      SELECT ''::TEXT AS "planningSegmentId"
      UNION
      SELECT d."planningSegmentId" FROM demand_data d WHERE d."itemId" = i."id"
    ) seg
    WHERE i."companyId" = company_id
      AND i."replenishmentSystem" = 'Make'
      AND i."itemTrackingType" != 'Non-Inventory'
      AND i."active" = TRUE
      -- Supersession: drop obsolete items and items past their discontinuation
      -- date so no new orders are suggested.
      AND NOT EXISTS (
        SELECT 1 FROM "itemSupersession" ss
        WHERE ss."itemId" = i."id"
          AND (
            ss."supersessionMode" = 'No Stock'
            OR (
              -- date-based suppression applies only to the phase-out modes; Stock
              -- Only keeps replenishing to its reserve floor regardless of date.
              ss."supersessionMode" IN ('Consume First', 'Prefer New')
              AND ss."discontinuationDate" IS NOT NULL
              AND ss."discontinuationDate" <= CURRENT_DATE
            )
          )
      )
      AND (
        EXISTS (
          SELECT 1 FROM demand_data d
          WHERE d."itemId" = i."id"
            AND d."planningSegmentId" = seg."planningSegmentId"
        )
        -- Reorder policy is common only: project segments are lot-for-lot.
        OR (
          seg."planningSegmentId" = ''
          AND ip."reorderPoint" > 0
          AND ip."reorderingPolicy" IN ('Fixed Reorder Quantity', 'Maximum Quantity')
        )
        -- Main (20261013004600): an item with open supply in the window is
        -- planned, so a job or PO left without demand can still be cancelled.
        OR EXISTS (
          SELECT 1 FROM supply_data s
          WHERE s."itemId" = i."id"
            AND s."planningSegmentId" = seg."planningSegmentId"
            AND s."supply" > 0
        )
      )
  ),
  -- Week-by-week running inventory balance: start from on-hand, then for each
  -- selected period add supply and subtract demand (recursive walk). Negative
  -- values are the projected shortfall the planner needs to cover with jobs.
  projections AS (
    SELECT
      bi.*,
      periods[1] as "periodId",
      bi."quantityOnHand" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      1 as period_index
    FROM base_items bi
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."planningSegmentId" = bi."planningSegmentId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."planningSegmentId" = bi."planningSegmentId" AND d."periodId" = periods[1]

    UNION ALL

    SELECT
      p."id",
      p."planningSegmentId",
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
      p."demandAccumulationSafetyStock",
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
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."planningSegmentId" = p."planningSegmentId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."planningSegmentId" = p."planningSegmentId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      p."planningSegmentId",
      CASE
        -- A project segment is lot-for-lot: order its whole shortfall.
        WHEN p."planningSegmentId" <> '' THEN GREATEST(0, -MIN(p."projection"))
        ELSE calculate_quantity_to_order(
        p."reorderingPolicy",
        p."reorderPoint",
        p."reorderQuantity",
        p."minimumOrderQuantity",
        p."maximumOrderQuantity",
        p."orderMultiple",
        p."lotSize",
        p."maximumInventoryQuantity",
        p."demandAccumulationPeriod",
        p."demandAccumulationSafetyStock",
        array_agg(p."projection" ORDER BY p.period_index)
      )
      END AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
      p."planningSegmentId",
      p."reorderingPolicy",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."lotSize",
      p."maximumInventoryQuantity",
      p."demandAccumulationPeriod",
      p."demandAccumulationSafetyStock"
  )
  SELECT DISTINCT ON (p."id", p."planningSegmentId")
    p."id",
    p."planningSegmentId",
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
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    CASE
      -- Supersession is common only.
      WHEN ss."supersessionMode" = 'Stock Only' AND p."planningSegmentId" = ''
        THEN GREATEST(
          0,
          COALESCE(rsv."minimumReserveQuantity", 0)
            - p."quantityOnHand"
            - COALESCE(sup."incomingSupply", 0)
        )
      ELSE COALESCE(oq."quantityToOrder", 0)
    END AS "quantityToOrder",
    ss."supersessionMode"::TEXT AS "supersessionMode",
    COALESCE(rsv."minimumReserveQuantity", 0) AS "minimumReserveQuantity",
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
  LEFT JOIN order_quantities oq ON p."id" = oq."id" AND oq."planningSegmentId" = p."planningSegmentId"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT sd."itemId", sd."planningSegmentId", SUM(sd."supply") AS "incomingSupply"
    FROM supply_data sd GROUP BY sd."itemId", sd."planningSegmentId"
  ) sup ON sup."itemId" = p."id" AND sup."planningSegmentId" = p."planningSegmentId"
  GROUP BY
    p."id",
    p."planningSegmentId",
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
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    oq."quantityToOrder",
    ss."supersessionMode",
    rsv."minimumReserveQuantity",
    sup."incomingSupply"
  ORDER BY p."id", p."planningSegmentId";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. get_purchasing_planning
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);
CREATE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "planningSegmentId" text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "purchasingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, suppliers jsonb, "preferredSupplierId" text, "purchasingUnitOfMeasureCode" text, "conversionFactor" numeric, "quantityToOrder" numeric, "supersessionMode" text, "minimumReserveQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT assert_company_access(company_id);
  WITH RECURSIVE
  supply_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "supply"
    FROM (
      SELECT sa."itemId", sa."planningSegmentId", sa."periodId", sa."actualQuantity", NULL as "forecastQuantity"
      FROM "supplyActual" sa
      WHERE sa."companyId" = company_id
        AND sa."locationId" = location_id
        AND sa."periodId" = ANY(periods)
      UNION ALL
      SELECT sf."itemId", sf."planningSegmentId", sf."periodId", NULL as "actualQuantity", sf."forecastQuantity"
      FROM "supplyForecast" sf
      WHERE sf."companyId" = company_id
        AND sf."locationId" = location_id
        AND sf."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  demand_data AS (
    SELECT
      combined."itemId",
      combined."planningSegmentId",
      combined."periodId",
      SUM(COALESCE(combined."actualQuantity", 0) + COALESCE(combined."forecastQuantity", 0)) AS "demand"
    FROM (
      SELECT da."itemId", da."planningSegmentId", da."periodId", da."actualQuantity", NULL as "forecastQuantity"
      FROM "demandActual" da
      WHERE da."companyId" = company_id
        AND da."locationId" = location_id
        AND da."periodId" = ANY(periods)
      UNION ALL
      SELECT df."itemId", df."planningSegmentId", df."periodId", NULL as "actualQuantity", df."forecastQuantity"
      FROM "demandForecast" df
      WHERE df."companyId" = company_id
        AND df."locationId" = location_id
        AND df."periodId" = ANY(periods)
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (consumedQuantity), so only
      -- the unconsumed remainder still drives demand here. Without this arm a
      -- purchased item whose only demand is a projection never appears in
      -- purchasing planning and never drives a suggested order.
      -- Projections are common demand only.
      SELECT dp."itemId", ''::TEXT AS "planningSegmentId", dp."periodId", NULL as "actualQuantity",
             GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection" dp
      WHERE dp."companyId" = company_id
        AND dp."locationId" = location_id
        AND dp."periodId" = ANY(periods)
    ) combined
    GROUP BY combined."itemId", combined."planningSegmentId", combined."periodId"
  ),
  base_items AS (
    SELECT DISTINCT ON (i."id", seg."planningSegmentId")
      i."id",
      seg."planningSegmentId",
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
      ir."purchasingBlocked",
      ir."lotSize",
      ir."preferredSupplierId",
      ir."purchasingUnitOfMeasureCode",
      ir."conversionFactor",
      ip."reorderingPolicy",
      ip."demandAccumulationPeriod",
      ip."demandAccumulationSafetyStock",
      ip."reorderPoint",
      ip."reorderQuantity",
      ip."minimumOrderQuantity",
      ip."maximumOrderQuantity",
      ip."orderMultiple",
      ip."maximumInventoryQuantity",
      COALESCE(ps."suppliers", '[]'::jsonb) as "suppliers",
      -- On-hand of the row's segment: project_planning_segment maps a stripe
      -- to its project when the project has project stock, else to ''. The
      -- CASE skips the project lookup for common rows (null projectId).
      COALESCE((
        SELECT SUM(il."quantity")
        FROM "itemLedger" il
        WHERE il."companyId" = company_id
          AND il."locationId" = location_id
          AND il."itemId" = i."id"
          AND CASE
                WHEN il."projectId" IS NULL THEN ''
                ELSE project_planning_segment(il."projectId")
              END = seg."planningSegmentId"
      ), 0) AS "quantityOnHand"
    FROM "item" i
    INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
    INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
    LEFT JOIN (
      SELECT
        ps."itemId",
        jsonb_agg(
          jsonb_build_object(
            'id', ps."id",
            'minimumOrderQuantity', ps."minimumOrderQuantity",
            'supplierUnitOfMeasureCode', ps."supplierUnitOfMeasureCode",
            'conversionFactor', ps."conversionFactor",
            'supplierUnitPrice', ps."supplierUnitPrice",
            'currencyCode', ps."currencyCode",
            'supplierId', ps."supplierId",
            'supplierPartId', ps."supplierPartId"
          )
        ) AS "suppliers"
      FROM "supplierPart" ps
      WHERE ps."companyId" = company_id
        AND ps.active = true
      GROUP BY ps."itemId"
    ) ps ON ps."itemId" = i."id"
    -- One row per segment: common always, plus each project segment with
    -- demand at this location.
    CROSS JOIN LATERAL (
      SELECT ''::TEXT AS "planningSegmentId"
      UNION
      SELECT d."planningSegmentId" FROM demand_data d WHERE d."itemId" = i."id"
    ) seg
    WHERE i."companyId" = company_id
      AND i."replenishmentSystem" != 'Make'
      AND i."itemTrackingType" != 'Non-Inventory'
      AND i."active" = TRUE
      -- Supersession: drop obsolete items and items past their discontinuation
      -- date so no new orders are suggested.
      AND NOT EXISTS (
        SELECT 1 FROM "itemSupersession" ss
        WHERE ss."itemId" = i."id"
          AND (
            ss."supersessionMode" = 'No Stock'
            OR (
              -- date-based suppression applies only to the phase-out modes; Stock
              -- Only keeps replenishing to its reserve floor regardless of date.
              ss."supersessionMode" IN ('Consume First', 'Prefer New')
              AND ss."discontinuationDate" IS NOT NULL
              AND ss."discontinuationDate" <= CURRENT_DATE
            )
          )
      )
      AND (
        EXISTS (
          SELECT 1 FROM demand_data d
          WHERE d."itemId" = i."id"
            AND d."planningSegmentId" = seg."planningSegmentId"
        )
        -- Reorder policy is common only: project segments are lot-for-lot.
        OR (
          seg."planningSegmentId" = ''
          AND ip."reorderPoint" > 0
          AND ip."reorderingPolicy" IN ('Fixed Reorder Quantity', 'Maximum Quantity')
        )
        -- Main (20261013004600): an item with open supply in the window is
        -- planned, so a job or PO left without demand can still be cancelled.
        OR EXISTS (
          SELECT 1 FROM supply_data s
          WHERE s."itemId" = i."id"
            AND s."planningSegmentId" = seg."planningSegmentId"
            AND s."supply" > 0
        )
      )
  ),
  projections AS (
    SELECT
      bi.*,
      periods[1] as "periodId",
      bi."quantityOnHand" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      1 as period_index
    FROM base_items bi
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."planningSegmentId" = bi."planningSegmentId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."planningSegmentId" = bi."planningSegmentId" AND d."periodId" = periods[1]

    UNION ALL

    SELECT
      p."id",
      p."planningSegmentId",
      p."readableIdWithRevision",
      p."name",
      p."active",
      p."type",
      p."itemTrackingType",
      p."replenishmentSystem",
      p."thumbnailPath",
      p."unitOfMeasureCode",
      p."leadTime",
      p."purchasingBlocked",
      p."lotSize",
      p."preferredSupplierId",
      p."purchasingUnitOfMeasureCode",
      p."conversionFactor",
      p."reorderingPolicy",
      p."demandAccumulationPeriod",
      p."demandAccumulationSafetyStock",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."maximumInventoryQuantity",
      p."suppliers",
      p."quantityOnHand",
      periods[p.period_index + 1] as "periodId",
      p."projection" + COALESCE(s."supply", 0) - COALESCE(d."demand", 0) AS "projection",
      p.period_index + 1 as period_index
    FROM projections p
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."planningSegmentId" = p."planningSegmentId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."planningSegmentId" = p."planningSegmentId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      p."planningSegmentId",
      CASE
        -- A project segment is lot-for-lot: order its whole shortfall.
        WHEN p."planningSegmentId" <> '' THEN GREATEST(0, -MIN(p."projection"))
        ELSE calculate_quantity_to_order(
        p."reorderingPolicy",
        p."reorderPoint",
        p."reorderQuantity",
        p."minimumOrderQuantity",
        p."maximumOrderQuantity",
        p."orderMultiple",
        p."lotSize",
        p."maximumInventoryQuantity",
        p."demandAccumulationPeriod",
        p."demandAccumulationSafetyStock",
        array_agg(p."projection" ORDER BY p.period_index)
      )
      END AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
      p."planningSegmentId",
      p."reorderingPolicy",
      p."reorderPoint",
      p."reorderQuantity",
      p."minimumOrderQuantity",
      p."maximumOrderQuantity",
      p."orderMultiple",
      p."lotSize",
      p."maximumInventoryQuantity",
      p."demandAccumulationPeriod",
      p."demandAccumulationSafetyStock"
  )
  SELECT DISTINCT ON (p."id", p."planningSegmentId")
    p."id",
    p."planningSegmentId",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."purchasingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    p."suppliers",
    p."preferredSupplierId",
    p."purchasingUnitOfMeasureCode",
    p."conversionFactor",
    CASE
      -- Supersession is common only.
      WHEN ss."supersessionMode" = 'Stock Only' AND p."planningSegmentId" = ''
        THEN GREATEST(
          0,
          COALESCE(rsv."minimumReserveQuantity", 0)
            - p."quantityOnHand"
            - COALESCE(sup."incomingSupply", 0)
        )
      ELSE COALESCE(oq."quantityToOrder", 0)
    END AS "quantityToOrder",
    ss."supersessionMode" AS "supersessionMode",
    COALESCE(rsv."minimumReserveQuantity", 0) AS "minimumReserveQuantity",
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
  LEFT JOIN order_quantities oq ON p."id" = oq."id" AND oq."planningSegmentId" = p."planningSegmentId"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT sd."itemId", sd."planningSegmentId", SUM(sd."supply") AS "incomingSupply"
    FROM supply_data sd GROUP BY sd."itemId", sd."planningSegmentId"
  ) sup ON sup."itemId" = p."id" AND sup."planningSegmentId" = p."planningSegmentId"
  GROUP BY
    p."id",
    p."planningSegmentId",
    p."readableIdWithRevision",
    p."name",
    p."active",
    p."type",
    p."itemTrackingType",
    p."replenishmentSystem",
    p."thumbnailPath",
    p."unitOfMeasureCode",
    p."leadTime",
    p."purchasingBlocked",
    p."lotSize",
    p."reorderingPolicy",
    p."demandAccumulationPeriod",
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    p."suppliers",
    p."preferredSupplierId",
    p."purchasingUnitOfMeasureCode",
    p."conversionFactor",
    oq."quantityToOrder",
    ss."supersessionMode",
    rsv."minimumReserveQuantity",
    sup."incomingSupply"
  ORDER BY p."id", p."planningSegmentId";
$function$;
