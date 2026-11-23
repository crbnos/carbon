-- Projects Phase 2b: the planning RPCs return one row per (item, segment).
-- Spec: .ai/specs/2026-10-03-projects.md (MRP: a project-aware netting segment)
--
-- get_production_planning and get_purchasing_planning are forked from
-- 20261006130001; their grid wrappers from 20261006205037. Each keeps its
-- SECURITY setting and its assert_company_access guard.
-- get_purchasing_planning reports supplier prices as quoted
-- ("supplierUnitPrice", "currencyCode"), as main's 20261009181437 does:
-- on a new database this file runs after that column rename.
--
--   * Demand, supply and actuals group by "planningSegmentId" ('' is common).
--     Demand projections are common demand only.
--   * On-hand stays the itemLedger sum, grouped by
--     project_planning_segment("projectId"), which maps a null projectId
--     to ''.
--   * The common row keeps every rule it had. A project segment gets a row
--     when it has demand at the location. It has no reorder point, no
--     supersession reserve, and its quantityToOrder is lot-for-lot.
--   * Rows are ordered by the item id, then the segment, so a page has a
--     total order.
--   * The grid wrappers read the planning actions of the row's own segment.
--
-- A company with no project stock gets the same rows as before, with
-- "planningSegmentId" = ''. The return types change, so every function is
-- dropped and created. The wrappers are dropped first: they call the bases.

DROP FUNCTION IF EXISTS get_purchasing_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS get_production_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT[]);

-- ============================================================
-- 1. get_production_planning
-- ============================================================
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

-- ============================================================
-- 2. get_purchasing_planning
-- ============================================================
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);
CREATE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "planningSegmentId" text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "purchasingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, suppliers jsonb, "preferredSupplierId" text, "purchasingUnitOfMeasureCode" text, "conversionFactor" numeric, "quantityToOrder" numeric, "supersessionMode" text, "minimumReserveQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
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

-- ============================================================
-- 3. get_purchasing_planning_grid
-- ============================================================
CREATE FUNCTION get_purchasing_planning_grid(
  company_id TEXT,
  location_id TEXT,
  periods TEXT[],
  as_of DATE DEFAULT NULL,
  action_types TEXT[] DEFAULT NULL,
  action_assignees TEXT[] DEFAULT NULL
)
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
    "purchasingBlocked" BOOLEAN,
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
    "suppliers" JSONB,
    "preferredSupplierId" TEXT,
    "purchasingUnitOfMeasureCode" TEXT,
    "conversionFactor" NUMERIC,
    "quantityToOrder" NUMERIC,
    "supersessionMode" TEXT,
    "minimumReserveQuantity" NUMERIC,
    "week1" NUMERIC, "week2" NUMERIC, "week3" NUMERIC, "week4" NUMERIC, "week5" NUMERIC, "week6" NUMERIC,
    "week7" NUMERIC, "week8" NUMERIC, "week9" NUMERIC, "week10" NUMERIC, "week11" NUMERIC, "week12" NUMERIC,
    "week13" NUMERIC, "week14" NUMERIC, "week15" NUMERIC, "week16" NUMERIC, "week17" NUMERIC, "week18" NUMERIC,
    "week19" NUMERIC, "week20" NUMERIC, "week21" NUMERIC, "week22" NUMERIC, "week23" NUMERIC, "week24" NUMERIC,
    "week25" NUMERIC, "week26" NUMERIC, "week27" NUMERIC, "week28" NUMERIC, "week29" NUMERIC, "week30" NUMERIC,
    "week31" NUMERIC, "week32" NUMERIC, "week33" NUMERIC, "week34" NUMERIC, "week35" NUMERIC, "week36" NUMERIC,
    "week37" NUMERIC, "week38" NUMERIC, "week39" NUMERIC, "week40" NUMERIC, "week41" NUMERIC, "week42" NUMERIC,
    "week43" NUMERIC, "week44" NUMERIC, "week45" NUMERIC, "week46" NUMERIC, "week47" NUMERIC, "week48" NUMERIC,
    "week49" NUMERIC, "week50" NUMERIC, "week51" NUMERIC, "week52" NUMERIC,
    "itemPostingGroupId" TEXT,
    "planningHorizonDays" INTEGER,
    "timeFenceDate" DATE,
    "firstNegativeDate" DATE,
    "latestOrderDate" DATE,
    "orderQuantity" NUMERIC
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  SELECT
    p.*,
    (
      SELECT ic."itemPostingGroupId"
      FROM "itemCost" ic
      WHERE ic."itemId" = p."id"
        AND ic."companyId" = company_id
      LIMIT 1
    ) AS "itemPostingGroupId",
    h."days" AS "planningHorizonDays",
    (COALESCE(as_of, location_today(location_id, company_id)) + h."days") AS "timeFenceDate",
    (
      -- weekN is the projection for periods[N]
      SELECT MIN(pr."startDate")
      FROM unnest(periods) WITH ORDINALITY AS u("periodId", "n")
      INNER JOIN "period" pr ON pr."id" = u."periodId"
      WHERE (w."row" ->> ('week' || u."n"))::NUMERIC < 0
    ) AS "firstNegativeDate",
    (
      SELECT MIN(a."latestOrderDate")
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND (a."type" = 'Order' OR a."purchaseOrderLineId" IS NOT NULL)
    ) AS "latestOrderDate",
    (
      -- What the row's Order / Make button offers: the open Order actions
      -- MRP wrote, inside the item's fence. The base RPC's quantityToOrder
      -- sizes the projection again and knows nothing of what MRP did after
      -- sizing — Expedites, Increases, orders already placed — so sorted on
      -- it, rows with nothing to order sat above rows with real shortages.
      -- 0, not NULL, when there is nothing: a descending sort puts NULLs first
      SELECT COALESCE(SUM(a."suggestedQuantity"), 0)
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND a."type" = 'Order'
        AND a."purchaseOrderLineId" IS NULL
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    ) AS "orderQuantity"
  FROM get_purchasing_planning(company_id, location_id, periods) p
  -- OFFSET 0 keeps the planner from pulling to_jsonb(p) into the weekly
  -- firstNegativeDate subquery, where it ran 48 times per item (1.2 s against
  -- 0.8 s on 405 items). The JSON is built once per row.
  CROSS JOIN LATERAL (SELECT to_jsonb(p) AS "row" OFFSET 0) w
  CROSS JOIN LATERAL (
    -- 0 means "no fence", at either level. An item's 0 is how it opts OUT of a
    -- company default (empty would inherit it); NULLIF comes after the
    -- COALESCE so that 0 wins over the default instead of falling through.
    SELECT NULLIF(
      COALESCE(
        (
          SELECT ip."planningHorizonDays"
          FROM "itemPlanning" ip
          WHERE ip."itemId" = p."id"
            AND ip."locationId" = location_id
            AND ip."companyId" = company_id
        ),
        (
          SELECT cs."defaultPlanningHorizonDays"
          FROM "companySettings" cs
          WHERE cs."id" = company_id
        )
      ),
      0
    ) AS "days"
  ) h
  WHERE (action_types IS NULL AND action_assignees IS NULL)
    OR EXISTS (
      SELECT 1
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND (a."type" = 'Order' OR a."purchaseOrderLineId" IS NOT NULL)
        -- A Release applies only while its order is Planned; between runs the
        -- order can move on (sent, released) and the stale row must not match.
        -- Compared as text: the enum value is added by a later migration.
        AND (
          a."type"::TEXT <> 'Release'
          OR EXISTS (
            SELECT 1
            FROM "purchaseOrderLine" pol
            INNER JOIN "purchaseOrder" po ON po."id" = pol."purchaseOrderId"
            WHERE pol."id" = a."purchaseOrderLineId"
              AND po."status" = 'Planned'
          )
        )
        AND (action_types IS NULL OR a."type"::TEXT = ANY(action_types))
        AND (action_assignees IS NULL OR a."assignee" = ANY(action_assignees))
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    );
$$;

-- ============================================================
-- 4. get_production_planning_grid
-- ============================================================
CREATE FUNCTION get_production_planning_grid(
  company_id TEXT,
  location_id TEXT,
  periods TEXT[],
  as_of DATE DEFAULT NULL,
  action_types TEXT[] DEFAULT NULL,
  action_assignees TEXT[] DEFAULT NULL
)
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
    "week1" NUMERIC, "week2" NUMERIC, "week3" NUMERIC, "week4" NUMERIC, "week5" NUMERIC, "week6" NUMERIC,
    "week7" NUMERIC, "week8" NUMERIC, "week9" NUMERIC, "week10" NUMERIC, "week11" NUMERIC, "week12" NUMERIC,
    "week13" NUMERIC, "week14" NUMERIC, "week15" NUMERIC, "week16" NUMERIC, "week17" NUMERIC, "week18" NUMERIC,
    "week19" NUMERIC, "week20" NUMERIC, "week21" NUMERIC, "week22" NUMERIC, "week23" NUMERIC, "week24" NUMERIC,
    "week25" NUMERIC, "week26" NUMERIC, "week27" NUMERIC, "week28" NUMERIC, "week29" NUMERIC, "week30" NUMERIC,
    "week31" NUMERIC, "week32" NUMERIC, "week33" NUMERIC, "week34" NUMERIC, "week35" NUMERIC, "week36" NUMERIC,
    "week37" NUMERIC, "week38" NUMERIC, "week39" NUMERIC, "week40" NUMERIC, "week41" NUMERIC, "week42" NUMERIC,
    "week43" NUMERIC, "week44" NUMERIC, "week45" NUMERIC, "week46" NUMERIC, "week47" NUMERIC, "week48" NUMERIC,
    "week49" NUMERIC, "week50" NUMERIC, "week51" NUMERIC, "week52" NUMERIC,
    "itemPostingGroupId" TEXT,
    "planningHorizonDays" INTEGER,
    "timeFenceDate" DATE,
    "firstNegativeDate" DATE,
    "latestOrderDate" DATE,
    "orderQuantity" NUMERIC
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  SELECT
    p.*,
    (
      SELECT ic."itemPostingGroupId"
      FROM "itemCost" ic
      WHERE ic."itemId" = p."id"
        AND ic."companyId" = company_id
      LIMIT 1
    ) AS "itemPostingGroupId",
    h."days" AS "planningHorizonDays",
    (COALESCE(as_of, location_today(location_id, company_id)) + h."days") AS "timeFenceDate",
    (
      -- weekN is the projection for periods[N]
      SELECT MIN(pr."startDate")
      FROM unnest(periods) WITH ORDINALITY AS u("periodId", "n")
      INNER JOIN "period" pr ON pr."id" = u."periodId"
      WHERE (w."row" ->> ('week' || u."n"))::NUMERIC < 0
    ) AS "firstNegativeDate",
    (
      SELECT MIN(a."latestOrderDate")
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND (a."type" = 'Make' OR a."jobId" IS NOT NULL)
    ) AS "latestOrderDate",
    (
      -- What the row's Order / Make button offers: the open Make actions
      -- MRP wrote, inside the item's fence. The base RPC's quantityToOrder
      -- sizes the projection again and knows nothing of what MRP did after
      -- sizing — Expedites, Increases, orders already placed — so sorted on
      -- it, rows with nothing to order sat above rows with real shortages.
      -- 0, not NULL, when there is nothing: a descending sort puts NULLs first
      SELECT COALESCE(SUM(a."suggestedQuantity"), 0)
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND a."type" = 'Make'
        AND a."jobId" IS NULL
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    ) AS "orderQuantity"
  FROM get_production_planning(company_id, location_id, periods) p
  -- OFFSET 0 keeps the planner from pulling to_jsonb(p) into the weekly
  -- firstNegativeDate subquery, where it ran 48 times per item (1.2 s against
  -- 0.8 s on 405 items). The JSON is built once per row.
  CROSS JOIN LATERAL (SELECT to_jsonb(p) AS "row" OFFSET 0) w
  CROSS JOIN LATERAL (
    -- 0 means "no fence", at either level. An item's 0 is how it opts OUT of a
    -- company default (empty would inherit it); NULLIF comes after the
    -- COALESCE so that 0 wins over the default instead of falling through.
    SELECT NULLIF(
      COALESCE(
        (
          SELECT ip."planningHorizonDays"
          FROM "itemPlanning" ip
          WHERE ip."itemId" = p."id"
            AND ip."locationId" = location_id
            AND ip."companyId" = company_id
        ),
        (
          SELECT cs."defaultPlanningHorizonDays"
          FROM "companySettings" cs
          WHERE cs."id" = company_id
        )
      ),
      0
    ) AS "days"
  ) h
  WHERE (action_types IS NULL AND action_assignees IS NULL)
    OR EXISTS (
      SELECT 1
      FROM "planningAction" a
      WHERE a."companyId" = company_id
        AND a."itemId" = p."id"
        AND a."planningSegmentId" = p."planningSegmentId"
        AND a."locationId" = location_id
        AND a."status" = 'Open'
        AND (a."type" = 'Make' OR a."jobId" IS NOT NULL)
        -- A Release applies only while its order is Planned; between runs the
        -- order can move on (sent, released) and the stale row must not match.
        -- Compared as text: the enum value is added by a later migration.
        AND (
          a."type"::TEXT <> 'Release'
          OR EXISTS (
            SELECT 1
            FROM "job" j
            WHERE j."id" = a."jobId"
              AND j."companyId" = company_id
              AND j."status" = 'Planned'
          )
        )
        AND (action_types IS NULL OR a."type"::TEXT = ANY(action_types))
        AND (action_assignees IS NULL OR a."assignee" = ANY(action_assignees))
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    );
$$;

NOTIFY pgrst, 'reload schema';
