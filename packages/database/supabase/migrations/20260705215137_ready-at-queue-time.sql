ALTER TABLE "jobOperation" ADD COLUMN "readyAt" TIMESTAMP WITH TIME ZONE;

-- Stamp the instant an operation becomes Ready. Ready-transitions are written
-- from multiple functions (dependency triggers, finish interceptor, scheduler),
-- so a single BEFORE trigger is the one reliable point.
CREATE OR REPLACE FUNCTION set_job_operation_ready_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'Ready' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'Ready') AND NEW."readyAt" IS NULL THEN
    NEW."readyAt" = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ready_at_on_job_operation ON "jobOperation";
CREATE TRIGGER set_ready_at_on_job_operation
BEFORE INSERT OR UPDATE OF "status" ON "jobOperation"
FOR EACH ROW EXECUTE FUNCTION set_job_operation_ready_at();

-- Queue time: Ready -> first production event
CREATE OR REPLACE VIEW "jobOperationQueueTime" WITH(SECURITY_INVOKER=true) AS
SELECT
  jo."id",
  jo."companyId",
  jo."jobId",
  jo."workCenterId",
  jo."readyAt",
  MIN(pe."startTime") AS "firstEventAt",
  EXTRACT(EPOCH FROM (MIN(pe."startTime") - jo."readyAt")) / 3600.0 AS "queueHours"
FROM "jobOperation" jo
LEFT JOIN "productionEvent" pe ON pe."jobOperationId" = jo."id"
WHERE jo."readyAt" IS NOT NULL
GROUP BY jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt";
