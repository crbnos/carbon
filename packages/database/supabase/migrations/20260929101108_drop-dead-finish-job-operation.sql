-- finish_job_operation() has had no trigger since 20260410031809, which replaced
-- it with the sync_finish_job_operation interceptor; 20260417000300 recreated the
-- body anyway. It still invoked the `issue` and `trigger` edge functions over
-- pg_net, which are being removed. No CASCADE: a trigger nobody knew about fails
-- this migration instead of silently disappearing.
DROP FUNCTION IF EXISTS finish_job_operation();
