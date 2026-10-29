-- Keep Outside Processing operations off the MES Work Centers board.
--
-- The board (get_active_job_operations_by_location) had no operationType filter;
-- subcontracted operations stayed off it only because they usually have no work
-- center, and the board's columns are work centers. An Outside Processing
-- operation that carries a work center — e.g. a stale one left behind when an
-- operation is switched to Outside Processing, since the form hides the field
-- and the update leaves the column as it was — landed in that work center's
-- column for an operator to start.
--
-- Subcontract behaviour keys on operationType = 'Outside Processing' (see
-- 20260721004140_operation-type-consolidation.sql). The body below is the
-- 20260905132037_job-operation-batching.sql definition plus that one predicate.

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
      OR "job"."id" IN (
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
  -- Subcontracted work is done at the supplier, not on the shop floor.
  AND jo."operationType" <> 'Outside Processing'
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;
