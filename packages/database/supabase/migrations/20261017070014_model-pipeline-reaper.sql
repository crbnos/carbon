-- The model pipeline's backstop, run by pg_cron every 30 minutes.
--
-- 1. A job the runner gave up on settles itself (`onFailure`), but a run that
--    dies without one (cancelled, an outage) leaves its row Queued or
--    Processing and the viewer spinning. After 8 hours — longer than the
--    runner waits: 6 hours queued plus the 40 minute plan budget
--    (packages/jobs/src/inngest/functions/tasks/assembler-client.ts) — such a
--    row is marked Failed, so the viewer offers Retry.
-- 2. The statement handler `queue_model_pipeline` starts every new model. A
--    start lost on the way (pg_net, Inngest unreachable) is sent again once:
--    each row created between 60 and 30 minutes ago that is still Idle. A
--    30-minute window on a 30-minute schedule sees each row exactly once.
--
-- Helpers live in `util`, like the other sweepers: a public function is an
-- API endpoint, and one that reaches pg_net must not be.

CREATE OR REPLACE FUNCTION util.reap_model_pipeline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stale TIMESTAMPTZ := now() - interval '8 hours';
  model RECORD;
BEGIN
  UPDATE "modelUpload"
  SET "optimizeStatus" = 'Failed',
      "optimizeError" = 'The optimise was interrupted. Retry it from the viewer.',
      "updatedAt" = now()
  WHERE "optimizeStatus" IN ('Queued', 'Processing')
    AND COALESCE("updatedAt", "createdAt") < stale;

  UPDATE "modelUpload"
  SET "processingStatus" = 'Failed',
      "processingError" = 'The conversion was interrupted. Convert the model again.',
      "updatedAt" = now()
  WHERE "processingStatus" IN ('Queued', 'Processing')
    AND COALESCE("updatedAt", "createdAt") < stale;

  UPDATE "assemblyPlanJob"
  SET "status" = 'Failed',
      "error" = 'The job was interrupted. Run it again.',
      "updatedAt" = now()
  WHERE "status" IN ('Queued', 'Processing')
    AND COALESCE("updatedAt", "createdAt") < stale;

  FOR model IN
    SELECT "id", "companyId"
    FROM "modelUpload"
    WHERE "optimizeStatus" = 'Idle'
      AND "createdAt" >= now() - interval '60 minutes'
      AND "createdAt" < now() - interval '30 minutes'
      AND "modelPath" NOT LIKE '\_templates/%'
  LOOP
    PERFORM util.send_inngest_event(
      'carbon/model-optimize',
      jsonb_build_object('modelUploadId', model."id", 'companyId', model."companyId")
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION util.reap_model_pipeline() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'model-pipeline-reaper') THEN
    PERFORM cron.unschedule('model-pipeline-reaper');
  END IF;
  PERFORM cron.schedule('model-pipeline-reaper', '13,43 * * * *', 'SELECT util.reap_model_pipeline();');
END;
$$;
