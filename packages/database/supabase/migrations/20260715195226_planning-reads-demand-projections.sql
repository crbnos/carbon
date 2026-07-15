-- Production planning must see manually projected demand. The RPC's
-- demand_data union previously read only demandActual + demandForecast; MRP
-- writes only BOM-DERIVED (child) demand to demandForecast, so a top-level
-- Make item whose only demand is a demandProjection row was invisible in
-- production planning (could not create jobs from projections).
-- Function body otherwise identical to 20260618171234_material-supersession.sql.

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
      -- Top-level manual projections. MRP explodes these into child demand
      -- (demandForecast) but the projected item's OWN demand lives only here —
      -- without this arm a make item whose only demand is a projection never
      -- appears in production planning to create jobs.
      SELECT "itemId", "periodId", NULL as "actualQuantity", "forecastQuantity"
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
