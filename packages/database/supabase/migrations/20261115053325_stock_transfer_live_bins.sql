-- Where the stock of each line of one stock transfer is now. A line's From
-- storage unit is the bin named when the transfer was made (a kanban's source
-- bin); the stock can be somewhere else by the time it is picked. Common stock
-- only, as a stock transfer moves: nettable warehouse bins and the line's own
-- From bin, never the bin the line moves it to.
CREATE OR REPLACE FUNCTION get_stock_transfer_live_bins(
  p_company_id TEXT,
  p_stock_transfer_id TEXT
)
RETURNS TABLE (
  "stockTransferLineId" TEXT,
  "storageUnitId" TEXT,
  "storageUnitName" TEXT,
  quantity NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH transfer AS (
    SELECT "id", "companyId", "locationId"
    FROM "stockTransfer"
    WHERE "id" = p_stock_transfer_id
      AND "companyId" = p_company_id
  ),
  lines AS (
    SELECT stl."id", stl."itemId", stl."fromStorageUnitId", stl."toStorageUnitId"
    FROM "stockTransferLine" stl
    JOIN transfer ON transfer."id" = stl."stockTransferId"
    WHERE stl."companyId" = p_company_id
  ),
  bins AS (
    SELECT
      il."itemId",
      il."storageUnitId",
      su."name" AS "storageUnitName",
      get_effective_work_center_id(il."storageUnitId") IS NULL
        AND storage_unit_is_nettable(il."storageUnitId") AS warehouse,
      SUM(il."quantity") AS quantity
    FROM "itemLedger" il
    JOIN transfer
      ON transfer."companyId" = il."companyId"
     AND transfer."locationId" = il."locationId"
    LEFT JOIN "storageUnit" su
      ON su."id" = il."storageUnitId"
     AND su."companyId" = il."companyId"
    LEFT JOIN "trackedEntity" te
      ON te."id" = il."trackedEntityId"
     AND te."companyId" = il."companyId"
    WHERE il."itemId" IN (SELECT "itemId" FROM lines)
      AND il."projectId" IS NULL
      AND (il."trackedEntityId" IS NULL OR te."status" = 'Available')
    GROUP BY il."itemId", il."storageUnitId", su."name"
    HAVING SUM(il."quantity") > 0
  )
  SELECT
    lines."id" AS "stockTransferLineId",
    bins."storageUnitId",
    bins."storageUnitName",
    bins.quantity
  FROM lines
  JOIN bins
    ON bins."itemId" = lines."itemId"
   AND bins."storageUnitId" IS DISTINCT FROM lines."toStorageUnitId"
   AND (
     bins.warehouse
     OR bins."storageUnitId" IS NOT DISTINCT FROM lines."fromStorageUnitId"
   )
  ORDER BY lines."id", bins.quantity DESC, bins."storageUnitName";
$$;
