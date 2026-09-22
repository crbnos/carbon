-- The batch builder list showed each candidate operation with the ROOT job
-- item's thumbnail / readableId / description — but a batch groups OPERATIONS,
-- and a sub-assembly operation's make method produces its own sub-assembly
-- item, not the job's top-level item. The item join was keyed on the job
-- (j."itemId") while requiresBatchTracking, the WIP lot lookup, and the output
-- lot grouping were already keyed on the operation's make method (jmm).
--
-- Resolve the item from the operation's make method instead
-- (jmm."itemId" produced by that method), falling back to the job's item only
-- when an operation has no make method. Redefined from
-- 20260918094217_batch-output-lot-at-creation.sql; only the item join changes,
-- the return type is unchanged, but the function is recreated whole for clarity.
DROP FUNCTION IF EXISTS get_batchable_operations(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_batchable_operations(location_id TEXT, process_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobReadableId" TEXT,
  "jobDueDate" DATE,
  "jobStatus" "jobStatus",
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "requiresBatchTracking" BOOLEAN,
  "trackedEntityId" TEXT,
  "lotNumber" TEXT,
  "description" TEXT,
  "operationQuantity" NUMERIC,
  "status" "jobOperationStatus",
  "workCenterId" TEXT,
  "jobOperationBatchId" TEXT,
  "batchReadableId" TEXT,
  "batchStatus" "jobOperationBatchStatus",
  "batchWorkCenterId" TEXT,
  "companyId" TEXT,
  "materials" JSONB
)
SECURITY INVOKER
LANGUAGE sql
STABLE
AS $$
  SELECT
    jo."id",
    j."id" AS "jobId",
    j."jobId" AS "jobReadableId",
    j."dueDate" AS "jobDueDate",
    j."status" AS "jobStatus",
    i."id" AS "itemId",
    i."readableId" AS "itemReadableId",
    i."name" AS "itemDescription",
    COALESCE(jmm."requiresBatchTracking", false) AS "requiresBatchTracking",
    wip."id" AS "trackedEntityId",
    wip."readableId" AS "lotNumber",
    jo."description",
    jo."operationQuantity",
    jo."status",
    jo."workCenterId",
    jo."jobOperationBatchId",
    b."readableId" AS "batchReadableId",
    b."status" AS "batchStatus",
    b."workCenterId" AS "batchWorkCenterId",
    jo."companyId",
    COALESCE(mats."materials", '[]'::jsonb) AS "materials"
  FROM "jobOperation" jo
    JOIN "job" j ON j."id" = jo."jobId"
    LEFT JOIN "jobMakeMethod" jmm
      ON jmm."id" = jo."jobMakeMethodId" AND jmm."companyId" = jo."companyId"
    -- The operation's produced item = its make method's item; fall back to the
    -- job's item only when the operation has no make method.
    JOIN "item" i ON i."id" = COALESCE(jmm."itemId", j."itemId")
    LEFT JOIN LATERAL (
      SELECT te."id", te."readableId"
      FROM "trackedEntity" te
      WHERE te."attributes"->>'Job Make Method' = jo."jobMakeMethodId"
        AND te."companyId" = jo."companyId"
        AND te."status" NOT IN ('Consumed', 'Scrapped', 'Rejected')
      ORDER BY te."createdAt"
      LIMIT 1
    ) wip ON jmm."requiresBatchTracking"
    LEFT JOIN "jobOperationBatch" b
      ON b."id" = jo."jobOperationBatchId" AND b."companyId" = jo."companyId"
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'itemReadableId', mi."readableId",
        'description', jm."description",
        'quantity', jm."quantity",
        'formId', m."materialFormId",           'formName', mf."name",
        'substanceId', m."materialSubstanceId", 'substanceName', ms."name",
        'gradeId', m."gradeId",                 'gradeName', mg."name",
        'dimensionId', m."dimensionId",         'dimensionName', md."name",
        'finishId', m."finishId",               'finishName', mfin."name"
      )) AS "materials"
      FROM "jobMaterial" jm
        JOIN "item" mi ON mi."id" = jm."itemId"
        LEFT JOIN "material" m ON m."id" = mi."readableId" AND m."companyId" = mi."companyId"
        LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
        LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
        LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
        LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
        LEFT JOIN "materialFinish" mfin ON mfin."id" = m."finishId"
      WHERE jm."companyId" = jo."companyId"
        AND (
          jm."jobOperationId" = jo."id"
          OR (
            jm."jobId" = jo."jobId"
            AND jm."jobOperationId" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "jobMaterial" jml
              WHERE jml."jobId" = jo."jobId"
                AND jml."companyId" = jo."companyId"
                AND jml."jobOperationId" = jo."id"
            )
          )
        )
    ) mats ON TRUE
  WHERE j."locationId" = location_id
    AND jo."processId" = process_id
    AND (
      (jo."jobOperationBatchId" IS NULL
        AND jo."status" IN ('Todo', 'Ready', 'Waiting')
        AND j."status" NOT IN ('Completed', 'Closed', 'Cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM "productionEvent" pe
          WHERE pe."jobOperationId" = jo."id"
            AND pe."companyId" = jo."companyId"
        ))
      OR b."status" IN ('Planned', 'Active', 'Completing')
    );
$$;
