-- Planning horizon (time fence) for MRP planning actions.
--
-- MRP keeps generating actions over the whole planning window; the horizon is a
-- READ-TIME lens: the planning grids surface only the actions (and suggested new
-- orders) that fall on or before today + horizon days. Empty or 0 = no fence;
-- an item's 0 also opts it out of the company default, which empty inherits.
--
-- Named planningHorizonDays on purpose: planningTimeFenceDays is reserved by the
-- MRP v2 spec for the auto-firm fence, which is a different concept.
--
-- The fence is compared against planningAction."horizonDate", defined with the
-- table in 20261005090300_mrp-planning-actions.sql.

-- 1. Per item + location horizon, with a company-wide default.
ALTER TABLE "itemPlanning"
  ADD COLUMN IF NOT EXISTS "planningHorizonDays" INTEGER
  CHECK ("planningHorizonDays" IS NULL OR "planningHorizonDays" >= 0);

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "defaultPlanningHorizonDays" INTEGER
  CHECK ("defaultPlanningHorizonDays" IS NULL OR "defaultPlanningHorizonDays" >= 0);

-- 2. Grid wrappers. The base RPCs stay the one definition of the projection
--    (generatePlanningActions reads them too); these add the columns only the
--    grids need and evaluate the Actions and Assignee filters in the
--    database, inside each item's fence, so the filter is complete at any volume
--    and paging stays correct.
--
--    SECURITY INVOKER: the base RPC asserts company access; everything joined
--    here runs under the caller's RLS.
--
--    `p.*` ties the column list below to the base RPC's. Adding a column to a
--    base RPC means re-creating its wrapper with the same column — the wrapper
--    fails loudly (return type mismatch) until then.

DROP FUNCTION IF EXISTS get_purchasing_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT);
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
    "latestOrderDate" DATE
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
    ) AS "latestOrderDate"
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
        AND (action_types IS NULL OR a."type"::TEXT = ANY(action_types))
        AND (action_assignees IS NULL OR a."assignee" = ANY(action_assignees))
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    );
$$;

DROP FUNCTION IF EXISTS get_production_planning_grid(TEXT, TEXT, TEXT[], DATE, TEXT[], TEXT);
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
    "latestOrderDate" DATE
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
    ) AS "latestOrderDate"
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
        AND (action_types IS NULL OR a."type"::TEXT = ANY(action_types))
        AND (action_assignees IS NULL OR a."assignee" = ANY(action_assignees))
        AND (
          h."days" IS NULL
          OR a."horizonDate" <= COALESCE(as_of, location_today(location_id, company_id)) + h."days"
        )
    );
$$;
