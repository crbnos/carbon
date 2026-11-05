-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- Lets main's 2026-10-29 planning and non-nettable migrations apply on a
-- database that already has the projects branch, in either order.
--
-- The projects branch (20261021004800, 20261021004000, 20261021004200) changed
-- the return types of the planning and picking functions below. Main's
-- 20261029080733 builds get_purchasing_planning_grid on main's shape of
-- get_purchasing_planning (`p.*`), and main's 20261029090412 re-creates the
-- others with CREATE OR REPLACE, which cannot change a return type. On a fresh
-- database (branch migrations first, by timestamp) both failed.
--
-- So this migration drops the branch-shaped functions and puts
-- get_purchasing_planning back to its merge-base definition (20261013004600).
-- Main's migrations then apply as written, and
-- 20261102032700_merge-main-non-nettable-and-project-stripes re-creates every
-- one with both sides' behavior. On a database where main's migrations ran
-- first, this one runs later and is likewise superseded by 20261102032700.

DROP FUNCTION IF EXISTS get_production_planning(TEXT, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS get_picking_schedule(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_picking_list_availability(TEXT);
DROP FUNCTION IF EXISTS get_picking_list_tracked_available(TEXT);
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);

CREATE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
 RETURNS TABLE(id text, "readableIdWithRevision" text, name text, active boolean, type "itemType", "itemTrackingType" "itemTrackingType", "replenishmentSystem" "itemReplenishmentSystem", "thumbnailPath" text, "unitOfMeasureCode" text, "leadTime" integer, "purchasingBlocked" boolean, "lotSize" integer, "reorderingPolicy" "itemReorderingPolicy", "demandAccumulationPeriod" integer, "demandAccumulationSafetyStock" numeric, "reorderPoint" integer, "reorderQuantity" integer, "minimumOrderQuantity" integer, "maximumOrderQuantity" integer, "orderMultiple" integer, "quantityOnHand" numeric, "maximumInventoryQuantity" numeric, suppliers jsonb, "preferredSupplierId" text, "purchasingUnitOfMeasureCode" text, "conversionFactor" numeric, "quantityToOrder" numeric, "supersessionMode" text, "minimumReserveQuantity" numeric, week1 numeric, week2 numeric, week3 numeric, week4 numeric, week5 numeric, week6 numeric, week7 numeric, week8 numeric, week9 numeric, week10 numeric, week11 numeric, week12 numeric, week13 numeric, week14 numeric, week15 numeric, week16 numeric, week17 numeric, week18 numeric, week19 numeric, week20 numeric, week21 numeric, week22 numeric, week23 numeric, week24 numeric, week25 numeric, week26 numeric, week27 numeric, week28 numeric, week29 numeric, week30 numeric, week31 numeric, week32 numeric, week33 numeric, week34 numeric, week35 numeric, week36 numeric, week37 numeric, week38 numeric, week39 numeric, week40 numeric, week41 numeric, week42 numeric, week43 numeric, week44 numeric, week45 numeric, week46 numeric, week47 numeric, week48 numeric, week49 numeric, week50 numeric, week51 numeric, week52 numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT assert_company_access(company_id);
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
        OR EXISTS (
          SELECT 1 FROM supply_data s
          WHERE s."itemId" = i."id" AND s."supply" > 0
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
$function$;
