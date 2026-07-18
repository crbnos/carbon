-- Job Operation Batching — validate the large-table FKs (separate transaction)
--
-- The jobOperation / productionEvent membership FKs were added NOT VALID in
-- 20260714012050_job-operation-batching.sql so the ADD would not scan those big,
-- hot tables under an ACCESS EXCLUSIVE lock. This migration runs the VALIDATE in
-- its OWN transaction: the scan takes only a SHARE UPDATE EXCLUSIVE lock, which
-- permits concurrent SELECT/INSERT/UPDATE/DELETE. Splitting the VALIDATE into a
-- separate migration (not just a separate statement in the same file) is what
-- actually avoids the lock — a same-file VALIDATE would inherit the ADD's
-- exclusive lock for the duration of the scan.

ALTER TABLE "jobOperation"
  VALIDATE CONSTRAINT "jobOperation_jobOperationBatchId_fkey";

ALTER TABLE "productionEvent"
  VALIDATE CONSTRAINT "productionEvent_jobOperationBatchId_fkey";
