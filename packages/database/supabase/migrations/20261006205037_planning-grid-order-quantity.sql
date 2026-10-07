-- The planning grids' order quantity: what the row's Order / Make button
-- offers, from MRP's open new-supply actions inside the item's planning
-- horizon (the same fence the Actions filter and latestOrderDate use).
--
-- The grids sorted and showed the base RPC's "quantityToOrder", a second sizing
-- of the weekly projection in SQL (calculate_quantity_to_order). It does not
-- see what MRP does after sizing — Expedites, Increases folded into open
-- orders, orders already placed — so the Qty to Order column and the default
-- sort disagreed with the Order button: an item MRP had nothing to order for
-- sorted above items with real shortages. The base RPCs keep "quantityToOrder"
-- (generatePlanningActions reads it for Stock Only items).
--
-- Re-created rather than replaced: the return type gains a column.

DROP FUNCTION IF EXISTS get_purchasing_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT[]);
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

DROP FUNCTION IF EXISTS get_production_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT[]);
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
