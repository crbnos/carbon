-- Batch builder: resolve an operation's materials over the whole make-method
-- BOM, not just the lines pinned to that one operation.
--
-- A jobMaterial's "jobOperationId" is not a reliable signal for batching. Unless
-- the planner assigns it by hand (almost never), a BOM line is auto-attributed
-- to its make method's FIRST operation — for a sheet-metal part that is usually
-- File Prep / Bend Evaluation, not the process being batched (Fiber Laser
-- Cutting). The previous definition only surfaced materials whose
-- "jobOperationId" matched the batched operation (or job-wide UNPINNED lines),
-- so a sub-assembly whose sheet landed on a sibling operation read "No
-- materials" in the New Batch dialog even though the same sheet showed for a
-- sibling part whose line happened to sit on its cutting operation.
--
-- Fix: scope the material lookup to the operation's make method
-- ("jobMakeMethodId"), i.e. the sub-assembly's entire bill of material. This is
-- a superset of the old op-pinned lines and is correctly scoped to the
-- sub-assembly (tighter than the old job-wide UNPINNED fallback, which could
-- pull a different sub-assembly's stock). Return type is unchanged, so
-- CREATE OR REPLACE — forked from 20260918094217_batch-output-lot-at-creation.sql.
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
          -- The operation's make method (sub-assembly) — its whole BOM,
          -- regardless of which operation each line is pinned to.
          (jo."jobMakeMethodId" IS NOT NULL
            AND jm."jobMakeMethodId" = jo."jobMakeMethodId")
          -- Defensive fallback for an operation with no make method: the job's
          -- own unpinned BOM lines, as before.
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
        AND j."status" NOT IN ('Completed', 'Closed', 'Cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM "productionEvent" pe
          WHERE pe."jobOperationId" = jo."id"
            AND pe."companyId" = jo."companyId"
        ))
      OR b."status" IN ('Planned', 'Active', 'Completing')
    );
$$;
