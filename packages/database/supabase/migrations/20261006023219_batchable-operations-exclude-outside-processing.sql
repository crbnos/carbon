-- Outside Processing operations can't be batched.
--
-- A batch is one run on one of our work centers; subcontracted work runs at
-- the supplier. get_batchable_operations had no operationType filter, so an
-- outside operation on a batchable process (plating is a typical one) was
-- offered as a candidate, and releasing its batch stamped the batch's work
-- center onto it — which put it on the work centers boards. The batch-operations
-- server function refuses one too (assertEligible); this keeps it out of the
-- builder's candidate list. Members of existing batches still list with their
-- batch.
--
-- The body is the 20260921163512_batchable-operations-item-and-method-materials.sql
-- definition plus that one predicate in the candidate branch.

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
    -- job's item only when the operation has no make method. (from #1686)
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
          -- The operation's make method (sub-assembly) — its whole BOM,
          -- regardless of which operation each line is pinned to. (from #1689)
          (jo."jobMakeMethodId" IS NOT NULL
            AND jm."jobMakeMethodId" = jo."jobMakeMethodId")
          -- Defensive fallback for an operation with no make method: the job's
          -- own unpinned BOM lines.
          OR (jo."jobMakeMethodId" IS NULL
            AND jm."jobId" = jo."jobId"
            AND jm."jobOperationId" IS NULL)
        )
    ) mats ON TRUE
  WHERE j."locationId" = location_id
    AND jo."processId" = process_id
    AND (
      (jo."jobOperationBatchId" IS NULL
        AND jo."status" IN ('Todo', 'Ready', 'Waiting')
        AND jo."operationType" <> 'Outside Processing'
        AND j."status" NOT IN ('Completed', 'Closed', 'Cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM "productionEvent" pe
          WHERE pe."jobOperationId" = jo."id"
            AND pe."companyId" = jo."companyId"
        ))
      OR b."status" IN ('Planned', 'Active', 'Completing')
    );
$$;
