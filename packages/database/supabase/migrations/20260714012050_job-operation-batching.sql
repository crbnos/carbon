-- Job Operation Batching
-- Some processes (laser cutting, heat treat, plating) can run multiple jobs at
-- once. Batchability is a property of the PROCESS, not the item or routing step.
-- A jobOperationBatch is a lightweight join over N real jobOperation rows.

-- 1. The capability flag (master data)
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchable" BOOLEAN NOT NULL DEFAULT false;

-- Recreate the "processes" view to include the new column.
-- (PostgreSQL views with SELECT * snapshot columns at creation time.)
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

-- 2. The operation batch
CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

CREATE TABLE "jobOperationBatch" (
    "id" TEXT NOT NULL DEFAULT id(),
    "readableId" TEXT NOT NULL,                -- BAT000001 (getNextSequence)
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,                 -- every member matches this
    "workCenterId" TEXT,                       -- where the batch runs; propagated to members
    "locationId" TEXT NOT NULL,                -- planning board is per-location
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
    -- Composite, tenant-scoped FKs to process / workCenter / location are added
    -- below (section 2b) so a batch's companyId cannot disagree with the company
    -- of the resources it references. They need (id, companyId) unique targets on
    -- those parent tables, which the CREATE TABLE cannot declare inline.
    CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

CREATE INDEX "jobOperationBatch_companyId_idx" ON "jobOperationBatch" ("companyId");
CREATE INDEX "jobOperationBatch_createdBy_idx" ON "jobOperationBatch" ("createdBy");
CREATE INDEX "jobOperationBatch_processId_idx" ON "jobOperationBatch" ("processId");
CREATE INDEX "jobOperationBatch_locationId_idx" ON "jobOperationBatch" ("locationId");

ALTER TABLE "public"."jobOperationBatch" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."jobOperationBatch"
  FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));

CREATE POLICY "INSERT" ON "public"."jobOperationBatch"
  FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[]));

CREATE POLICY "UPDATE" ON "public"."jobOperationBatch"
  FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[]));

CREATE POLICY "DELETE" ON "public"."jobOperationBatch"
  FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[]));

-- 2b. Tenant-integrity composite FKs -----------------------------------------
-- A batch's companyId must match the company of every resource it references.
-- Composite FKs need (id, companyId) unique targets on the parent tables. On
-- process / workCenter / location, "id" is already the primary key, so a UNIQUE
-- ("id", "companyId") is trivially satisfied by existing data (no duplicate id
-- exists) and these master-data tables are small, so the constraint builds fast.
ALTER TABLE "process"
  ADD CONSTRAINT "process_id_companyId_key" UNIQUE ("id", "companyId");
ALTER TABLE "workCenter"
  ADD CONSTRAINT "workCenter_id_companyId_key" UNIQUE ("id", "companyId");
ALTER TABLE "location"
  ADD CONSTRAINT "location_id_companyId_key" UNIQUE ("id", "companyId");

-- jobOperationBatch is empty at creation, but add each FK NOT VALID + a separate
-- VALIDATE to match the low-lock pattern used on the large tables below.
ALTER TABLE "jobOperationBatch" ADD CONSTRAINT "jobOperationBatch_processId_fkey"
  FOREIGN KEY ("processId", "companyId")
  REFERENCES "process"("id", "companyId") NOT VALID;
ALTER TABLE "jobOperationBatch" VALIDATE CONSTRAINT "jobOperationBatch_processId_fkey";

-- ON DELETE SET NULL ("workCenterId") (PG15+ column list) nulls only the work
-- center pointer when a work center is deleted; companyId stays intact (NOT NULL).
ALTER TABLE "jobOperationBatch" ADD CONSTRAINT "jobOperationBatch_workCenterId_fkey"
  FOREIGN KEY ("workCenterId", "companyId")
  REFERENCES "workCenter"("id", "companyId") ON DELETE SET NULL ("workCenterId") NOT VALID;
ALTER TABLE "jobOperationBatch" VALIDATE CONSTRAINT "jobOperationBatch_workCenterId_fkey";

ALTER TABLE "jobOperationBatch" ADD CONSTRAINT "jobOperationBatch_locationId_fkey"
  FOREIGN KEY ("locationId", "companyId")
  REFERENCES "location"("id", "companyId") NOT VALID;
ALTER TABLE "jobOperationBatch" VALIDATE CONSTRAINT "jobOperationBatch_locationId_fkey";

-- 3. Membership — one nullable FK on jobOperation.
-- Added NOT VALID so the ADD does NOT scan every existing jobOperation row under
-- an ACCESS EXCLUSIVE lock. The matching VALIDATE CONSTRAINT runs in a SEPARATE
-- migration (20260714012100_batching-fk-validate.sql) — a separate transaction
-- so its scan takes only a SHARE UPDATE EXCLUSIVE lock (concurrent reads/writes
-- allowed). Keeping VALIDATE in this same file would hold the ADD's exclusive
-- lock through the scan and defeat the purpose.
ALTER TABLE "jobOperation" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL ("jobOperationBatchId") NOT VALID;
CREATE INDEX "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 4. Batch-tagged timers (while running; slices keep the tag for auditability).
-- Same NOT VALID pattern — productionEvent is a large, hot table; the VALIDATE
-- lives in the separate follow-up migration noted above.
ALTER TABLE "productionEvent" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL ("jobOperationBatchId") NOT VALID;
CREATE INDEX "productionEvent_jobOperationBatchId_idx"
  ON "productionEvent" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 5. Sequence for readable ids (existing companies; new companies via seed.data.ts)
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
FROM "company" ON CONFLICT DO NOTHING;
