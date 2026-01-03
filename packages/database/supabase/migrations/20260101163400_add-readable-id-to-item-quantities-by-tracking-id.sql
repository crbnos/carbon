DROP FUNCTION IF EXISTS get_item_quantities_by_tracking_id;
CREATE OR REPLACE FUNCTION get_item_quantities_by_tracking_id (item_id TEXT, company_id TEXT, location_id TEXT) RETURNS TABLE (
  "itemId" TEXT,
  "shelfId" TEXT,
  "shelfName" TEXT,
  "trackedEntityId" TEXT,
  "readableId" TEXT,
  quantity NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    il."itemId",
    il."shelfId",
    s."name" AS "shelfName",
    il."trackedEntityId",
    te."readableId",
    SUM(il."quantity") AS "quantity"
  FROM
    "itemLedger" il
  LEFT JOIN
    "shelf" s ON il."shelfId" = s."id"
  LEFT JOIN
    "trackedEntity" te ON il."trackedEntityId" = te."id"
  WHERE
    il."itemId" = item_id
    AND il."companyId" = company_id
    AND il."locationId" = location_id
  GROUP BY
    il."itemId",
    il."shelfId",
    s."name",
    il."trackedEntityId",
    te."readableId";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
