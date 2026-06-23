-- ============================================================================
-- Function: get_picking_list_tracked_available
-- Available (status 'Available') tracked entities for EVERY distinct item on a
-- picking list, at the list's location/company — one row per entity, with the
-- representative bin (most on-hand within scope) and the order keys for smart
-- pick guidance. The batched analogue of get_available_tracked_entities, used to
-- precompute the "recommended" serial/batch numbers shown on each picking line
-- before the TrackedEntityPicker is opened.
--
-- Always nets out ALL non-cancelled allocations (a lot already allocated to any
-- line is not free) and always drops lineside (work-center) bins — picking
-- always sources from the warehouse. Rows are grouped + ordered per item by that
-- item's configured pickMethod.sortMethod so the caller can greedily assign
-- entities to lines in pick order:
--   Default/FEFO -> expiringDate ASC (nulls last), then createdAt ASC
--   FIFO         -> createdAt ASC
--   LIFO         -> createdAt DESC
-- ============================================================================

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
