-- ============================================================================
-- get_picking_schedule: include job materials that are not assigned to a
-- specific operation (jobMaterial."jobOperationId" IS NULL).
--
-- MES demands a material at every operation of its make method when it has no
-- operation assignment, but the picking schedule previously required a
-- non-null "jobOperationId" — so operations whose materials are all unassigned
-- never appeared, and their materials could never be picked. Unassigned
-- materials are now attributed to the FIRST live (not Done/Canceled,
-- lowest-"order") operation of their job make method, so they appear exactly
-- once. The staged-lineside check and the duplicate-list exclusion key on that
-- effective operation.
-- ============================================================================

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
  -- Outstanding picks aggregated per effective operation. A material needs
  -- picking unless the operation's OWN work-center lineside bin already stocks
  -- enough on-hand to cover it. We test the ACTUAL on-hand at that bin rather
  -- than whether the jobMaterial's recorded shelf points there: a part can be
  -- line-stocked at this work center while the jobMaterial still points at the
  -- warehouse (or another line) — that is already staged, not an outstanding
  -- pick.
  picks AS (
    SELECT
      jo2."id" AS "jobOperationId",
      COUNT(*) AS "partsToPickCount",
      SUM(jm."quantityToIssue") AS "totalQuantityToPick"
    FROM "jobMaterial" jm
    -- Materials with no operation assignment are attributed to the first live
    -- operation of their make method (lowest "order", id tie-break).
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
    -- The operation's work-center lineside bin (managed default first, else
    -- oldest), mirroring get_or_create_work_center_lineside's selection.
    LEFT JOIN LATERAL (
      SELECT su."id"
      FROM "storageUnit" su
      WHERE su."workCenterId" = jo2."workCenterId"
        AND su."companyId" = p_company_id
      ORDER BY su."isWorkCenterDefault" DESC, su."createdAt" ASC
      LIMIT 1
    ) wcl ON true
    -- On-hand of this item already staged at that lineside bin.
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(il."quantity"), 0) AS qty
      FROM "itemLedger" il
      WHERE il."itemId" = jm."itemId"
        AND il."companyId" = p_company_id
        AND il."storageUnitId" = wcl."id"
    ) staged ON true
    WHERE jm."companyId" = p_company_id
      AND jm."quantityToIssue" > 0
      -- Needs picking unless the lineside bin already covers the issue qty.
      AND (wcl."id" IS NULL OR staged.qty < jm."quantityToIssue")
      -- Exclude operations already on a non-cancelled picking list (no dupes).
      AND NOT EXISTS (
        SELECT 1 FROM "pickingListLine" pll
        JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
        WHERE pll."jobOperationId" = jo2."id"
          AND pl."status" <> 'Cancelled'
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
