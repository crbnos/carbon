-- ============================================================================
-- Picking honors item supersession (#1210).
--
-- Two functions recreated with IDENTICAL signatures and RETURNS TABLE (so the
-- generated types are unchanged):
--
--   1. get_picking_schedule — a superseded job material is resolved to its
--      EFFECTIVE pick item before the staged-lineside check, and materials with
--      no valid pick target are dropped from the schedule:
--        Consume First / Prefer-New-not-yet-effective / no supersession -> predecessor
--        Prefer New (effective successor)                               -> successor
--        Stock Only (effective successor)                               -> successor
--        Stock Only (no effective successor) / No Stock                 -> excluded
--      This stops spares-only / obsolete predecessors from being surfaced as
--      production picks, while operations whose demand redirects to a live
--      successor still appear. Discontinuation date does NOT suppress a pick:
--      picking fulfills existing job demand (unlike planning, which suppresses
--      new orders). Successor on-hand is compared in successor units via the
--      conversion factor. Successor effectivity is evaluated against the UTC
--      calendar date ((now() AT TIME ZONE 'UTC')::date); generatePickingList in
--      the app uses today("UTC") to match, so both layers resolve the same
--      effective successor regardless of the DB session or server timezone.
--
--   2. get_picking_list_availability — warehouse availability is the line's OWN
--      pick item's non-lineside on-hand. Because generation already redirects a
--      substituted line's "itemId" to the effective successor, this reflects
--      exactly what the line consumes. Successor on-hand is NOT folded into a line
--      still targeting the predecessor: with no line-splitting that line consumes
--      the predecessor, so folding it in would mask a real predecessor shortage
--      and could double-count a successor that also has its own line.
--
-- Redirect gating is picking-specific and intentionally differs from the MRP /
-- job-creation map in functions/lib/supersession-pick.ts (which redirects only
-- Consume First / Prefer New): for PICKING, Stock Only must not be picked for
-- production, so its effective successor is used instead.
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
    -- Supersession config for the demanded material (global, one row per item).
    LEFT JOIN "itemSupersession" ss
      ON ss."itemId" = jm."itemId"
      AND ss."companyId" = p_company_id
    -- Resolve the EFFECTIVE pick item + unit factor. A NULL "pickItemId" means
    -- there is nothing valid to pick for production (Stock Only without an
    -- effective successor, or No Stock) — those rows are dropped below.
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" IS NULL THEN jm."itemId"
          WHEN ss."supersessionMode" = 'Consume First' THEN jm."itemId"
          WHEN ss."supersessionMode" = 'Prefer New' THEN
            CASE
              WHEN ss."successorItemId" IS NOT NULL
                AND (ss."successorEffectivityDate" IS NULL
                     OR ss."successorEffectivityDate" <= (now() AT TIME ZONE 'UTC')::date)
              THEN ss."successorItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Stock Only' THEN
            CASE
              WHEN ss."successorItemId" IS NOT NULL
                AND (ss."successorEffectivityDate" IS NULL
                     OR ss."successorEffectivityDate" <= (now() AT TIME ZONE 'UTC')::date)
              THEN ss."successorItemId"
              ELSE NULL
            END
          WHEN ss."supersessionMode" = 'No Stock' THEN NULL
          ELSE jm."itemId"
        END AS "pickItemId",
        CASE
          WHEN ss."supersessionMode" IN ('Prefer New', 'Stock Only')
            AND ss."successorItemId" IS NOT NULL
            AND (ss."successorEffectivityDate" IS NULL
                 OR ss."successorEffectivityDate" <= (now() AT TIME ZONE 'UTC')::date)
          THEN COALESCE(ss."conversionFactor", 1)
          ELSE 1
        END AS "pickFactor"
    ) pit ON true
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
    -- On-hand of the EFFECTIVE pick item already staged at that lineside bin.
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(il."quantity"), 0) AS qty
      FROM "itemLedger" il
      WHERE il."itemId" = pit."pickItemId"
        AND il."companyId" = p_company_id
        AND il."storageUnitId" = wcl."id"
    ) staged ON true
    WHERE jm."companyId" = p_company_id
      AND jm."quantityToIssue" > 0
      -- Drop materials with no valid production pick target (spares-only /
      -- obsolete predecessors without an effective successor).
      AND pit."pickItemId" IS NOT NULL
      -- Needs picking unless the lineside bin already covers the issue qty
      -- (compared in the pick item's units via the conversion factor).
      AND (wcl."id" IS NULL OR staged.qty < jm."quantityToIssue" * pit."pickFactor")
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
    -- Warehouse (non-lineside) on-hand of the line's OWN pick item — exactly what
    -- this line consumes. A supersession redirect is already resolved at
    -- generation time (a substituted line's "itemId" is the effective successor),
    -- so availability reflects the real pick item without any fold-in.
    --
    -- We deliberately do NOT add a successor's on-hand to a line still targeting
    -- the predecessor: with no line-splitting, such a line consumes the
    -- PREDECESSOR, so folding in successor stock would (a) mask a genuine
    -- predecessor shortage (suppressing the "No Stock" warning while the line
    -- cannot actually be covered) and (b) double-count the successor's stock when
    -- the same list also carries a separate line for that successor item.
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
