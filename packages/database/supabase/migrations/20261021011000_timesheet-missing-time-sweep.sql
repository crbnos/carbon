-- Government Contracting 5a: the daily missing-time check.
--
-- In DCAA timekeeping mode an employee enters time every day. Each day at
-- 12:00 UTC pg_cron asks whether any company runs DCAA mode, and only then
-- wakes the `timesheet-missing-time` Inngest function, which notifies each
-- employee with no time entered for yesterday (in the company's timezone) and
-- each manager about their employees. Same shape as the sweeps of
-- 20261004183512_scheduled-jobs-from-database.sql. Like every wake from
-- Postgres, it needs the Vault secret `inngest_event_url`.

CREATE OR REPLACE FUNCTION util.timesheet_missing_time_has_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "companySettings" WHERE "timekeepingControls" = 'DCAA'
  );
$$;

CREATE OR REPLACE FUNCTION util.sweep_timesheet_missing_time()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF util.timesheet_missing_time_has_work() THEN
    PERFORM util.send_inngest_event('carbon/timesheet-missing-time.process', '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION util.timesheet_missing_time_has_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION util.sweep_timesheet_missing_time() FROM PUBLIC;

DO $$
DECLARE
  job record;
BEGIN
  FOR job IN
    SELECT * FROM (VALUES
      ('timesheet-missing-time-sweeper', '0 12 * * *', 'SELECT util.sweep_timesheet_missing_time();')
    ) AS t(name, schedule, command)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job.name) THEN
      PERFORM cron.unschedule(job.name);
    END IF;
    PERFORM cron.schedule(job.name, job.schedule, job.command);
  END LOOP;
END;
$$;
