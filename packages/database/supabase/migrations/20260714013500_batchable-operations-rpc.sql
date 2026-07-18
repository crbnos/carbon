-- Job Operation Batching — read side
--
-- Two SQL functions the batch planning board and schedule board consume:
--   1. get_batchable_operations(location_id) — the candidate pool for the
--      batch planning board: unstarted, unbatched job operations whose PROCESS
--      is batchable, at a location, each carrying the resolved material facets
--      (substance / grade / dimension / finish / form) of its own BOM lines so
--      the board can group + facet-filter. Operations with no material-bearing
--      BOM lines return an empty `materials` array (grouped under
--      "No material properties" by the UI).
--   2. get_active_job_operations_by_location — re-declared to surface the new
--      `jobOperationBatchId` column so the schedule board / MES kanban can badge
--      batched operations. Body is otherwise unchanged from the newest definition
--      (20260531084723_rework-serial-flow.sql).

-- 1. Candidate pool for the batch planning board -----------------------------
DROP FUNCTION IF EXISTS get_batchable_operations;
CREATE OR REPLACE FUNCTION get_batchable_operations(
  location_id TEXT,
  company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobReadableId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "priority" DOUBLE PRECISION,
  "processId" TEXT,
  "processName" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "laborTime" NUMERIC,
  "machineTime" NUMERIC,
  "operationQuantity" NUMERIC,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "customerName" TEXT,
  "locationId" TEXT,
  "materials" JSONB
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "job"."locationId" = location_id
      AND "job"."companyId" = company_id
      AND ("job"."status" = 'Ready' OR "job"."status" = 'In Progress' OR "job"."status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    rj."jobId" AS "jobReadableId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."priority",
    jo."processId",
    p."name" AS "processName",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."laborTime",
    jo."machineTime",
    jo."operationQuantity",
    i."readableId" AS "itemReadableId",
    i."name" AS "itemDescription",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    c."name" AS "customerName",
    rj."locationId",
    COALESCE(mat."materials", '[]'::jsonb) AS "materials"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  JOIN "process" p ON p.id = jo."processId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "customer" c ON rj."customerId" = c.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'itemId', jm."itemId",
        'itemReadableId', mi."readableId",
        'substance', ms."name",
        'grade', mg."name",
        'dimension', md."name",
        'finish', mfin."name",
        'form', mf."name"
      )
      ORDER BY jm."order"
    ) AS "materials"
    FROM "jobMaterial" jm
    JOIN "item" mi ON mi.id = jm."itemId"
    JOIN "material" m
      ON m.id = mi."readableId"
      AND (m."companyId" = jm."companyId" OR m."companyId" IS NULL)
    LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
    LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
    LEFT JOIN "materialGrade" mg ON mg.id = m."gradeId"
    LEFT JOIN "materialDimension" md ON md.id = m."dimensionId"
    LEFT JOIN "materialFinish" mfin ON mfin.id = m."finishId"
    WHERE jm."jobOperationId" = jo."id"
  ) mat ON true
  WHERE p."batchable" = true
    AND jo."companyId" = company_id
    AND jo."jobOperationBatchId" IS NULL
    AND (jo."status" = 'Todo' OR jo."status" = 'Ready' OR jo."status" = 'Waiting')
    -- Exclude operations already started via a timer (a recorded productionEvent)
    -- even if their status has not flipped yet. This mirrors the batch-operations
    -- edge function's create/add eligibility gate, so the board never surfaces a
    -- candidate that would be rejected on drop.
    AND NOT EXISTS (
      SELECT 1 FROM "productionEvent" pe
      WHERE pe."jobOperationId" = jo."id"
        AND pe."companyId" = jo."companyId"
    )
  ORDER BY rj."dueDate" NULLS LAST, jo."priority", jo."order";
END;
$$ LANGUAGE plpgsql;

-- 2. Surface jobOperationBatchId on the schedule-board function --------------
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
  "jobOperationBatchId" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
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
    jo."jobOperationBatchId"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "customer" c ON rj."customerId" = c.id
  LEFT JOIN "salesOrder" so ON rj."salesOrderId" = so.id
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu.id
   WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;
