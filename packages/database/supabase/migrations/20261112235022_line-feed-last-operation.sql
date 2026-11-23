-- Line feeder shortages: a material with no operation now counts at the LAST
-- open operation of its make method, not the first. The required-scan gate
-- (getRequiredScanShortfall), unissuedTrackedMaterials and the traveler issue
-- chooser all consume such a material at the last operation, so the feeder
-- stocked the wrong station. Everything else is unchanged from
-- 20261112180117_get-line-feed-shortages.sql.

CREATE OR REPLACE FUNCTION get_line_feed_shortages(
  p_location_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "workCenterId" TEXT,
  "storageUnitId" TEXT,
  "itemId" TEXT,
  "required" NUMERIC,
  "onHand" NUMERIC,
  "short" NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH station_bins AS (
    SELECT su."id", su."workCenterId", su."isWorkCenterDefault", su."createdAt"
    FROM "storageUnit" su
    WHERE su."companyId" = p_company_id
      AND su."locationId" = p_location_id
      AND su."workCenterId" IS NOT NULL
      AND su."active" = true
  ),
  station AS (
    SELECT DISTINCT ON (sb."workCenterId")
      sb."workCenterId" AS "stationWorkCenterId",
      sb."id" AS "stationStorageUnitId"
    FROM station_bins sb
    ORDER BY sb."workCenterId", sb."isWorkCenterDefault" DESC, sb."createdAt" ASC, sb."id"
  ),
  open_operations AS (
    SELECT jo."id", jo."jobId", jo."jobMakeMethodId", jo."workCenterId", jo."order"
    FROM "jobOperation" jo
    INNER JOIN "job" j
      ON j."id" = jo."jobId"
      AND j."companyId" = p_company_id
    WHERE jo."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."status" IN ('Ready', 'In Progress', 'Paused')
      AND jo."status" NOT IN ('Done', 'Canceled')
  ),
  last_open_operation AS (
    SELECT DISTINCT ON (oo."jobMakeMethodId")
      oo."jobMakeMethodId", oo."id"
    FROM open_operations oo
    WHERE oo."jobMakeMethodId" IS NOT NULL
    ORDER BY oo."jobMakeMethodId", oo."order" DESC, oo."id" DESC
  ),
  need AS (
    SELECT
      oo."workCenterId" AS "needWorkCenterId",
      jm."itemId" AS "needItemId",
      SUM(GREATEST(COALESCE(jm."estimatedQuantity", 0) - COALESCE(jm."quantityIssued", 0), 0)) AS "needQuantity"
    FROM "jobMaterial" jm
    INNER JOIN "item" i
      ON i."id" = jm."itemId"
      AND i."companyId" = p_company_id
    LEFT JOIN last_open_operation lo
      ON jm."jobOperationId" IS NULL
      AND lo."jobMakeMethodId" = jm."jobMakeMethodId"
    INNER JOIN open_operations oo
      ON oo."id" = COALESCE(jm."jobOperationId", lo."id")
      AND oo."jobId" = jm."jobId"
    WHERE jm."companyId" = p_company_id
      AND jm."methodType" = 'Pull from Inventory'
      AND i."itemTrackingType" <> 'Non-Inventory'
      AND oo."workCenterId" IS NOT NULL
    GROUP BY oo."workCenterId", jm."itemId"
  ),
  on_hand AS (
    SELECT
      sb."workCenterId" AS "onHandWorkCenterId",
      il."itemId" AS "onHandItemId",
      SUM(il."quantity") AS "onHandQuantity"
    FROM "itemLedger" il
    INNER JOIN station_bins sb ON sb."id" = il."storageUnitId"
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
    GROUP BY sb."workCenterId", il."itemId"
  )
  SELECT
    n."needWorkCenterId",
    s."stationStorageUnitId",
    n."needItemId",
    n."needQuantity",
    GREATEST(COALESCE(oh."onHandQuantity", 0), 0),
    n."needQuantity" - GREATEST(COALESCE(oh."onHandQuantity", 0), 0)
  FROM need n
  INNER JOIN station s ON s."stationWorkCenterId" = n."needWorkCenterId"
  LEFT JOIN on_hand oh
    ON oh."onHandWorkCenterId" = n."needWorkCenterId"
    AND oh."onHandItemId" = n."needItemId"
  WHERE n."needQuantity" > GREATEST(COALESCE(oh."onHandQuantity", 0), 0)
  ORDER BY 6 DESC, 1, 3;
END;
$$;
