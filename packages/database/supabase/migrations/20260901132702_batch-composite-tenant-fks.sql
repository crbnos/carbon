-- Tenant-integrity FKs for jobOperationBatch (same pattern as
-- 20260703143904_composite-tenant-fks.sql for customer/supplier).
--
-- The batch table's location/process/workCenter FKs were single-column, so the
-- database accepted a row in company A pointing at company B's location, process,
-- or work center — only the edge function's own validation stood in the way.
-- Converting them to composite (<column>, "companyId") -> (id, "companyId") makes
-- Postgres itself reject a cross-tenant reference from any future caller.
--
-- jobOperationBatch is new on this branch (no released data), so the constraints
-- are added directly — no NOT VALID staging needed.

-- Composite FK targets need a unique key on (id, "companyId"); id alone is
-- already the PK on all three parents, so the composite is trivially unique.
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
  -- PG15 column-list SET NULL: only workCenterId is nulled on delete, so the
  -- NOT NULL companyId survives (precedent: 20260810100100_workflows-foundation.sql).
  ADD CONSTRAINT "jobOperationBatch_workCenterId_fkey"
    FOREIGN KEY ("workCenterId", "companyId")
    REFERENCES "workCenter"("id", "companyId")
    ON DELETE SET NULL ("workCenterId");
