-- ============================================================================
-- Function: get_available_tracked_entities
-- Lists available (status 'Available') tracked entities for an item at a
-- location, one row per entity, with the bin it sits in, on-hand quantity,
-- and the order keys for smart pick guidance (FEFO expirationDate, FIFO
-- createdAt). Used by the shared TrackedEntityPicker.
--
-- p_exclude_lineside  — drop entities sitting on a work center's lineside bin
--                       (picking sources from the warehouse, never the line).
-- p_exclude_allocated — subtract quantities already allocated to other picking
--                       list lines (non-cancelled), so the same lot is never
--                       recommended twice.
-- p_exclude_line_id   — when excluding allocations, ignore this picking list
--                       line's OWN allocation (so it still sees what it can pick).
--
-- One row per entity: the representative bin = the bin holding the most on-hand
-- within scope. (Serial = qty 1, single bin; batch usually single bin.)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_available_tracked_entities(
  p_item_id TEXT,
  p_company_id TEXT,
  p_location_id TEXT,
  p_exclude_lineside BOOLEAN DEFAULT false,
  p_exclude_allocated BOOLEAN DEFAULT false,
  p_exclude_line_id TEXT DEFAULT NULL
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
  ORDER BY te."expirationDate" ASC NULLS LAST, te."createdAt" ASC;
$$;
