-- ============================================================================
-- Function: get_available_tracked_entities (sort-method aware)
-- Adds p_sort_method so the single-item availability picker can honor the
-- item's configured pickMethod.sortMethod, matching what a real picking list
-- would allocate. Previously the ordering was fixed FEFO→FIFO.
--
-- p_sort_method — 'Default' | 'FEFO' | 'FIFO' | 'LIFO' (pickMethodSortMethod).
--   Default/FEFO → expirationDate ASC NULLS LAST, then createdAt ASC
--   FIFO         → createdAt ASC
--   LIFO         → createdAt DESC
-- Mirrors the ORDER BY in get_picking_list_tracked_available (20260617142853).
--
-- All other behavior (bin on-hand, lineside exclusion, allocation netting,
-- one row per entity at its highest-on-hand bin) is unchanged from
-- 20260614171204_available-tracked-entities.sql.
--
-- Drop the old 6-arg signature first: adding a defaulted 7th param would
-- otherwise register a distinct overload and leave the old function callable
-- (ambiguous). We want a clean single definition.
-- ============================================================================

DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION get_available_tracked_entities(
  p_item_id TEXT,
  p_company_id TEXT,
  p_location_id TEXT,
  p_exclude_lineside BOOLEAN DEFAULT false,
  p_exclude_allocated BOOLEAN DEFAULT false,
  p_exclude_line_id TEXT DEFAULT NULL,
  p_sort_method TEXT DEFAULT 'Default'
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
