-- ============================================================================
-- Function: get_picking_list_availability
-- Per picking line, the WAREHOUSE (non-lineside) on-hand of its item at the
-- list's location — used to drive the "No Stock" warning. Counts the
-- **unassigned/null bin** too (stock that has no storage unit is still real,
-- pickable on-hand), which is why the UI must key the warning off this number,
-- not off whether the line has a source storage unit.
--
-- A bin is "lineside" when it resolves to a work center via
-- get_effective_work_center_id; get_effective_work_center_id(NULL) is NULL, so
-- the unassigned bin counts as non-lineside (warehouse) here.
-- ============================================================================

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
    COALESCE((
      SELECT SUM(il."quantity")
      FROM "itemLedger" il
      WHERE il."itemId" = pll."itemId"
        AND il."companyId" = pl."companyId"
        AND il."locationId" = pl."locationId"
        AND get_effective_work_center_id(il."storageUnitId") IS NULL
    ), 0) AS "availableQuantity"
  FROM "pickingListLine" pll
  JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
  WHERE pll."pickingListId" = p_picking_list_id;
$$;
