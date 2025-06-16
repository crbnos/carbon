DROP FUNCTION IF EXISTS get_production_planning;
CREATE OR REPLACE FUNCTION get_production_planning(company_id TEXT, location_id TEXT, periods TEXT[])
  RETURNS TABLE (
    "id" TEXT,
    "readableId" TEXT,
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
    "safetyStockQuantity" INTEGER,
    "safetyStockLeadTime" INTEGER,
    "demandAccumulationPeriod" INTEGER,
    "demandAccumulationIncludesInventory" BOOLEAN,
    "reorderPoint" INTEGER,
    "reorderQuantity" INTEGER,
    "reorderMaximumInventory" INTEGER,
    "minimumOrderQuantity" INTEGER,
    "maximumOrderQuantity" INTEGER,
    "orderMultiple" INTEGER,
    "quantityOnHand" NUMERIC,
    "demandActuals" JSONB,
    "supplyActuals" JSONB,
    "demandForecasts" JSONB,
    "supplyForecasts" JSONB
  ) AS $$
  BEGIN
    RETURN QUERY
    
WITH
  demand_actuals_agg AS (
    SELECT
      "itemId",
      "periodId",
      SUM("actualQuantity") AS "quantity"
    FROM
      "demandActual" da
    WHERE
      da."companyId" = company_id
      AND da."locationId" = location_id
    GROUP BY da."itemId", da."periodId"
  ),
  demand_actuals AS (
    SELECT
      "itemId",
      COALESCE(
        json_agg(
          json_build_object(
            'periodId', "periodId",
            'quantity', "quantity"
          )
        ) FILTER (WHERE "periodId" IS NOT NULL),
        '[]'
      )::jsonb AS "demandActuals"
    FROM demand_actuals_agg
    GROUP BY "itemId"
  ),
  demand_forecasts_agg AS (
    SELECT
      "itemId",
      "periodId",
      SUM("forecastQuantity") AS "quantity"
    FROM
      "demandForecast" df
    WHERE df."companyId" = company_id AND df."locationId" = location_id
    GROUP BY df."itemId", df."periodId"
  ),
  demand_forecasts AS (
    SELECT
      "itemId",
      COALESCE(
        json_agg(
          json_build_object(
            'periodId', "periodId",
            'quantity', "quantity"
          )
        ) FILTER (WHERE "periodId" IS NOT NULL),
        '[]'
      )::jsonb AS "demandForecasts"
    FROM demand_forecasts_agg
    GROUP BY "itemId"
  ),
  supply_actuals_agg AS (
    SELECT
      "itemId",
      "periodId",
      SUM("actualQuantity") AS "quantity"
    FROM
      "supplyActual" sa
    WHERE
      sa."companyId" = company_id
      AND sa."locationId" = location_id
    GROUP BY sa."itemId", sa."periodId"
  ),
  supply_actuals AS (
    SELECT
      "itemId",
      COALESCE(
        json_agg(
          json_build_object(
            'periodId', "periodId",
            'quantity', "quantity"
          )
        ) FILTER (WHERE "periodId" IS NOT NULL),
        '[]'
      )::jsonb AS "supplyActuals"
    FROM supply_actuals_agg
    GROUP BY "itemId"
  ),
  supply_forecasts_agg AS (
    SELECT
      "itemId",
      "periodId",
      SUM("forecastQuantity") AS "quantity"
    FROM
      "supplyForecast" sf
    WHERE sf."companyId" = company_id AND sf."locationId" = location_id
    GROUP BY sf."itemId", sf."periodId"
  ),
  supply_forecasts AS (
    SELECT
      "itemId",
      COALESCE(
        json_agg(
          json_build_object(
            'periodId', "periodId",
            'quantity', "quantity"
          )
        ) FILTER (WHERE "periodId" IS NOT NULL),
        '[]'
      )::jsonb AS "supplyForecasts"
    FROM supply_forecasts_agg
    GROUP BY "itemId"
  ),
  item_ledgers AS (
    SELECT "itemId", SUM("quantity") AS "quantityOnHand"
    FROM "itemLedger"
    WHERE "companyId" = company_id
      AND "locationId" = location_id
    GROUP BY "itemId"
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
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  ir."leadTime",
  ir."manufacturingBlocked",
  ir."lotSize",
  ip."reorderingPolicy",
  ip."safetyStockQuantity",
  ip."safetyStockLeadTime",
  ip."demandAccumulationPeriod",
  ip."demandAccumulationIncludesInventory",
  ip."reorderPoint",
  ip."reorderQuantity",
  ip."reorderMaximumInventory",
  ip."minimumOrderQuantity",
  ip."maximumOrderQuantity",
  ip."orderMultiple",
  COALESCE(il."quantityOnHand", 0) AS "quantityOnHand",
  COALESCE(da."demandActuals", '[]'::jsonb) AS "demandActuals",
  COALESCE(sa."supplyActuals", '[]'::jsonb) AS "supplyActuals",
  COALESCE(df."demandForecasts", '[]'::jsonb) AS "demandForecasts",
  COALESCE(sf."supplyForecasts", '[]'::jsonb) AS "supplyForecasts"
FROM
  "item" i
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  INNER JOIN "itemPlanning" ip ON i."id" = ip."itemId"
  LEFT JOIN item_ledgers il ON i."id" = il."itemId"
  LEFT JOIN demand_actuals da ON i."id" = da."itemId"
  LEFT JOIN demand_forecasts df ON i."id" = df."itemId"
  LEFT JOIN supply_actuals sa ON i."id" = sa."itemId"
  LEFT JOIN supply_forecasts sf ON i."id" = sf."itemId"
  LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
WHERE i."companyId" = company_id
  AND i."replenishmentSystem" = 'Make'
  AND i."active" = TRUE;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
