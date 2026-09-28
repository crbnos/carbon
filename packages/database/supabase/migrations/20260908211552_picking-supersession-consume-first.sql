
CREATE OR REPLACE FUNCTION get_lineside_credit(
  p_company_id TEXT,
  p_location_id TEXT,
  p_storage_unit_id TEXT,
  p_item_id TEXT,
  p_job_id TEXT,
  p_job_material_id TEXT
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  WITH on_hand AS (
    SELECT COALESCE(SUM(il."quantity"), 0) AS qty
    FROM "itemLedger" il
    WHERE il."companyId" = p_company_id
      AND il."itemId" = p_item_id
      AND il."storageUnitId" = p_storage_unit_id
  ),
  claims AS (
    SELECT pll."jobId", pll."jobMaterialId",
      SUM(GREATEST(0, COALESCE(pll."quantityPicked", 0) - COALESCE(pll."quantityReturned", 0))) AS staged
    FROM "pickingListLine" pll
    JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
    JOIN "job" j ON j."id" = pll."jobId"
    WHERE pll."companyId" = p_company_id
      AND pll."itemId" = p_item_id
      AND pll."toStorageUnitId" = p_storage_unit_id
      AND pll."status" <> 'Cancelled'
      AND pl."status" <> 'Cancelled'
      AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
    GROUP BY pll."jobId", pll."jobMaterialId"
  ),
  consumed AS (
    SELECT il."documentId" AS job_id, GREATEST(0, -SUM(il."quantity")) AS qty
    FROM "itemLedger" il
    WHERE il."companyId" = p_company_id
      AND il."locationId" = p_location_id
      AND il."storageUnitId" = p_storage_unit_id
      AND il."itemId" = p_item_id
      AND il."documentType" = 'Job Consumption'
    GROUP BY il."documentId"
  ),
  per_job AS (
    SELECT c."jobId", SUM(c.staged) AS staged, COALESCE(MAX(k.qty), 0) AS consumed
    FROM claims c
    LEFT JOIN consumed k ON k.job_id = c."jobId"
    GROUP BY c."jobId"
  ),
  claimed AS (
    SELECT COALESCE(SUM(GREATEST(0, staged - consumed)), 0) AS qty FROM per_job
  ),
  own AS (
    SELECT GREATEST(
      0,
      COALESCE((SELECT SUM(staged) FROM claims WHERE "jobMaterialId" = p_job_material_id), 0)
      - COALESCE((SELECT qty FROM consumed WHERE job_id = p_job_id), 0)
    ) AS qty
  )
  SELECT (SELECT qty FROM own) + GREATEST(0, (SELECT qty FROM on_hand) - (SELECT qty FROM claimed));
$$;

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
  picks AS (
    SELECT
      jo2."id" AS "jobOperationId",
      COUNT(*) AS "partsToPickCount",
      SUM(jm."quantityToIssue") AS "totalQuantityToPick"
    FROM "jobMaterial" jm
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
    LEFT JOIN LATERAL (
      SELECT s.*
      FROM "itemSupersession" s
      WHERE s."companyId" = p_company_id
        AND s."itemId" IN (jm."substitutedFromItemId", jm."itemId")
      ORDER BY
        (s."itemId" = jm."itemId"
          AND s."successorItemId" = jm."substitutedFromItemId") IS TRUE DESC,
        (s."itemId" = jm."substitutedFromItemId") IS TRUE DESC
      LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" IS NULL THEN NULL
          WHEN ss."itemId" = jm."substitutedFromItemId" THEN jm."itemId"
          WHEN ss."successorItemId" IS NOT NULL
            AND (ss."successorEffectivityDate" IS NULL
                 OR ss."successorEffectivityDate" <= (now() AT TIME ZONE 'UTC')::date)
          THEN ss."successorItemId"
          ELSE NULL
        END AS "successorItemId"
    ) res ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."quantity" / jm."substitutionFactor"
          ELSE jm."quantity"
        END AS "perAssemblyOld"
    ) per ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."supersessionMode" = 'Consume First' THEN
            COALESCE((
              SELECT SUM(bin.qty)
              FROM (
                SELECT SUM(il."quantity") AS qty
                FROM "itemLedger" il
                WHERE il."itemId" = ss."itemId"
                  AND il."companyId" = p_company_id
                  AND il."locationId" = p_location_id
                  AND get_effective_work_center_id(il."storageUnitId") IS NULL
                GROUP BY il."storageUnitId"
                HAVING SUM(il."quantity") > 0
              ) bin
            ), 0) >= GREATEST(COALESCE(per."perAssemblyOld", 0), 0)
            AND COALESCE((
              SELECT SUM(bin.qty)
              FROM (
                SELECT SUM(il."quantity") AS qty
                FROM "itemLedger" il
                WHERE il."itemId" = ss."itemId"
                  AND il."companyId" = p_company_id
                  AND il."locationId" = p_location_id
                  AND get_effective_work_center_id(il."storageUnitId") IS NULL
                GROUP BY il."storageUnitId"
                HAVING SUM(il."quantity") > 0
              ) bin
            ), 0) > 0
          ELSE EXISTS (
            SELECT 1 FROM "itemLedger" il
            WHERE il."itemId" = ss."itemId"
              AND il."companyId" = p_company_id
              AND il."locationId" = p_location_id
              AND get_effective_work_center_id(il."storageUnitId") IS NULL
            GROUP BY il."storageUnitId"
            HAVING SUM(il."quantity") > 0
          )
        END AS "predecessorInStock",
        EXISTS (
          SELECT 1 FROM "itemLedger" il
          WHERE il."itemId" = res."successorItemId"
            AND il."companyId" = p_company_id
            AND il."locationId" = p_location_id
            AND get_effective_work_center_id(il."storageUnitId") IS NULL
          GROUP BY il."storageUnitId"
          HAVING SUM(il."quantity") > 0
        ) AS "successorInStock"
      WHERE ss."supersessionMode" IN ('Consume First', 'Prefer New')
        AND res."successorItemId" IS NOT NULL
    ) stk ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" IS NULL THEN jm."itemId"
          WHEN ss."itemId" = jm."substitutedFromItemId" THEN
            CASE
              WHEN ss."supersessionMode" = 'Consume First'
                AND COALESCE(stk."predecessorInStock", true)
              THEN jm."substitutedFromItemId"
              WHEN ss."supersessionMode" = 'Prefer New'
                AND NOT COALESCE(stk."successorInStock", true)
                AND COALESCE(stk."predecessorInStock", true)
              THEN jm."substitutedFromItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Consume First' THEN
            CASE
              WHEN res."successorItemId" IS NOT NULL
                AND NOT COALESCE(stk."predecessorInStock", true)
                AND COALESCE(stk."successorInStock", true)
              THEN res."successorItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Prefer New' THEN
            CASE
              WHEN res."successorItemId" IS NOT NULL
                AND (COALESCE(stk."successorInStock", true)
                     OR NOT COALESCE(stk."predecessorInStock", true))
              THEN res."successorItemId"
              ELSE jm."itemId"
            END
          WHEN ss."supersessionMode" = 'Stock Only' THEN res."successorItemId"
          WHEN ss."supersessionMode" = 'No Stock' THEN NULL
          ELSE jm."itemId"
        END AS "pickItemId"
    ) pick ON true
    LEFT JOIN LATERAL (
      SELECT
        pick."pickItemId",
        CASE
          WHEN pick."pickItemId" IS NULL OR pick."pickItemId" = jm."itemId" THEN 1
          WHEN pick."pickItemId" = jm."substitutedFromItemId" THEN
            CASE
              WHEN COALESCE(jm."substitutionFactor", 0) > 0
              THEN 1 / jm."substitutionFactor"
              ELSE 1
            END
          ELSE COALESCE(ss."conversionFactor", 1)
        END AS "pickFactor"
    ) pit ON true
    LEFT JOIN LATERAL (
      SELECT su."id"
      FROM "storageUnit" su
      WHERE su."workCenterId" = jo2."workCenterId"
        AND su."companyId" = p_company_id
      ORDER BY su."isWorkCenterDefault" DESC, su."createdAt" ASC
      LIMIT 1
    ) wcl ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."quantityToIssue" / jm."substitutionFactor"
          ELSE jm."quantityToIssue"
        END AS need_old,
        CASE
          WHEN ss."itemId" = jm."substitutedFromItemId"
            AND COALESCE(jm."substitutionFactor", 0) > 0
          THEN jm."substitutionFactor"
          ELSE GREATEST(COALESCE(ss."conversionFactor", 1), 0)
        END AS new_per_old,
        CASE WHEN wcl."id" IS NULL THEN 0 ELSE get_lineside_credit(
          p_company_id, p_location_id, wcl."id", ss."itemId", jm."jobId", jm."id"
        ) END AS staged_old,
        CASE WHEN wcl."id" IS NULL OR res."successorItemId" IS NULL THEN 0 ELSE get_lineside_credit(
          p_company_id, p_location_id, wcl."id", res."successorItemId", jm."jobId", jm."id"
        ) END AS staged_new
    ) cf ON true
    WHERE jm."companyId" = p_company_id
      AND jm."quantityToIssue" > 0
      AND jm."methodType" != 'Make to Order'
      AND pit."pickItemId" IS NOT NULL
      AND (
        wcl."id" IS NULL
        OR CASE
          WHEN ss."supersessionMode" = 'Consume First'
            AND res."successorItemId" IS NOT NULL
            AND COALESCE(per."perAssemblyOld", 0) > 0
            AND cf.new_per_old > 0
          THEN
            floor(GREATEST(cf.staged_old, 0) / per."perAssemblyOld") * per."perAssemblyOld"
            + floor(GREATEST(cf.staged_new, 0) / (per."perAssemblyOld" * cf.new_per_old)) * per."perAssemblyOld"
            < cf.need_old
          ELSE get_lineside_credit(
            p_company_id, p_location_id, wcl."id", pit."pickItemId", jm."jobId", jm."id"
          ) < jm."quantityToIssue" * pit."pickFactor"
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM "pickingListLine" pll
        JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
        WHERE pll."jobOperationId" = jo2."id"
          AND pll."status" <> 'Cancelled'
          AND pl."status" IN ('Draft', 'In Progress', 'Partial')
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

CREATE OR REPLACE VIEW "openJobMaterialLines" AS (
  SELECT
    jm."id",
    jm."jobId",
    jmm."parentMaterialId",
    jm."jobMakeMethodId",
    j."jobId" as "jobReadableId",
    jm."itemId",
    jm."quantityToIssue",
    jm."unitOfMeasureCode",
    jm."companyId",
    i1."replenishmentSystem",
    i1."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    jm."quantity" AS "quantityPerParent"
  FROM "jobMaterial" jm
  INNER JOIN "job" j ON jm."jobId" = j."id"
  INNER JOIN "jobMakeMethod" jmm ON jm."jobMakeMethodId" = jmm."id"
  INNER JOIN "item" i1 ON jm."itemId" = i1."id"
  INNER JOIN "item" i2 ON j."itemId" = i2."id"
  INNER JOIN "itemReplenishment" ir ON i2."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make to Order'
);
