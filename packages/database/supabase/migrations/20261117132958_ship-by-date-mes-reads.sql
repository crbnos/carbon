-- The ship-by date on the MES screens (spec .ai/specs/2026-11-17-carrier-transit-ship-by-dates.md).
--
-- 1. "jobs" selects j.*, and Postgres expands * when it creates a view, so the
--    view is dropped and created again to carry job."shipByDate". The body is
--    copied verbatim from 20261006220401_fleet-bridge.sql.
-- 2. get_active_job_operations_by_location (body from
--    20261006021134_mes-hide-outside-processing.sql) and
--    get_assigned_job_operations (body from
--    20260304000000_add-operation-due-date-to-functions.sql) return
--    "jobShipByDate" after "jobDeadlineType". A RETURNS TABLE change needs a
--    DROP first. Nothing else in either body changes.

-- 1) jobs
DROP VIEW IF EXISTS "jobs";
CREATE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
LEFT JOIN "jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";

-- 2) get_active_job_operations_by_location
DROP FUNCTION IF EXISTS get_active_job_operations_by_location(TEXT, TEXT[]);
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
  "jobShipByDate" DATE,
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
    rj."shipByDate" AS "jobShipByDate",
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

-- 3) get_assigned_job_operations
DROP FUNCTION IF EXISTS get_assigned_job_operations(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_assigned_job_operations(
  user_id TEXT,
  company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
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
  "jobShipByDate" DATE,
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityScrapped" NUMERIC,
  "thumbnailPath" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "operationDueDate" DATE
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
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
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate" AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    j."shipByDate" AS "jobShipByDate",
    j."customerId" AS "jobCustomerId",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    j."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN j."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", j_mu."thumbnailPath", i_mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", i_mu."thumbnailPath")
    END as "thumbnailPath",
    jo."assignee",
    jo."tags",
    jo."dueDate" AS "operationDueDate"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  WHERE jo."assignee" = user_id
  AND jo."status" IN ('Todo', 'Ready', 'Waiting', 'In Progress', 'Paused')
  AND j."status" IN ('Ready', 'In Progress', 'Paused')
  AND j."companyId" = company_id
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
