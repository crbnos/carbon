-- VENDORED — Job Operation Batching primitive (issue #1010).
--
-- WHY THIS EXISTS (temporary): the cut-list refactor builds on Sid's Job
-- Operation Batching (jobOperationBatch + batch-operations). That feature is not
-- yet on `main`; its branch (origin/feat/job-operation-batching) forks from a
-- 355-commit-old base, so it cannot be merged here without dragging stale files.
-- To let cut lists build ON the batch (Brad's ask — one system, not two) this
-- migration vendors ONLY the additive batching schema the cut-list layer needs,
-- copied verbatim from that branch's 20260707135312_job-operation-batching.sql.
--
-- WHEN #1010 LANDS ON main: delete this migration and the vendored
-- batch-operations function; the real batching migration supersedes both. See
-- .ai/plans/2026-08-11-cut-lists-on-operation-batching.md.
--
-- Deliberately OMITTED vs the source migration (avoid reverting objects our
-- branch already advanced): the get_active_job_operations_by_location recreation
-- (our newest definition is identical to batching's baseline, plus batch columns
-- nothing on this branch reads yet).

-- 1. Process capability flag
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

-- 2. Recreate the "processes" view from THIS branch's newest definition
-- (20260805164827_processes-view-cut-fields). It selects p.* so it picks up
-- "batchable" (and the cut fields) automatically once re-declared.
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

-- 3. Batch status enum
DO $$ BEGIN
  CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completed', 'Cancelled');
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

-- 8. Batch planning candidates RPC. Unstarted, unbatched operations of a batchable
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
        AND j."status" IN ('Ready', 'In Progress', 'Paused'))
      OR b."status" = 'Active'
    );
$$;
