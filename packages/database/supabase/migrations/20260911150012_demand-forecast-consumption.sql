-- Demand forecast consumption: actual demand (open SO lines, job materials)
-- consumes the authored forecast (demandProjection) so the two never
-- double-count. runMrp computes consumption per weekly bucket (own bucket ->
-- backward N -> forward M, company settings below) and persists it as
-- demandProjection.consumedQuantity; every read path subtracts
-- GREATEST(forecastQuantity - consumedQuantity, 0).
-- Spec: .ai/specs/2026-09-11-demand-forecast-consumption.md

-- ============================================================
-- 1. Consumption state (MRP-written, derived — never user-authored)
-- ============================================================
ALTER TABLE "demandProjection"
  ADD COLUMN IF NOT EXISTS "consumedQuantity" NUMERIC NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Company-level consumption window, in weekly periods
--    (0/0 = same-week netting only)
-- ============================================================
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "forecastConsumptionBackwardPeriods" INTEGER NOT NULL DEFAULT 4
    CHECK ("forecastConsumptionBackwardPeriods" >= 0),
  ADD COLUMN IF NOT EXISTS "forecastConsumptionForwardPeriods" INTEGER NOT NULL DEFAULT 1
    CHECK ("forecastConsumptionForwardPeriods" >= 0);

-- ============================================================
-- 3. openSalesOrderLines: expose the pre-job-dedup open quantity as
--    "quantityToConsume". An MTO line fully covered by its linked job still
--    consumed the forecast that predicted it; only its residual
--    ("quantityToSend") drives new supply.
-- Forked from 20260811123619_widen-sales-production-scale.sql
-- ============================================================
DROP VIEW IF EXISTS "openSalesOrderLines";
CREATE VIEW "openSalesOrderLines" WITH (security_invoker=true) AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    CASE
      WHEN sol."methodType" = 'Make to Order' THEN GREATEST(
        sol."quantityToSend" - COALESCE((
          SELECT SUM(GREATEST(j."quantity" - j."quantityReceivedToInventory" - j."quantityShipped", 0))
          FROM "job" j
          WHERE j."salesOrderLineId" = sol."id"
            AND j."companyId" = sol."companyId"
            AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
        ), 0),
        0
      )
      ELSE sol."quantityToSend"
    END AS "quantityToSend",
    -- Pre-job-dedup open quantity: what this line CONSUMES from the demand
    -- forecast. An MTO line fully covered by its linked job still consumed
    -- the forecast that predicted it; only its residual drives new supply.
    sol."quantityToSend" AS "quantityToConsume",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE sol."salesOrderLineType" != 'Service'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);

-- ============================================================
-- 4. get_production_planning: demandProjection arm nets consumption.
-- Forked from 20260715195226_planning-reads-demand-projections.sql
-- ============================================================
DROP FUNCTION IF EXISTS get_production_planning(TEXT, TEXT, TEXT[]);
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
  -- supply an arbitrary company_id. Require company membership (user JWT or
  -- API key — get_companies_with_employee_role() covers both) unless the
  -- caller is service_role (the ERP route uses bypassRls) or a direct
  -- Postgres connection (edge functions), which are already privileged.
  IF session_user = 'authenticator' AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF NOT (company_id = ANY (COALESCE(get_companies_with_employee_role(), ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  -- Incoming supply per item/period: received quantities (supplyActual) plus
  -- planned/expected receipts (supplyForecast, e.g. MRP planned orders).
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
  -- Demand per item/period, from three sources:
  --   1. demandActual   — real demand (sales order lines, job materials)
  --   2. demandForecast — MRP output: BOM-derived (child) demand
  --   3. demandProjection — planner-entered top-level projections (NEW in this
  --      migration; previously missing, so purely-projected items never showed)
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
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (consumedQuantity), so only
      -- the unconsumed remainder still drives demand here. Without this arm a
      -- make item whose only demand is a projection never appears in
      -- production planning to create jobs.
      SELECT "itemId", "periodId", NULL as "actualQuantity",
             GREATEST("forecastQuantity" - "consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
  -- Which items belong on the production planning screen: active Make items
  -- with replenishment + planning settings at this location, that either have
  -- demand in the selected periods or are stock-driven (reorder point with a
  -- Fixed Reorder Quantity / Maximum Quantity policy). Supersession rules drop
  -- obsolete/phased-out items.
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
      ip."demandAccumulationSafetyStock",
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
    INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId" AND ip."locationId" = location_id
    LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
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
        )
        OR (
          ip."reorderPoint" > 0
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
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."periodId" = periods[1]

    UNION ALL

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
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      calculate_quantity_to_order(
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
      ) AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
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
    p."demandAccumulationSafetyStock",
    p."reorderPoint",
    p."reorderQuantity",
    p."minimumOrderQuantity",
    p."maximumOrderQuantity",
    p."orderMultiple",
    p."quantityOnHand",
    p."maximumInventoryQuantity",
    CASE
      WHEN ss."supersessionMode" = 'Stock Only'
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
  LEFT JOIN order_quantities oq ON p."id" = oq."id"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT "itemId", SUM("supply") AS "incomingSupply"
    FROM supply_data GROUP BY "itemId"
  ) sup ON sup."itemId" = p."id"
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
    sup."incomingSupply";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 5. get_purchasing_planning: demandProjection arm nets consumption.
-- Forked from 20260831190142_purchasing-planning-reads-demand-projections.sql
-- ============================================================
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);
CREATE OR REPLACE FUNCTION get_purchasing_planning(company_id TEXT, location_id TEXT, periods TEXT[])
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
    "suppliers" jsonb,
    "preferredSupplierId" TEXT,
    "purchasingUnitOfMeasureCode" TEXT,
    "conversionFactor" NUMERIC,
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
  WITH RECURSIVE
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
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (consumedQuantity), so only
      -- the unconsumed remainder still drives demand here. Without this arm a
      -- purchased item whose only demand is a projection never appears in
      -- purchasing planning and never drives a suggested order.
      SELECT "itemId", "periodId", NULL as "actualQuantity",
             GREATEST("forecastQuantity" - "consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
    ) combined
    GROUP BY "itemId", "periodId"
  ),
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
      COALESCE((
        SELECT SUM("quantity")
        FROM "itemLedger"
        WHERE "companyId" = company_id
          AND "locationId" = location_id
          AND "itemId" = i."id"
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
            'unitPrice', ps."unitPrice",
            'supplierId', ps."supplierId",
            'supplierPartId', ps."supplierPartId"
          )
        ) AS "suppliers"
      FROM "supplierPart" ps
      WHERE ps."companyId" = company_id
        AND ps.active = true
      GROUP BY ps."itemId"
    ) ps ON ps."itemId" = i."id"
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
        )
        OR (
          ip."reorderPoint" > 0
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
    LEFT JOIN supply_data s ON bi."id" = s."itemId" AND s."periodId" = periods[1]
    LEFT JOIN demand_data d ON bi."id" = d."itemId" AND d."periodId" = periods[1]

    UNION ALL

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
    LEFT JOIN supply_data s ON p."id" = s."itemId" AND s."periodId" = periods[p.period_index + 1]
    LEFT JOIN demand_data d ON p."id" = d."itemId" AND d."periodId" = periods[p.period_index + 1]
    WHERE p.period_index < array_length(periods, 1)
  ),
  order_quantities AS (
    SELECT
      p."id",
      calculate_quantity_to_order(
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
      ) AS "quantityToOrder"
    FROM projections p
    GROUP BY
      p."id",
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
      WHEN ss."supersessionMode" = 'Stock Only'
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
  LEFT JOIN order_quantities oq ON p."id" = oq."id"
  LEFT JOIN "itemSupersession" ss ON ss."itemId" = p."id"
  LEFT JOIN "itemPlanning" rsv ON rsv."itemId" = p."id" AND rsv."locationId" = location_id
  LEFT JOIN (
    SELECT "itemId", SUM("supply") AS "incomingSupply"
    FROM supply_data GROUP BY "itemId"
  ) sup ON sup."itemId" = p."id"
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
    sup."incomingSupply";
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 6. get_inventory_quantities: ADD the net-projection arm to its demand CTE
--    (projections were previously omitted from inventory demand entirely).
-- Forked from 20260716142907_restore-inventory-quantities-tags.sql
-- ============================================================
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
    "storageUnitIds" TEXT[],
    "tags" TEXT[]
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
      UNION ALL
      -- Planner-entered projections, net of forecast consumption. Previously
      -- omitted entirely, so a top-level item whose only demand was a
      -- projection showed zero forecast demand on the Inventory screen.
      SELECT dp."itemId", GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0) AS qty
      FROM "demandProjection" dp
      WHERE dp."companyId" = company_id AND dp."locationId" = location_id
        AND (item_id IS NULL OR dp."itemId" = item_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
