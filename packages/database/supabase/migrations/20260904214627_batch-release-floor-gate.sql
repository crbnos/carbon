-- Batch release: everything that references the 'Planned' enum value added by
-- 20260904214536_batch-planned-state-and-batch-type.sql (a value cannot be
-- used in the transaction that adds it, so these uses live in their own file).
--
-- 1. New batches default to 'Planned' (the edge fn sets status explicitly;
--    this is belt-and-braces honesty).
-- 2. get_batchable_operations: the planner sees operations of any LIVE job
--    (not only released ones) and renders lanes for Planned batches too.
-- 3. get_active_job_operations_by_location: the floor reads the
--    membership-handoff rule — an op in a batch is governed by the BATCH's
--    release state; an op in no batch by its JOB's (today's rule).

ALTER TABLE "jobOperationBatch" ALTER COLUMN "status" SET DEFAULT 'Planned';

-- ── get_batchable_operations ────────────────────────────────────────────────
-- Fork of 20260821024449_job-operation-batching.sql (newest definition).
-- Edits: job filter widened to live statuses; lane clause includes 'Planned'.
DROP FUNCTION IF EXISTS get_batchable_operations(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_batchable_operations(location_id TEXT, process_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobReadableId" TEXT,
  "jobDueDate" DATE,
  "jobStatus" "jobStatus",
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
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
    i."readableId" AS "itemReadableId",
    i."name" AS "itemDescription",
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
      WHERE jm."jobOperationId" = jo."id"
    ) mats ON TRUE
  WHERE j."locationId" = location_id
    AND jo."processId" = process_id
    AND (
      (jo."jobOperationBatchId" IS NULL
        AND jo."status" IN ('Todo', 'Ready', 'Waiting')
        -- Widened from released-only: batches are composed BEFORE release, so
        -- any live job's unstarted ops are candidates. Terminal jobs never are.
        AND j."status" NOT IN ('Completed', 'Closed', 'Cancelled')
        -- Exclude operations already started via a timer (a recorded
        -- productionEvent), even if their status has not flipped yet. Mirrors the
        -- batch-operations edge-fn assertEligible gate so the board never lists an
        -- op that would be rejected on drop.
        AND NOT EXISTS (
          SELECT 1 FROM "productionEvent" pe
          WHERE pe."jobOperationId" = jo."id"
            AND pe."companyId" = jo."companyId"
        ))
      -- Render lanes for Planned batches (being composed), Active batches
      -- (drag targets) and Completing batches (read-only — a stuck completion
      -- stays visible where the planner looks).
      OR b."status" IN ('Planned', 'Active', 'Completing')
    );
$$;

-- ── get_active_job_operations_by_location ───────────────────────────────────
-- Fork of 20260831170323_merge-batching-with-dual-dates.sql (newest
-- definition). Edits: relevant_jobs additionally includes jobs pulled forward
-- by a Released batch; the op-level filter applies the membership-handoff
-- rule. The Paused coercion is deliberately untouched — a paused member job
-- still renders its op Paused inside a Released batch.
DROP FUNCTION IF EXISTS get_active_job_operations_by_location;
CREATE OR REPLACE FUNCTION get_active_job_operations_by_location(
  location_id TEXT,
  work_center_ids TEXT[]
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "priority" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "customerName" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "salesOrderReadableId" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "thumbnailPath" TEXT,
  "operationDueDate" DATE,
  "reworkId" TEXT,
  "hasConflict" BOOLEAN,
  "conflictReason" TEXT,
  "projectedCompletionAt" TIMESTAMP WITH TIME ZONE,
  "processBatchable" BOOLEAN,
  "jobOperationBatchId" TEXT,
  "batchReadableId" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND (
      ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
      -- A Released batch pulls its members' jobs onto the floor even when the
      -- job itself is not yet released; the op-level handoff filter below
      -- keeps such a job's NON-batched operations hidden.
      OR "id" IN (
        SELECT jo2."jobId"
        FROM "jobOperation" jo2
        JOIN "jobOperationBatch" b2
          ON b2."id" = jo2."jobOperationBatchId"
         AND b2."companyId" = jo2."companyId"
        WHERE b2."status" IN ('Active', 'Completing')
      )
    )
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."priority",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    rj."customerId" AS "jobCustomerId",
    c."name" AS "customerName",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    rj."salesOrderId",
    rj."salesOrderLineId",
    so."salesOrderId" as "salesOrderReadableId",
    jo."assignee",
    jo."tags",
    COALESCE(mu."thumbnailPath", i."thumbnailPath") as "thumbnailPath",
    jo."dueDate" AS "operationDueDate",
    jo."reworkId",
    COALESCE(jo."hasConflict", FALSE) AS "hasConflict",
    jo."conflictReason",
    jo."projectedCompletionAt",
    p."batchable" AS "processBatchable",
    jo."jobOperationBatchId",
    b."readableId" AS "batchReadableId"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "customer" c ON rj."customerId" = c.id
  LEFT JOIN "salesOrder" so ON rj."salesOrderId" = so.id
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu.id
  LEFT JOIN "process" p ON p."id" = jo."processId"
  LEFT JOIN "jobOperationBatch" b
    ON b."id" = jo."jobOperationBatchId" AND b."companyId" = jo."companyId"
   WHERE (CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END)
  -- Membership handoff: a batched op is governed by its BATCH's release
  -- state; an unbatched op by its JOB's (the pre-batching rule).
  AND (
    (jo."jobOperationBatchId" IS NOT NULL AND b."status" IN ('Active', 'Completing'))
    OR
    (jo."jobOperationBatchId" IS NULL AND rj."status" IN ('Ready', 'In Progress', 'Paused'))
  )
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;
