-- Line feeder shortages, three corrections to
-- 20261112235022_line-feed-last-operation.sql.
--
-- 1. A material with no operation counts at the FIRST open operation of its
--    make method again, not the last. generatePickingList stages such a
--    material at the lineside of the first selected operation, so the stock
--    is at the first station. When the feeder read the last station, that
--    station reported a shortage for stock that was already delivered, and
--    asked for a second delivery. The last-operation rule of
--    20261112235022 is removed on purpose.
-- 2. On hand leaves out the balances of Rejected and Scrapped tracked
--    entities (the denormalized itemLedger."trackedEntityStatus"). Production
--    cannot issue those units, so they do not cover a shortage.
-- 3. Project stock (stock stripes). A job of a project with project stock
--    draws that project's stock first, then unassigned stock. Every other job
--    draws unassigned stock only. Each project's demand is netted against its
--    own stripe at the station; the remainder, and the demand of every other
--    job, is netted against the unassigned stock. Stock of a project that no
--    open job at the station draws does not cover a shortage. "onHand" is the
--    stock that can cover the demand, not the sum of every stripe.
--
-- SECURITY INVOKER: the caller's RLS applies.

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
SECURITY INVOKER
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
    SELECT jo."id", jo."jobId", jo."jobMakeMethodId", jo."workCenterId", jo."order",
      -- The job's own stripe ('' for unassigned stock): its project when the
      -- project has project stock.
      CASE WHEN pr."projectStock" THEN j."projectId" ELSE '' END AS "stripe"
    FROM "jobOperation" jo
    INNER JOIN "job" j
      ON j."id" = jo."jobId"
      AND j."companyId" = p_company_id
    LEFT JOIN "project" pr
      ON pr."id" = j."projectId"
      AND pr."companyId" = p_company_id
    WHERE jo."companyId" = p_company_id
      AND j."locationId" = p_location_id
      AND j."status" IN ('Ready', 'In Progress', 'Paused')
      AND jo."status" NOT IN ('Done', 'Canceled')
  ),
  first_open_operation AS (
    SELECT DISTINCT ON (oo."jobMakeMethodId")
      oo."jobMakeMethodId", oo."id"
    FROM open_operations oo
    WHERE oo."jobMakeMethodId" IS NOT NULL
    ORDER BY oo."jobMakeMethodId", oo."order" ASC, oo."id"
  ),
  need AS (
    SELECT
      oo."workCenterId" AS "needWorkCenterId",
      jm."itemId" AS "needItemId",
      oo."stripe" AS "needStripe",
      SUM(GREATEST(COALESCE(jm."estimatedQuantity", 0) - COALESCE(jm."quantityIssued", 0), 0)) AS "needQuantity"
    FROM "jobMaterial" jm
    INNER JOIN "item" i
      ON i."id" = jm."itemId"
      AND i."companyId" = p_company_id
    LEFT JOIN first_open_operation fo
      ON jm."jobOperationId" IS NULL
      AND fo."jobMakeMethodId" = jm."jobMakeMethodId"
    INNER JOIN open_operations oo
      ON oo."id" = COALESCE(jm."jobOperationId", fo."id")
      AND oo."jobId" = jm."jobId"
    WHERE jm."companyId" = p_company_id
      AND jm."methodType" = 'Pull from Inventory'
      AND i."itemTrackingType" <> 'Non-Inventory'
      AND oo."workCenterId" IS NOT NULL
    GROUP BY oo."workCenterId", jm."itemId", oo."stripe"
  ),
  on_hand AS (
    SELECT
      sb."workCenterId" AS "onHandWorkCenterId",
      il."itemId" AS "onHandItemId",
      COALESCE(il."projectId", '') AS "onHandStripe",
      GREATEST(SUM(il."quantity"), 0) AS "onHandQuantity"
    FROM "itemLedger" il
    INNER JOIN station_bins sb ON sb."id" = il."storageUnitId"
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      -- Only the station bins and the items in demand, so the storage-unit
      -- index drives the read instead of the location's whole ledger.
      AND il."storageUnitId" IN (SELECT sb2."id" FROM station_bins sb2)
      AND il."itemId" IN (SELECT n."needItemId" FROM need n)
      AND (
        il."trackedEntityStatus" IS NULL
        OR il."trackedEntityStatus" NOT IN ('Rejected', 'Scrapped')
      )
    GROUP BY sb."workCenterId", il."itemId", COALESCE(il."projectId", '')
  ),
  -- Per station and item: the total demand, and the part of it that the
  -- demanding projects' own stripes cover.
  netted AS (
    SELECT
      n."needWorkCenterId" AS "nettedWorkCenterId",
      n."needItemId" AS "nettedItemId",
      SUM(n."needQuantity") AS "requiredQuantity",
      SUM(
        CASE
          WHEN n."needStripe" = '' THEN 0
          ELSE LEAST(n."needQuantity", COALESCE(oh."onHandQuantity", 0))
        END
      ) AS "projectCovered"
    FROM need n
    LEFT JOIN on_hand oh
      ON oh."onHandWorkCenterId" = n."needWorkCenterId"
      AND oh."onHandItemId" = n."needItemId"
      AND oh."onHandStripe" = n."needStripe"
    GROUP BY n."needWorkCenterId", n."needItemId"
  ),
  usable AS (
    SELECT
      nt."nettedWorkCenterId",
      nt."nettedItemId",
      nt."requiredQuantity",
      nt."projectCovered" + COALESCE(common."onHandQuantity", 0) AS "usableQuantity"
    FROM netted nt
    LEFT JOIN on_hand common
      ON common."onHandWorkCenterId" = nt."nettedWorkCenterId"
      AND common."onHandItemId" = nt."nettedItemId"
      AND common."onHandStripe" = ''
  )
  SELECT
    u."nettedWorkCenterId",
    s."stationStorageUnitId",
    u."nettedItemId",
    u."requiredQuantity",
    u."usableQuantity",
    u."requiredQuantity" - u."usableQuantity"
  FROM usable u
  INNER JOIN station s ON s."stationWorkCenterId" = u."nettedWorkCenterId"
  WHERE u."requiredQuantity" > u."usableQuantity"
  ORDER BY 6 DESC, 1, 3;
END;
$$;
