-- Batch pre-floor state. BEFORE 'Active' keeps enum sort = lifecycle order.
-- Nothing else in this file may reference the new value: a value added by
-- ALTER TYPE ... ADD VALUE cannot be used later in the same transaction, and
-- the migration runner wraps each file in one. First uses live in the
-- companion migration (batch-release-floor-gate).
ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Planned' BEFORE 'Active';

-- Simultaneous (furnace/oven: parallel load) vs Sequential (saw/laser: serial
-- queue) batch physics. Meaningful only when process.batchable = true.
DO $$ BEGIN
  CREATE TYPE "batchType" AS ENUM ('Sequential', 'Simultaneous');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchType" "batchType" NOT NULL DEFAULT 'Sequential';

-- Re-expand p.* so the view exposes the new column (CREATE OR REPLACE cannot
-- append mid-list; DROP + CREATE re-expands the star).
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

-- Coalesced batch reservation tag. operationId/jobId stay NOT NULL — a batch
-- reservation anchors those on the deterministic first member (min member op
-- id); this tag is the semantic key. The scheduling engine's per-job regen
-- delete skips tagged rows, and the batch pre-pass owns their lifecycle.
ALTER TABLE "capacityReservation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "capacityReservation" ADD CONSTRAINT "capacityReservation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "capacityReservation_jobOperationBatchId_idx"
  ON "capacityReservation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;
