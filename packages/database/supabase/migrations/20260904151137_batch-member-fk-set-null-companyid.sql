-- Fix the batch-member composite FKs' ON DELETE action.
--
-- 20260821024449_job-operation-batching.sql added composite FKs from
-- jobOperation and productionEvent to jobOperationBatch:
--
--   FOREIGN KEY ("jobOperationBatchId", "companyId")
--   REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
--
-- A column-list-less SET NULL on a MULTI-column FK nulls EVERY referencing
-- column, including "companyId" — which is NOT NULL on both tables. Deleting a
-- jobOperationBatch while a member row still references it then raises
-- `null value in column "companyId" violates not-null constraint` and aborts.
-- The edge function always detaches members before deleting a batch, so the
-- normal dissolve path is shielded — but a `DELETE FROM company` cascade (the
-- batch and its members are all ON DELETE CASCADE from company, in
-- non-deterministic order) can fire the batch's SET NULL against live members
-- and fail the company delete.
--
-- The PG15 column-list form nulls ONLY jobOperationBatchId, so companyId
-- survives (same fix the workCenter FK uses in
-- 20260901132702_batch-composite-tenant-fks.sql:56).

ALTER TABLE "jobOperation"
  DROP CONSTRAINT IF EXISTS "jobOperation_jobOperationBatchId_fkey";
ALTER TABLE "jobOperation"
  ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");

ALTER TABLE "productionEvent"
  DROP CONSTRAINT IF EXISTS "productionEvent_jobOperationBatchId_fkey";
ALTER TABLE "productionEvent"
  ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
