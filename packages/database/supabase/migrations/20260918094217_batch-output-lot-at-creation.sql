-- Output lot identity is decided when a batch is PLANNED, not on the floor.
--
-- mergeOutput: every member's output completes into one lot, outputLotNumber.
-- Otherwise each member keeps its own lot, numbered by its WIP entity's
-- readableId (the job's batch number property) — set in the batch builder or
-- the job sidebar, and required by completion either way.
ALTER TABLE "jobOperationBatch"
  ADD COLUMN "mergeOutput" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "outputLotNumber" TEXT;

ALTER TABLE "jobOperationBatch"
  ADD CONSTRAINT "jobOperationBatch_mergeOutput_lot_check"
  CHECK (
    NOT "mergeOutput"
    OR ("outputLotNumber" IS NOT NULL AND length(btrim("outputLotNumber")) > 0)
  );

-- Candidates now carry what the builder's Output card needs: the produced
-- item, whether it is batch-tracked, and the job's live WIP entity with its
-- current lot number (pre-fills the per-job lot fields). Redefined from
-- 20260905132037_job-operation-batching.sql; the return type changes, so
-- drop first.
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
    JOIN "item" i ON i."id" = j."itemId"
    LEFT JOIN "jobMakeMethod" jmm
      ON jmm."id" = jo."jobMakeMethodId" AND jmm."companyId" = jo."companyId"
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
