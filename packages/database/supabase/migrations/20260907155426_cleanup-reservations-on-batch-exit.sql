-- Clean up the coalesced batch reservation when a batch leaves the floor.
--
-- A Released batch's capacityReservation row (tagged "jobOperationBatchId") is
-- deliberately SPARED by every other delete path: the per-job regen delete
-- skips tagged rows, and the scheduler's batch pre-pass rewrites rows only for
-- batches still Active/Completing. So nothing retired the row when the batch
-- itself exited the floor:
--   - Completed: the row lingered and — because batch-tagged rows are also
--     spared by every snapshot status filter — kept BLOCKING the work center's
--     future capacity for a run that already finished, and kept rendering on
--     the forecast.
--   - Unreleased (Active/Completing → Planned): the row lingered while the
--     members went back to per-op scheduling — the machine window was
--     double-booked.
-- (Dissolve needs nothing here: the FK's column-list SET NULL untags the row,
-- which makes it an ordinary reservation for the anchor job, and that job's
-- next regen sweeps it.)
--
-- Delete at the one chokepoint every exit funnels through: the batch status
-- write (batch-operations' `complete` Phase 2 for Completed, `unrelease` for
-- Planned). Mirrors delete_capacity_reservations_on_terminal_job. SECURITY
-- DEFINER so it runs regardless of the caller's grant — the DELETE policy
-- needs production_delete while an unrelease only holds production_update.
-- Only live (scenarioId IS NULL) rows are touched.

-- One-time cleanup of existing orphans (idempotent — a re-run deletes nothing).
DELETE FROM "capacityReservation" cr
USING "jobOperationBatch" b
WHERE b."id" = cr."jobOperationBatchId"
  AND b."companyId" = cr."companyId"
  AND cr."scenarioId" IS NULL
  AND b."status" NOT IN ('Active', 'Completing');

CREATE OR REPLACE FUNCTION delete_capacity_reservations_on_batch_exit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned: fires on every batch status write, so the caller is an ordinary
-- application role and must not control table resolution.
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM "capacityReservation"
  WHERE "jobOperationBatchId" = NEW."id"
    AND "companyId" = NEW."companyId"
    AND "scenarioId" IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delete_capacity_reservations_on_batch_exit_trigger ON "jobOperationBatch";
CREATE TRIGGER delete_capacity_reservations_on_batch_exit_trigger
  AFTER UPDATE OF "status" ON "jobOperationBatch"
  FOR EACH ROW
  WHEN (
    NEW."status" IN ('Planned', 'Completed')
    AND OLD."status" IS DISTINCT FROM NEW."status"
  )
  EXECUTE FUNCTION delete_capacity_reservations_on_batch_exit();
