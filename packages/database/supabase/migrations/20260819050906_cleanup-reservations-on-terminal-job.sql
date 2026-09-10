-- Clean up capacity reservations when a job leaves active scheduling.
--
-- capacityReservation rows are a MATERIALIZED forward-schedule output for
-- Ready/In Progress/Paused jobs. When a job goes terminal
-- (Cancelled/Completed/Closed) they no longer represent real load, but nothing
-- deleted them — so a cancelled job's rows lingered (observed: J000001 held
-- Aug-17/18 reservations days after cancellation). The forecast + capacity reads
-- already filter terminal jobs out, so these are invisible dead weight, and any
-- read that forgets the status filter would resurface them as past-dated bars.
--
-- Delete at the one chokepoint every terminal path funnels through: the job
-- status write (the status route's updateJobStatus for Cancelled/Closed, and
-- complete_job_to_inventory for Completed). SECURITY DEFINER so it runs
-- regardless of the caller's grant — the DELETE policy needs production_delete
-- but a cancel only holds production_update, and the complete RPC is service
-- role. Only live (scenarioId IS NULL) rows are touched; scenario plans are left
-- alone.

-- One-time cleanup of existing orphans (idempotent — a re-run deletes nothing).
DELETE FROM "capacityReservation" cr
USING job j
WHERE j.id = cr."jobId"
  AND j."companyId" = cr."companyId"
  AND cr."scenarioId" IS NULL
  AND j.status IN ('Cancelled', 'Completed', 'Closed');

CREATE OR REPLACE FUNCTION delete_capacity_reservations_on_terminal_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned: fires on every job status write, so the caller is an ordinary
-- application role and must not control table resolution.
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM "capacityReservation"
  WHERE "jobId" = NEW.id
    AND "companyId" = NEW."companyId"
    AND "scenarioId" IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delete_capacity_reservations_on_terminal_job_trigger ON "job";
CREATE TRIGGER delete_capacity_reservations_on_terminal_job_trigger
  AFTER UPDATE OF status ON "job"
  FOR EACH ROW
  WHEN (
    NEW.status IN ('Cancelled', 'Completed', 'Closed')
    AND OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION delete_capacity_reservations_on_terminal_job();
