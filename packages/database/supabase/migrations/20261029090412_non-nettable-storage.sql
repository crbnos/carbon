-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- Non-nettable storage.
--
-- Stock in a non-nettable storage unit (a quarantine area, an MRB cage) is not
-- supply: MRP and the planning screens ignore it, and picking never sources
-- from it. It is still on hand, still valued, and can still be moved out with
-- a stock transfer, which is how it is released.
--
-- A unit is non-nettable when its own "nettable" is false, when any of its
-- storage types has "nettable" false, or when its parent is non-nettable.
-- That result is stored in storageUnit."effectiveNettable" and kept current by
-- the storageUnit and storageType interceptors (sync_storage_unit_nettable,
-- sync_storage_type_nettable), which call util.refresh_storage_unit_nettable.
-- Storing it, instead of walking the tree on every read like the lineside
-- test does, lets the ledger handler and the planning reads use a plain join.
--
-- itemStockQuantities gains "quantityNonNettable", the part of
-- "quantityOnHand" in non-nettable units. Planning reads
-- "quantityOnHand" - "quantityNonNettable". It is stored as the non-nettable
-- part, not the nettable part, so a backup taken before this column existed
-- restores as "nothing is non-nettable", which was true when it was taken.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE "storageType"
  ADD COLUMN IF NOT EXISTS "nettable" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "nettable" BOOLEAN NOT NULL DEFAULT TRUE,
  -- Derived. Written only by util.refresh_storage_unit_nettable.
  ADD COLUMN IF NOT EXISTS "effectiveNettable" BOOLEAN NOT NULL DEFAULT TRUE;

-- Every unit is nettable today, so every row's non-nettable part is 0.
ALTER TABLE "itemStockQuantities"
  ADD COLUMN IF NOT EXISTS "quantityNonNettable" NUMERIC NOT NULL DEFAULT 0;

-- A unit's ledger rows: read when its flag flips, and released when a
-- non-nettable unit is deleted.
CREATE INDEX IF NOT EXISTS "itemLedger_storageUnitId_idx"
  ON "itemLedger" ("storageUnitId")
  INCLUDE ("itemId", "companyId", "locationId", "quantity", "trackedEntityStatus")
  WHERE "storageUnitId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Resolving effectiveNettable
--
-- Recomputes every unit of the given locations top-down from the roots, so a
-- parent's result reaches all of its children in one pass. A location holds
-- at most a few thousand units, and the flags change rarely.
--
-- For the items with stock in a unit whose result changed, quantityNonNettable
-- is then recomputed from the ledger, not adjusted by a delta: whatever the
-- stored value was (a ledger write that raced an earlier flip, an
-- effectiveNettable written directly, a restore), it is right afterwards.
-- quantityOnHand is not touched, so a concurrent ledger write can at worst
-- leave quantityNonNettable stale until the nightly
-- reconcile_item_stock_quantities.
--
-- The function's own writes to storageUnit set app.storage_unit_nettable_refresh,
-- which tells sync_storage_unit_nettable not to refresh again for them.
--
-- In util, which the API cannot reach: the interceptors run it as the owner.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION util.refresh_storage_unit_nettable(p_location_ids TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_flipped TEXT[];
BEGIN
  IF p_location_ids IS NULL OR cardinality(p_location_ids) = 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.storage_unit_nettable_refresh', 'on', true);

  WITH RECURSIVE resolved AS (
    SELECT
      su."id",
      su."nettable" AND NOT EXISTS (
        SELECT 1 FROM "storageType" st
        WHERE st."id" = ANY (su."storageTypeIds")
          AND st."nettable" = false
      ) AS "nettable"
    FROM "storageUnit" su
    WHERE su."locationId" = ANY (p_location_ids)
      AND su."parentId" IS NULL

    UNION ALL

    SELECT
      child."id",
      r."nettable" AND child."nettable" AND NOT EXISTS (
        SELECT 1 FROM "storageType" st
        WHERE st."id" = ANY (child."storageTypeIds")
          AND st."nettable" = false
      )
    FROM "storageUnit" child
    JOIN resolved r ON child."parentId" = r."id"
  ),
  flipped AS (
    UPDATE "storageUnit" su
    SET "effectiveNettable" = r."nettable"
    FROM resolved r
    WHERE su."id" = r."id"
      AND su."effectiveNettable" IS DISTINCT FROM r."nettable"
    RETURNING su."id"
  )
  SELECT array_agg("id") INTO v_flipped FROM flipped;

  PERFORM set_config('app.storage_unit_nettable_refresh', '', true);

  IF v_flipped IS NULL THEN
    RETURN;
  END IF;

  UPDATE "itemStockQuantities" isq
  SET "quantityNonNettable" = t."quantityNonNettable"
  FROM (
    SELECT
      il."itemId",
      il."companyId",
      COALESCE(il."locationId", '') AS "locationId",
      COALESCE(SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus"))
        FILTER (WHERE su."effectiveNettable" = false), 0) AS "quantityNonNettable"
    FROM "itemLedger" il
    LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId"
    WHERE il."locationId" = ANY (p_location_ids)
      AND (il."itemId", il."locationId") IN (
        SELECT DISTINCT moved."itemId", moved."locationId"
        FROM "itemLedger" moved
        WHERE moved."storageUnitId" = ANY (v_flipped)
      )
    GROUP BY il."itemId", il."companyId", COALESCE(il."locationId", '')
  ) t
  WHERE isq."itemId" = t."itemId"
    AND isq."companyId" = t."companyId"
    AND isq."locationId" = t."locationId"
    AND isq."quantityNonNettable" IS DISTINCT FROM t."quantityNonNettable";
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Picking sources
--
-- A pick source is a warehouse unit: not lineside and nettable. Stock in no
-- unit is both. Takes many ids at once so the picking list generator makes
-- one call per item instead of one per unit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION storage_unit_is_nettable(p_storage_unit_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT p_storage_unit_id IS NULL OR COALESCE((
    SELECT su."effectiveNettable"
    FROM "storageUnit" su
    WHERE su."id" = p_storage_unit_id
  ), true);
$$;

CREATE OR REPLACE FUNCTION get_warehouse_storage_unit_ids(p_storage_unit_ids TEXT[])
RETURNS TABLE ("storageUnitId" TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT su."id"
  FROM "storageUnit" su
  WHERE su."id" = ANY (p_storage_unit_ids)
    AND su."effectiveNettable"
    AND get_effective_work_center_id(su."id") IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 4. Nightly reconciliation of both columns
--
-- Forked from 20260812002454_item-stock-quantities-incremental.sql
-- (SECURITY INVOKER since 20260925121735_rpc-function-guards.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reconcile_item_stock_quantities()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The triggers apply RELATIVE deltas, which is safe under concurrency. This
  -- function writes an ABSOLUTE recompute, which is not: at READ COMMITTED a
  -- ledger write committing between this statement's snapshot and its row lock
  -- would have its delta overwritten — the drift repair would itself create
  -- drift. Hold a SHARE lock so no ledger write can interleave. SHARE conflicts
  -- with ROW EXCLUSIVE (INSERT/UPDATE/DELETE) but not with other readers, and
  -- this runs once nightly.
  LOCK TABLE "itemLedger" IN SHARE MODE;

  INSERT INTO "itemStockQuantities" AS isq
    ("itemId", "companyId", "locationId", "quantityOnHand", "quantityNonNettable")
  SELECT
    il."itemId",
    il."companyId",
    COALESCE(il."locationId", ''),
    COALESCE(SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus")), 0),
    COALESCE(SUM(item_ledger_on_hand_contribution(il."quantity", il."trackedEntityStatus"))
      FILTER (WHERE su."effectiveNettable" = false), 0)
  FROM "itemLedger" il
  LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId"
  GROUP BY il."itemId", il."companyId", COALESCE(il."locationId", '')
  ORDER BY 1, 2, 3
  ON CONFLICT ("itemId", "companyId", "locationId")
  DO UPDATE SET
    "quantityOnHand" = EXCLUDED."quantityOnHand",
    "quantityNonNettable" = EXCLUDED."quantityNonNettable"
  WHERE isq."quantityOnHand" IS DISTINCT FROM EXCLUDED."quantityOnHand"
     OR isq."quantityNonNettable" IS DISTINCT FROM EXCLUDED."quantityNonNettable";

  DELETE FROM "itemStockQuantities" isq
  WHERE NOT EXISTS (
    SELECT 1
    FROM "itemLedger" il
    WHERE il."itemId" = isq."itemId"
      AND il."companyId" = isq."companyId"
      AND COALESCE(il."locationId", '') = isq."locationId"
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. Planning RPCs read nettable on-hand
--
-- On-hand is the nettable aggregate runMrp reads: Rejected lots and stock in
-- non-nettable units are not supply. Forked from
-- 20261013004600_planning-rpcs-include-open-supply.sql; only the on-hand
-- subquery changes. The grid wrappers (20261006205037) select from them.
-- ---------------------------------------------------------------------------

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
      -- Nettable on-hand: the figure runMrp reads. Rejected lots and stock
      -- in non-nettable storage units are not supply.
      COALESCE((
        SELECT isq."quantityOnHand" - isq."quantityNonNettable"
        FROM "itemStockQuantities" isq
        WHERE isq."companyId" = company_id
          AND isq."locationId" = location_id
          AND isq."itemId" = i."id"
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
        OR EXISTS (
          SELECT 1 FROM supply_data s
          WHERE s."itemId" = i."id" AND s."supply" > 0
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

CREATE OR REPLACE FUNCTION public.get_purchasing_planning(company_id text, location_id text, periods text[])
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
      -- Nettable on-hand: the figure runMrp reads. Rejected lots and stock
      -- in non-nettable storage units are not supply.
      COALESCE((
        SELECT isq."quantityOnHand" - isq."quantityNonNettable"
        FROM "itemStockQuantities" isq
        WHERE isq."companyId" = company_id
          AND isq."locationId" = location_id
          AND isq."itemId" = i."id"
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

-- ---------------------------------------------------------------------------
-- 6. Job materials on-hand (the job materials page and its Order Status)
--
-- Forked from 20260925121735_rpc-function-guards.sql; only item_ledgers
-- changes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_job_quantity_on_hand(job_id text, company_id text, location_id text)
 RETURNS TABLE(id text, "jobMaterialItemId" text, "jobMakeMethodId" text, "itemReadableId" text, name text, description text, "itemTrackingType" "itemTrackingType", "methodType" "methodType", type "itemType", "thumbnailPath" text, "unitOfMeasureCode" text, "quantityPerParent" numeric, "estimatedQuantity" numeric, "quantityIssued" numeric, "quantityOnHandInStorageUnit" numeric, "quantityOnHandNotInStorageUnit" numeric, "quantityOnSalesOrder" numeric, "quantityOnPurchaseOrder" numeric, "quantityOnProductionOrder" numeric, "quantityFromProductionOrderInStorageUnit" numeric, "quantityFromProductionOrderNotInStorageUnit" numeric, "quantityInTransitToStorageUnit" numeric, "storageUnitId" text, "storageUnitName" text, "itemScrapPercentage" numeric, "substitutedFromItemId" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  BEGIN
  PERFORM assert_company_access(company_id);

    RETURN QUERY

WITH
  job_materials AS (
    SELECT
      jm."id",
      jm."itemId",
      jm."jobMakeMethodId",
      jm."description",
      jm."methodType",
      jm."quantity",
      jm."estimatedQuantity",
      jm."quantityIssued",
      jm."storageUnitId",
      jm."itemScrapPercentage",
      jm."substitutedFromItemId"
    FROM
      "jobMaterial" jm
    WHERE
      jm."jobId" = job_id
      -- SECURITY DEFINER bypasses RLS, so the caller's company must be checked
      -- here: without it a valid job id from another tenant returns its rows.
      AND jm."companyId" = company_id
  ),
  -- Distinct item / item+unit sets used to FILTER the aggregate CTEs below.
  -- Joining the raw job_materials rows fans out (multiplies) the aggregates when
  -- an item is on more than one BoM line — these dedupe so each item is counted
  -- once.
  job_material_items AS (
    SELECT DISTINCT jm."itemId" FROM job_materials jm
  ),
  job_material_item_units AS (
    SELECT DISTINCT jm."itemId", jm."storageUnitId" FROM job_materials jm
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      SUM(pol."quantityToReceive" * COALESCE(pol."conversionFactor", 1)) AS "quantityOnPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
      INNER JOIN job_material_items jm
        ON jm."itemId" = pol."itemId"
    WHERE
      po."status" IN (
        'Planned',
        'Needs Approval',
        'To Review',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
      AND pol."receivedComplete" = false
    GROUP BY pol."itemId"
  ),
  open_stock_transfers_to AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferTo"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_stock_transfers_from AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnStockTransferFrom"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    INNER JOIN job_material_items jm ON jm."itemId" = stl."itemId"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  stock_transfers_in_transit AS (
    SELECT
      COALESCE(stt."itemId", stf."itemId") AS "itemId",
      COALESCE(stt."storageUnitId", stf."storageUnitId") AS "storageUnitId",
      COALESCE(stt."quantityOnStockTransferTo", 0) - COALESCE(stf."quantityOnStockTransferFrom", 0) AS "quantityInTransit"
    FROM open_stock_transfers_to stt
    FULL OUTER JOIN open_stock_transfers_from stf ON stt."itemId" = stf."itemId" AND stt."storageUnitId" = stf."storageUnitId"
  ),
  open_sales_orders AS (
    SELECT
      sol."itemId" AS "salesOrderItemId",
      SUM(sol."quantityToSend") AS "quantityOnSalesOrder"
    FROM
      "salesOrder" so
      INNER JOIN "salesOrderLine" sol
        ON sol."salesOrderId" = so."id"
      INNER JOIN job_material_items jm
        ON jm."itemId" = sol."itemId"
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
    GROUP BY sol."itemId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
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
    GROUP BY j."itemId"
  ),
  open_job_requirements AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemand"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    INNER JOIN job_material_items jmat
      ON jmat."itemId" = jm."itemId"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = ojr."itemId" AND jm."storageUnitId" = ojr."storageUnitId"
    GROUP BY ojr."itemId"
  ),
  open_job_requirements_not_in_storage_unit AS (
    SELECT
      ojr."itemId",
      SUM(ojr."quantityOnProductionDemand") AS "quantityOnProductionDemandNotInStorageUnit"
    FROM open_job_requirements ojr
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = ojr."itemId" AND (jm."storageUnitId" IS NULL OR ojr."storageUnitId" IS NULL OR jm."storageUnitId" != ojr."storageUnitId")
    GROUP BY ojr."itemId"
  ),
  item_ledgers AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      -- quantityOnHand excludes only Rejected tracked entities. On Hold
      -- units are still physically in the warehouse and count toward
      -- on-hand. Rows with no tracked entity always count.
      SUM(il."quantity") FILTER (
        WHERE il."trackedEntityStatus" IS NULL
           OR il."trackedEntityStatus" != 'Rejected'
      ) AS "quantityOnHand"
    FROM "itemLedger" il
    INNER JOIN job_material_items jm
      ON jm."itemId" = il."itemId"
    LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId"
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      -- Stock in a non-nettable storage unit cannot supply the job.
      AND COALESCE(su."effectiveNettable", true)
    GROUP BY il."itemId", il."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = il."ledgerItemId" AND jm."storageUnitId" = il."storageUnitId"
    GROUP BY il."ledgerItemId"
  ),
  item_ledgers_not_in_storage_unit AS (
    SELECT
      il."ledgerItemId",
      SUM(il."quantityOnHand") AS "quantityOnHandNotInStorageUnit"
    FROM item_ledgers il
    INNER JOIN job_material_item_units jm
      ON jm."itemId" = il."ledgerItemId" AND (jm."storageUnitId" IS NULL OR il."storageUnitId" IS NULL OR jm."storageUnitId" != il."storageUnitId")
    GROUP BY il."ledgerItemId"
  )

SELECT
  jm."id",
  jm."itemId" AS "jobMaterialItemId",
  jm."jobMakeMethodId",
  i."readableId" AS "itemReadableId",
  i."name",
  jm."description",
  i."itemTrackingType",
  jm."methodType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  jm."quantity" as "quantityPerParent",
  jm."estimatedQuantity",
  jm."quantityIssued",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ilns."quantityOnHandNotInStorageUnit", 0) AS "quantityOnHandNotInStorageUnit",
  COALESCE(so."quantityOnSalesOrder", 0) AS "quantityOnSalesOrder",
  COALESCE(po."quantityOnPurchaseOrder", 0) AS "quantityOnPurchaseOrder",
  COALESCE(oj."quantityOnProductionOrder", 0) AS "quantityOnProductionOrder",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) AS "quantityFromProductionOrderInStorageUnit",
  COALESCE(ojns."quantityOnProductionDemandNotInStorageUnit", 0) AS "quantityFromProductionOrderNotInStorageUnit",
  COALESCE(stit."quantityInTransit", 0) AS "quantityInTransitToStorageUnit",
  jm."storageUnitId",
  s."name" AS "storageUnitName",
  jm."itemScrapPercentage",
  jm."substitutedFromItemId"
FROM
  job_materials jm
  INNER JOIN "item" i ON i."id" = jm."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = jm."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId"
  LEFT JOIN item_ledgers_not_in_storage_unit ilns ON i."id" = ilns."ledgerItemId"
  LEFT JOIN open_sales_orders so ON i."id" = so."salesOrderItemId"
  LEFT JOIN open_purchase_orders po ON i."id" = po."purchaseOrderItemId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId"
  LEFT JOIN open_job_requirements_not_in_storage_unit ojns ON i."id" = ojns."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN stock_transfers_in_transit stit ON jm."itemId" = stit."itemId" AND jm."storageUnitId" = stit."storageUnitId";
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Picking never sources from a non-nettable unit
--
-- Each warehouse-stock test (not lineside) also requires a nettable unit.
-- get_picking_schedule forked from
-- 20260908211552_picking-supersession-consume-first.sql,
-- get_picking_list_availability from 20260730143512_picking-supersession.sql,
-- get_picking_list_tracked_available from
-- 20260617142853_picking-list-tracked-available.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_picking_schedule(
  p_location_id TEXT,
  p_company_id TEXT,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  "jobOperationId" TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "jobReadableId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "operationDescription" TEXT,
  "processName" TEXT,
  "workCenterId" TEXT,
  "workCenterName" TEXT,
  "operationStatus" "jobOperationStatus",
  "deadlineType" "deadlineType",
  "dueDate" DATE,
  "customerId" TEXT,
  "customerName" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "salesOrderReadableId" TEXT,
  "thumbnailPath" TEXT,
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "tags" TEXT[],
  "partsToPickCount" BIGINT,
  "totalQuantityToPick" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  picks AS (
    SELECT
      jo2."id" AS "jobOperationId",
      COUNT(*) AS "partsToPickCount",
      SUM(jm."quantityToIssue") AS "totalQuantityToPick"
    FROM "jobMaterial" jm
    LEFT JOIN LATERAL (
      SELECT fo."id"
      FROM "jobOperation" fo
      WHERE jm."jobOperationId" IS NULL
        AND fo."jobMakeMethodId" = jm."jobMakeMethodId"
        AND fo."companyId" = p_company_id
        AND fo."status" NOT IN ('Done', 'Canceled')
      ORDER BY fo."order" ASC, fo."id" ASC
      LIMIT 1
    ) first_op ON true
    JOIN "jobOperation" jo2
      ON jo2."id" = COALESCE(jm."jobOperationId", first_op."id")
    LEFT JOIN LATERAL (
      SELECT s.*
      FROM "itemSupersession" s
      WHERE s."companyId" = p_company_id
        AND s."itemId" IN (jm."substitutedFromItemId", jm."itemId")
      ORDER BY
        (s."itemId" = jm."itemId"
          AND s."successorItemId" = jm."substitutedFromItemId") IS TRUE DESC,
        (s."itemId" = jm."substitutedFromItemId") IS TRUE DESC
      LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" IS NULL THEN NULL
          WHEN ss."itemId" = jm."substitutedFromItemId" THEN jm."itemId"
          WHEN ss."successorItemId" IS NOT NULL
            AND (ss."successorEffectivityDate" IS NULL
                 OR ss."successorEffectivityDate" <= (now() AT TIME ZONE 'UTC')::date)
          THEN ss."successorItemId"
          ELSE NULL
        END AS "successorItemId"
    ) res ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."quantity" / jm."substitutionFactor"
          ELSE jm."quantity"
        END AS "perAssemblyOld"
    ) per ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."supersessionMode" = 'Consume First' THEN
            COALESCE((
              SELECT SUM(bin.qty)
              FROM (
                SELECT SUM(il."quantity") AS qty
                FROM "itemLedger" il
                WHERE il."itemId" = ss."itemId"
                  AND il."companyId" = p_company_id
                  AND il."locationId" = p_location_id
                  AND get_effective_work_center_id(il."storageUnitId") IS NULL
                  AND storage_unit_is_nettable(il."storageUnitId")
                GROUP BY il."storageUnitId"
                HAVING SUM(il."quantity") > 0
              ) bin
            ), 0) >= GREATEST(COALESCE(per."perAssemblyOld", 0), 0)
            AND COALESCE((
              SELECT SUM(bin.qty)
              FROM (
                SELECT SUM(il."quantity") AS qty
                FROM "itemLedger" il
                WHERE il."itemId" = ss."itemId"
                  AND il."companyId" = p_company_id
                  AND il."locationId" = p_location_id
                  AND get_effective_work_center_id(il."storageUnitId") IS NULL
                  AND storage_unit_is_nettable(il."storageUnitId")
                GROUP BY il."storageUnitId"
                HAVING SUM(il."quantity") > 0
              ) bin
            ), 0) > 0
          ELSE EXISTS (
            SELECT 1 FROM "itemLedger" il
            WHERE il."itemId" = ss."itemId"
              AND il."companyId" = p_company_id
              AND il."locationId" = p_location_id
              AND get_effective_work_center_id(il."storageUnitId") IS NULL
              AND storage_unit_is_nettable(il."storageUnitId")
            GROUP BY il."storageUnitId"
            HAVING SUM(il."quantity") > 0
          )
        END AS "predecessorInStock",
        EXISTS (
          SELECT 1 FROM "itemLedger" il
          WHERE il."itemId" = res."successorItemId"
            AND il."companyId" = p_company_id
            AND il."locationId" = p_location_id
            AND get_effective_work_center_id(il."storageUnitId") IS NULL
            AND storage_unit_is_nettable(il."storageUnitId")
          GROUP BY il."storageUnitId"
          HAVING SUM(il."quantity") > 0
        ) AS "successorInStock"
      WHERE ss."supersessionMode" IN ('Consume First', 'Prefer New')
        AND res."successorItemId" IS NOT NULL
    ) stk ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" IS NULL THEN jm."itemId"
          WHEN ss."itemId" = jm."substitutedFromItemId" THEN
            CASE
              WHEN ss."supersessionMode" = 'Consume First'
                AND COALESCE(stk."predecessorInStock", true)
              THEN jm."substitutedFromItemId"
              WHEN ss."supersessionMode" = 'Prefer New'
                AND NOT COALESCE(stk."successorInStock", true)
                AND COALESCE(stk."predecessorInStock", true)
              THEN jm."substitutedFromItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Consume First' THEN
            CASE
              WHEN res."successorItemId" IS NOT NULL
                AND NOT COALESCE(stk."predecessorInStock", true)
                AND COALESCE(stk."successorInStock", true)
              THEN res."successorItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Prefer New' THEN
            CASE
              WHEN res."successorItemId" IS NOT NULL
                AND (COALESCE(stk."successorInStock", true)
                     OR NOT COALESCE(stk."predecessorInStock", true))
              THEN res."successorItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Stock Only' THEN res."successorItemId"
          WHEN ss."supersessionMode" = 'No Stock' THEN NULL
          ELSE jm."itemId"
        END AS "pickItemId"
    ) pick ON true
    LEFT JOIN LATERAL (
      SELECT
        pick."pickItemId",
        CASE
          WHEN pick."pickItemId" IS NULL OR pick."pickItemId" = jm."itemId" THEN 1
          WHEN pick."pickItemId" = jm."substitutedFromItemId" THEN
            CASE
              WHEN COALESCE(jm."substitutionFactor", 0) > 0
              THEN 1 / jm."substitutionFactor"
              ELSE 1
            END
          ELSE COALESCE(ss."conversionFactor", 1)
        END AS "pickFactor"
    ) pit ON true
    LEFT JOIN LATERAL (
      SELECT su."id"
      FROM "storageUnit" su
      WHERE su."workCenterId" = jo2."workCenterId"
        AND su."companyId" = p_company_id
      ORDER BY su."isWorkCenterDefault" DESC, su."createdAt" ASC
      LIMIT 1
    ) wcl ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."quantityToIssue" / jm."substitutionFactor"
          ELSE jm."quantityToIssue"
        END AS need_old,
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."substitutionFactor"
          ELSE GREATEST(COALESCE(ss."conversionFactor", 1), 0)
        END AS new_per_old,
        CASE WHEN wcl."id" IS NULL THEN 0 ELSE get_lineside_credit(
          p_company_id, p_location_id, wcl."id", ss."itemId", jm."jobId", jm."id"
        ) END AS staged_old,
        CASE WHEN wcl."id" IS NULL OR res."successorItemId" IS NULL THEN 0 ELSE get_lineside_credit(
          p_company_id, p_location_id, wcl."id", res."successorItemId", jm."jobId", jm."id"
        ) END AS staged_new
    ) cf ON true
    WHERE jm."companyId" = p_company_id
      AND jm."quantityToIssue" > 0
      AND jm."methodType" != 'Make to Order'
      AND pit."pickItemId" IS NOT NULL
      AND (
        wcl."id" IS NULL
        OR CASE
          WHEN ss."supersessionMode" = 'Consume First'
            AND res."successorItemId" IS NOT NULL
            AND COALESCE(per."perAssemblyOld", 0) > 0
            AND cf.new_per_old > 0
          THEN
            floor(GREATEST(cf.staged_old, 0) / per."perAssemblyOld") * per."perAssemblyOld"
            + floor(GREATEST(cf.staged_new, 0) / (per."perAssemblyOld" * cf.new_per_old)) * per."perAssemblyOld"
            < cf.need_old
          ELSE get_lineside_credit(
            p_company_id, p_location_id, wcl."id", pit."pickItemId", jm."jobId", jm."id"
          ) < jm."quantityToIssue" * pit."pickFactor"
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM "pickingListLine" pll
        JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
        WHERE pll."jobOperationId" = jo2."id"
          AND pll."status" <> 'Cancelled'
          AND pl."status" IN ('Draft', 'In Progress', 'Partial')
      )
    GROUP BY jo2."id"
  )
  SELECT
    jo."id" AS "jobOperationId",
    j."id" AS "jobId",
    jo."jobMakeMethodId",
    j."jobId" AS "jobReadableId",
    i."id" AS "itemId",
    i."readableId" AS "itemReadableId",
    i."name" AS "itemDescription",
    jo."order" AS "operationOrder",
    jo."description" AS "operationDescription",
    p."name" AS "processName",
    jo."workCenterId",
    wc."name" AS "workCenterName",
    CASE WHEN j."status" = 'Paused' THEN 'Paused'::"jobOperationStatus" ELSE jo."status" END AS "operationStatus",
    j."deadlineType",
    jo."dueDate",
    j."customerId",
    c."name" AS "customerName",
    j."salesOrderId",
    j."salesOrderLineId",
    so."salesOrderId" AS "salesOrderReadableId",
    COALESCE(mu."thumbnailPath", i."thumbnailPath") AS "thumbnailPath",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."tags",
    pk."partsToPickCount",
    pk."totalQuantityToPick"
  FROM picks pk
  JOIN "jobOperation" jo ON jo."id" = pk."jobOperationId"
  JOIN "job" j ON jo."jobId" = j."id"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm."id"
  LEFT JOIN "item" i ON jmm."itemId" = i."id"
  LEFT JOIN "process" p ON jo."processId" = p."id"
  LEFT JOIN "workCenter" wc ON jo."workCenterId" = wc."id"
  LEFT JOIN "customer" c ON j."customerId" = c."id"
  LEFT JOIN "salesOrder" so ON j."salesOrderId" = so."id"
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu."id"
  WHERE j."companyId" = p_company_id
    AND j."locationId" = p_location_id
    AND j."status" IN ('Ready', 'In Progress', 'Paused')
    AND jo."status" NOT IN ('Done', 'Canceled')
    AND (
      p_search IS NULL OR p_search = ''
      OR j."jobId" ILIKE '%' || p_search || '%'
      OR i."readableId" ILIKE '%' || p_search || '%'
      OR jo."description" ILIKE '%' || p_search || '%'
    )
  ORDER BY jo."dueDate" NULLS LAST, j."jobId";
$$;

CREATE OR REPLACE FUNCTION get_picking_list_availability(p_picking_list_id TEXT)
RETURNS TABLE (
  "pickingListLineId" TEXT,
  "availableQuantity" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    pll."id" AS "pickingListLineId",
    -- Warehouse (non-lineside) on-hand of the line's OWN pick item — exactly what
    -- this line consumes. A supersession redirect is already resolved at
    -- generation time (a substituted line's "itemId" is the effective successor),
    -- so availability reflects the real pick item without any fold-in.
    --
    -- We deliberately do NOT add a successor's on-hand to a line still targeting
    -- the predecessor: with no line-splitting, such a line consumes the
    -- PREDECESSOR, so folding in successor stock would (a) mask a genuine
    -- predecessor shortage (suppressing the "No Stock" warning while the line
    -- cannot actually be covered) and (b) double-count the successor's stock when
    -- the same list also carries a separate line for that successor item.
    COALESCE((
      SELECT SUM(il."quantity")
      FROM "itemLedger" il
      WHERE il."itemId" = pll."itemId"
        AND il."companyId" = pl."companyId"
        AND il."locationId" = pl."locationId"
        AND get_effective_work_center_id(il."storageUnitId") IS NULL
        AND storage_unit_is_nettable(il."storageUnitId")
    ), 0) AS "availableQuantity"
  FROM "pickingListLine" pll
  JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
  WHERE pll."pickingListId" = p_picking_list_id;
$$;

CREATE OR REPLACE FUNCTION get_picking_list_tracked_available(p_picking_list_id TEXT)
RETURNS TABLE (
  "itemId" TEXT,
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "expirationDate" DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH pl AS (
    SELECT "id", "companyId", "locationId"
    FROM "pickingList"
    WHERE "id" = p_picking_list_id
  ),
  list_items AS (
    SELECT DISTINCT pll."itemId"
    FROM "pickingListLine" pll
    WHERE pll."pickingListId" = p_picking_list_id
      AND pll."status" <> 'Cancelled'
  ),
  bin_onhand AS (
    SELECT
      il."itemId",
      il."trackedEntityId",
      il."storageUnitId",
      s."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    JOIN pl ON il."companyId" = pl."companyId" AND il."locationId" = pl."locationId"
    JOIN list_items li ON li."itemId" = il."itemId"
    LEFT JOIN "storageUnit" s ON s."id" = il."storageUnitId"
    WHERE il."trackedEntityId" IS NOT NULL
      AND get_effective_work_center_id(il."storageUnitId") IS NULL
      AND storage_unit_is_nettable(il."storageUnitId")
    GROUP BY il."itemId", il."trackedEntityId", il."storageUnitId", s."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "itemId", "trackedEntityId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "itemId", "trackedEntityId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId")
      "trackedEntityId", "storageUnitId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", on_hand DESC
  ),
  allocated AS (
    SELECT pllte."trackedEntityId", SUM(pllte."quantity") AS allocated_qty
    FROM "pickingListLineTrackedEntity" pllte
    JOIN "pickingListLine" pll ON pll."id" = pllte."pickingListLineId"
    JOIN "pickingList" pl2 ON pl2."id" = pll."pickingListId"
    WHERE pl2."status" <> 'Cancelled'
      AND pll."status" <> 'Cancelled'
    GROUP BY pllte."trackedEntityId"
  )
  SELECT
    et."itemId",
    et."trackedEntityId",
    te."readableId",
    pb."storageUnitId",
    pb.storage_unit_name AS "storageUnitName",
    et.total_on_hand - COALESCE(a.allocated_qty, 0) AS "availableQuantity",
    te."createdAt",
    te."expirationDate"
  FROM entity_total et
  JOIN "trackedEntity" te ON te."id" = et."trackedEntityId"
  JOIN primary_bin pb ON pb."trackedEntityId" = et."trackedEntityId"
  CROSS JOIN pl
  LEFT JOIN "pickMethod" pm
    ON pm."itemId" = et."itemId"
   AND pm."locationId" = pl."locationId"
   AND pm."companyId" = pl."companyId"
  LEFT JOIN allocated a ON a."trackedEntityId" = et."trackedEntityId"
  WHERE te."status" = 'Available'
    AND (et.total_on_hand - COALESCE(a.allocated_qty, 0)) > 0
  ORDER BY
    et."itemId",
    CASE
      WHEN COALESCE(pm."sortMethod", 'Default') IN ('Default', 'FEFO')
      THEN te."expirationDate"
    END ASC NULLS LAST,
    CASE
      WHEN COALESCE(pm."sortMethod", 'Default') = 'LIFO'
      THEN te."createdAt"
    END DESC,
    te."createdAt" ASC;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_available_tracked_entities: p_exclude_non_nettable
--
-- A separate switch from p_exclude_lineside: picking passes both, while a
-- stock transfer passes only p_exclude_lineside, because moving a lot out of
-- a non-nettable unit is how it is released.
--
-- Forked from 20261012153000_available-tracked-entities-storage-unit.sql. The
-- old 9-arg signature is dropped so the new defaulted parameter does not
-- register a second, ambiguous overload.
-- ---------------------------------------------------------------------------

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
  p_filter_storage_unit BOOLEAN DEFAULT false,
  p_storage_unit_id TEXT DEFAULT NULL,
  p_exclude_non_nettable BOOLEAN DEFAULT false
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  "availableQuantity" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "expirationDate" DATE,
  "status" TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH bin_onhand AS (
    SELECT
      il."trackedEntityId",
      il."storageUnitId",
      s."name" AS storage_unit_name,
      SUM(il."quantity") AS on_hand
    FROM "itemLedger" il
    LEFT JOIN "storageUnit" s ON s."id" = il."storageUnitId"
    WHERE il."itemId" = p_item_id
      AND il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."trackedEntityId" IS NOT NULL
      AND (
        NOT p_exclude_lineside
        OR get_effective_work_center_id(il."storageUnitId") IS NULL
      )
      AND (
        NOT p_exclude_non_nettable
        OR storage_unit_is_nettable(il."storageUnitId")
      )
      AND (
        NOT p_filter_storage_unit
        OR il."storageUnitId" IS NOT DISTINCT FROM p_storage_unit_id
      )
    GROUP BY il."trackedEntityId", il."storageUnitId", s."name"
    HAVING SUM(il."quantity") > 0
  ),
  entity_total AS (
    SELECT "trackedEntityId", SUM(on_hand) AS total_on_hand
    FROM bin_onhand
    GROUP BY "trackedEntityId"
  ),
  primary_bin AS (
    SELECT DISTINCT ON ("trackedEntityId")
      "trackedEntityId", "storageUnitId", storage_unit_name
    FROM bin_onhand
    ORDER BY "trackedEntityId", on_hand DESC
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
    te."status"
  FROM entity_total et
  JOIN "trackedEntity" te ON te."id" = et."trackedEntityId"
  JOIN primary_bin pb ON pb."trackedEntityId" = et."trackedEntityId"
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

-- ---------------------------------------------------------------------------
-- 9. storageUnits_recursive exposes effectiveNettable for the storage units
--    list. Forked from 20260417000200_storage-unit-nesting-and-type.sql; the
--    new column goes last so CREATE OR REPLACE keeps the existing ones.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW "storageUnits_recursive"
WITH (SECURITY_INVOKER = true) AS
WITH RECURSIVE t AS (
  SELECT
    "id",
    "parentId",
    "locationId",
    "warehouseId",
    "name",
    "active",
    "storageTypeIds",
    "companyId",
    1 AS "depth",
    ARRAY["id"] AS "ancestorPath",
    "effectiveNettable"
  FROM "storageUnit"
  WHERE "parentId" IS NULL

  UNION ALL

  SELECT
    s."id",
    s."parentId",
    s."locationId",
    s."warehouseId",
    s."name",
    s."active",
    s."storageTypeIds",
    s."companyId",
    t."depth" + 1,
    t."ancestorPath" || s."id",
    s."effectiveNettable"
  FROM "storageUnit" s
  JOIN t ON s."parentId" = t."id"
)
SELECT * FROM t;
