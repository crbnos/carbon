-- Job Operation Batching — consolidated branch migration
-- (spec: .ai/specs/2026-08-21-job-operation-batching.md
--  + .ai/specs/2026-09-04-batch-release-and-scheduling.md)
--
-- Squashes this branch's nine incremental migrations into one final-state file
-- (20260821024449, 20260831170323, 20260831204743, 20260831204806,
--  20260901132702, 20260904151137, 20260904214536, 20260904214627,
--  20260904223831). Fully idempotent: a database that already applied the
-- incremental files no-ops through this one.
--
-- Batchability is a property of the process; batches group real jobOperations
-- (jobs are never merged, the BOM is never modified). Lifecycle:
-- Planned (pre-floor) -> Active (displayed "Released") -> Completing -> Completed.
-- Floor rule (membership handoff): an op in a batch is floor-visible iff the
-- BATCH is released; an op in no batch follows its JOB's release. A Released
-- batch schedules as ONE unit: a single capacityReservation tagged
-- jobOperationBatchId, duration setup(max) + sum|max(run) per process.batchType.
-- NOTE: an operation batch is unrelated to lot/batch tracking.

-- ============================================================================
-- 1. Process capability: batchable flag, batch physics, compatibility rules
-- ============================================================================
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

-- Sequential (saw/laser: serial queue, run = sum of members) vs Simultaneous
-- (furnace/oven: parallel load, run = max of members).
DO $$ BEGIN
  CREATE TYPE "batchType" AS ENUM ('Sequential', 'Simultaneous');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchType" "batchType" NOT NULL DEFAULT 'Sequential';

ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchRules" JSONB;
COMMENT ON COLUMN "process"."batchRules" IS 'Per-dimension batch compatibility levels (must|guide|ignore); NULL = defaults (substance/grade/dimension guide, form/finish/item ignore).';

-- Re-declare the processes view once; p.* picks up all three columns.
-- Forked verbatim from 20260721004140 (the newest pre-branch definition).
DROP VIEW IF EXISTS "processes";
CREATE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
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

-- ============================================================================
-- 2. Work-center advisory batch capacity (+ view re-declarations)
-- ============================================================================
ALTER TABLE "workCenter" ADD COLUMN IF NOT EXISTS "batchCapacity" NUMERIC;
ALTER TABLE "workCenter" ADD COLUMN IF NOT EXISTS "minimumBatchQuantity" NUMERIC;

COMMENT ON COLUMN "workCenter"."batchCapacity" IS 'Advisory maximum pieces per batch run; NULL means no capacity model.';
COMMENT ON COLUMN "workCenter"."minimumBatchQuantity" IS 'Advisory minimum pieces to justify a batch run; NULL means no minimum.';

-- Re-declare views to pick up the new wc.* columns. DROP first, not CREATE OR REPLACE:
-- the new wc.* columns expand before "locationName", which REPLACE rejects as a rename.
-- Forked verbatim from 20260811123619_widen-sales-production-scale.sql. No dependent views.
DROP VIEW IF EXISTS "workCenters";
CREATE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
CREATE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;

-- ============================================================================
-- 3. Batch status enum + jobOperationBatch table (final state)
-- ============================================================================
-- Complete lifecycle from day one; no cancel state (dissolve deletes the row).
-- 'Planned' = pre-floor planning state; 'Active' is displayed "Released";
-- 'Completing' is the durable resume marker for two-phase completion.
DO $$ BEGIN
  CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Planned', 'Active', 'Completing', 'Completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A database that applied only the PRE-release branch migrations has the type
-- without 'Planned'. Adding an enum value cannot share a transaction with its
-- first use, so refuse loudly instead of half-applying.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'jobOperationBatchStatus' AND e.enumlabel = 'Planned'
  ) THEN
    RAISE EXCEPTION 'jobOperationBatchStatus exists without ''Planned'' — this database applied a superseded incremental batch migration. Reset the local database, or run ALTER TYPE "jobOperationBatchStatus" ADD VALUE ''Planned'' BEFORE ''Active'' in its own transaction first.';
  END IF;
END $$;

-- Composite tenant-FK targets (id alone is the PK on all three parents, so the
-- composite key is trivially unique; pattern: 20260703143904_composite-tenant-fks.sql).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'location_id_companyId_key' AND conrelid = '"location"'::regclass
  ) THEN
    ALTER TABLE "location" ADD CONSTRAINT "location_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workCenter_id_companyId_key' AND conrelid = '"workCenter"'::regclass
  ) THEN
    ALTER TABLE "workCenter" ADD CONSTRAINT "workCenter_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'process_id_companyId_key' AND conrelid = '"process"'::regclass
  ) THEN
    ALTER TABLE "process" ADD CONSTRAINT "process_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;
END $$;

-- The operation batch: a lightweight join over N real jobOperation rows.
-- Location/process/workCenter FKs are added below as composite tenant FKs.
CREATE TABLE IF NOT EXISTS "jobOperationBatch" (
  "id" TEXT NOT NULL DEFAULT id(),
  "readableId" TEXT NOT NULL,               -- BAT000001 (getNextSequence)
  "companyId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,                -- every member matches this
  "workCenterId" TEXT,                      -- where the batch runs; propagated to members
  "locationId" TEXT NOT NULL,               -- planning board is per-location
  "status" "jobOperationBatchStatus" NOT NULL DEFAULT 'Planned',
  "notes" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

-- Databases from the incremental path default 'Active'; normalize.
ALTER TABLE "jobOperationBatch" ALTER COLUMN "status" SET DEFAULT 'Planned';

-- Composite tenant FKs: Postgres itself rejects a cross-tenant location/process/
-- work-center reference. PG15 column-list SET NULL nulls ONLY workCenterId so
-- the NOT NULL companyId survives a work-center delete.
ALTER TABLE "jobOperationBatch"
  DROP CONSTRAINT IF EXISTS "jobOperationBatch_locationId_fkey",
  DROP CONSTRAINT IF EXISTS "jobOperationBatch_processId_fkey",
  DROP CONSTRAINT IF EXISTS "jobOperationBatch_workCenterId_fkey";

ALTER TABLE "jobOperationBatch"
  ADD CONSTRAINT "jobOperationBatch_locationId_fkey"
    FOREIGN KEY ("locationId", "companyId")
    REFERENCES "location"("id", "companyId"),
  ADD CONSTRAINT "jobOperationBatch_processId_fkey"
    FOREIGN KEY ("processId", "companyId")
    REFERENCES "process"("id", "companyId"),
  ADD CONSTRAINT "jobOperationBatch_workCenterId_fkey"
    FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId")
    ON DELETE SET NULL ("workCenterId");

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

-- ============================================================================
-- 4. Membership + batch tags (jobOperation, productionEvent, capacityReservation)
-- ============================================================================
-- PG15 column-list SET NULL on all three: a batch delete nulls ONLY the tag,
-- never the NOT NULL companyId (a company-cascade delete fires these in
-- non-deterministic order against live members).
ALTER TABLE "jobOperation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation"
  DROP CONSTRAINT IF EXISTS "jobOperation_jobOperationBatchId_fkey";
ALTER TABLE "jobOperation"
  ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
CREATE INDEX IF NOT EXISTS "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- Timers while the batch runs; per-member slices keep the tag for provenance.
ALTER TABLE "productionEvent" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
ALTER TABLE "productionEvent"
  DROP CONSTRAINT IF EXISTS "productionEvent_jobOperationBatchId_fkey";
ALTER TABLE "productionEvent"
  ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
CREATE INDEX IF NOT EXISTS "productionEvent_jobOperationBatchId_idx"
  ON "productionEvent" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- Coalesced batch reservation tag: a Released batch schedules as ONE
-- capacityReservation row. operationId/jobId stay NOT NULL — the row anchors
-- them on the deterministic first member; this tag is the semantic key. The
-- engine's per-job regen delete skips tagged rows and the snapshot reads
-- always include them (see packages/ee batch-scheduler.ts).
ALTER TABLE "capacityReservation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
ALTER TABLE "capacityReservation"
  DROP CONSTRAINT IF EXISTS "capacityReservation_jobOperationBatchId_fkey";
ALTER TABLE "capacityReservation"
  ADD CONSTRAINT "capacityReservation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
CREATE INDEX IF NOT EXISTS "capacityReservation_jobOperationBatchId_idx"
  ON "capacityReservation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- ============================================================================
-- 5. Readable-id sequence (existing companies; new companies via seed-company)
-- ============================================================================
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. Batch planner candidates RPC (final: live jobs + Planned lanes + jobStatus)
-- ============================================================================
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

-- ============================================================================
-- 7. Floor RPC (final: membership-handoff rule; feeds ERP board + MES kanban)
-- ============================================================================
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
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;
