-- Cut lists group operations, not just material.
--
-- Brad's framing: "cut list is essentially batch processing or work order
-- stitching — we want to group operations together (many times by a
-- characteristic like the material it's made out of)."
--
-- The first pass grouped demand by material and settled material cost back per
-- job, but never touched the operations. So a saw run consumed the tube and
-- returned the drop while every served job's cutting operation sat at Todo,
-- and the operator still opened each job in MES to close it — the exact
-- sign-into-every-job problem the feature exists to remove.
--
-- Adding the operation link to the line closes that: confirming a run posts a
-- production quantity per served operation, and Carbon's existing
-- sync_update_job_operation_quantities trigger advances quantityComplete and
-- flips the operation to Done.
--
-- Nullable on purpose — a line cut to stock (no job) has no operation, and so
-- does a line whose BOM row was never pinned to a routing step.
ALTER TABLE "cutListLine"
  ADD COLUMN IF NOT EXISTS "jobOperationId" TEXT;

ALTER TABLE "cutListLine"
  DROP CONSTRAINT IF EXISTS "cutListLine_jobOperationId_fkey";
ALTER TABLE "cutListLine"
  ADD CONSTRAINT "cutListLine_jobOperationId_fkey"
  FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "cutListLine_jobOperationId_idx"
  ON "cutListLine" ("jobOperationId");

-- How many pieces of this material one finished part consumes, snapshotted
-- from the BOM line when the run is built. Cutting 40 pieces at 4 per part
-- completes 10 parts, not 40 — without this the operation would be credited
-- with the piece count and close far too early.
ALTER TABLE "cutListLine"
  ADD COLUMN IF NOT EXISTS "piecesPerParent" NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE "cutListLine"
  DROP CONSTRAINT IF EXISTS "cutListLine_piecesPerParent_check";
ALTER TABLE "cutListLine"
  ADD CONSTRAINT "cutListLine_piecesPerParent_check"
  CHECK ("piecesPerParent" > 0);
