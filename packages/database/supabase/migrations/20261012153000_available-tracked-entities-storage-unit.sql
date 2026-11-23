-- ============================================================================
-- Function: get_available_tracked_entities (storage-unit aware)
-- Adds a source-bin filter so a picker can offer only the lots that sit in one
-- bin. A stock transfer line names the bin it moves stock out of; the picker
-- listed every lot at the location instead, so lots from other bins were
-- offered and picking one moved stock the line never asked for.
--
-- p_filter_storage_unit — true restricts to p_storage_unit_id; false (default)
--   keeps the location-wide behavior.
-- p_storage_unit_id     — the bin to restrict to. NULL is the unassigned bin
--   ("No storage unit"), a real source a line can name, which is why the
--   filter needs its own switch instead of treating NULL as "any bin".
--
-- All other behavior is unchanged from
-- 20260709125411_available-tracked-entities-sort-method.sql.
--
-- Drop the old 7-arg signature first so the defaulted new params do not
-- register a second, ambiguous overload.
-- ============================================================================

DROP FUNCTION IF EXISTS get_available_tracked_entities(
  TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT
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
  p_storage_unit_id TEXT DEFAULT NULL
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
