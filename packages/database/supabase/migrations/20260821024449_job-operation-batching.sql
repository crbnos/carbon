-- Job Operation Batching (spec: .ai/specs/2026-08-21-job-operation-batching.md)
-- Batchability is a property of the process. Batches group real jobOperations;
-- jobs are never merged and the BOM is never modified.
-- NOTE: an operation batch is unrelated to lot/batch tracking (batchNumber/trackedEntity).

-- 1. Process capability flag
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

-- 2. Recreate the "processes" view from its NEWEST definition (20260721004140,
-- verified byte-identical to this body). The view selects p.* so it picks up
-- "batchable" automatically once re-declared.
DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT
      "processId",
      array_agg("workCenterId"::text) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";

-- 3. Batch status enum. Complete from day one; there is no cancel state (dissolve
--    deletes the row, so nothing needs one). 'Completing' is the durable resume marker
--    for the two-phase, idempotent batch completion (Active -> Completing ->
--    Completed): a Phase-2 failure leaves the batch 'Completing' and a retry
--    re-runs only the post-commit steps.
DO $$ BEGIN
  CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completing', 'Completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. The operation batch: a lightweight join over N real jobOperation rows.
CREATE TABLE IF NOT EXISTS "jobOperationBatch" (
  "id" TEXT NOT NULL DEFAULT id(),
  "readableId" TEXT NOT NULL,               -- BAT000001 (getNextSequence)
  "companyId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,                -- every member matches this
  "workCenterId" TEXT,                      -- where the batch runs; propagated to members
  "locationId" TEXT NOT NULL,               -- planning board is per-location
  "status" "jobOperationBatchStatus" NOT NULL DEFAULT 'Active',
  "notes" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationBatch_processId_fkey" FOREIGN KEY ("processId")
    REFERENCES "process"("id"),
  CONSTRAINT "jobOperationBatch_workCenterId_fkey" FOREIGN KEY ("workCenterId")
    REFERENCES "workCenter"("id") ON DELETE SET NULL,
  CONSTRAINT "jobOperationBatch_locationId_fkey" FOREIGN KEY ("locationId")
    REFERENCES "location"("id"),
  CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

CREATE INDEX IF NOT EXISTS "jobOperationBatch_companyId_idx" ON "jobOperationBatch" ("companyId");
CREATE INDEX IF NOT EXISTS "jobOperationBatch_processId_idx" ON "jobOperationBatch" ("processId");
CREATE INDEX IF NOT EXISTS "jobOperationBatch_workCenterId_idx" ON "jobOperationBatch" ("workCenterId");
CREATE INDEX IF NOT EXISTS "jobOperationBatch_locationId_idx" ON "jobOperationBatch" ("locationId");
CREATE INDEX IF NOT EXISTS "jobOperationBatch_createdBy_idx" ON "jobOperationBatch" ("createdBy");

ALTER TABLE "public"."jobOperationBatch" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationBatch";
CREATE POLICY "SELECT" ON "public"."jobOperationBatch"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationBatch";
CREATE POLICY "INSERT" ON "public"."jobOperationBatch"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationBatch";
CREATE POLICY "UPDATE" ON "public"."jobOperationBatch"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationBatch";
CREATE POLICY "DELETE" ON "public"."jobOperationBatch"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- 5. Membership FK on jobOperation (nullable — inert until a batch is created).
ALTER TABLE "jobOperation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 6. Batch tag on productionEvent (timers while running; per-member slices keep the tag).
ALTER TABLE "productionEvent" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "productionEvent_jobOperationBatchId_idx"
  ON "productionEvent" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 7. Sequence for readable ids (existing companies; new companies via seed-company).
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT DO NOTHING;

-- 8. Re-declare get_active_job_operations_by_location from the NEWEST definition
-- (20260531084723_rework-serial-flow.sql). Feeds the ERP schedule board AND the MES
-- kanban. Additive only: three new columns + two LEFT JOINs; everything else verbatim.
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
   WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;

-- 9. Batch planning candidates RPC. Unstarted, unbatched operations of a batchable
-- process at a location (plus current members of Active batches, to render lanes),
-- each with a "materials" JSONB array of its BOM lines' material properties.
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
        AND j."status" IN ('Ready', 'In Progress', 'Paused')
        -- Exclude operations already started via a timer (a recorded
        -- productionEvent), even if their status has not flipped yet. Mirrors the
        -- batch-operations edge-fn assertEligible gate so the board never lists an
        -- op that would be rejected on drop.
        AND NOT EXISTS (
          SELECT 1 FROM "productionEvent" pe
          WHERE pe."jobOperationId" = jo."id"
            AND pe."companyId" = jo."companyId"
        ))
      -- Render lanes for both Active batches (drag targets) and Completing batches
      -- (read-only — a stuck completion stays visible where the planner looks).
      OR b."status" IN ('Active', 'Completing')
    );
$$;
