-- util.send_inngest_event() returned silently when the Vault secret
-- inngest_event_url was missing, so a deployment that never set it lost every
-- database-raised event (job-completed notifications, the event-queue wake-up)
-- with nothing in the logs to say why. It still never raises; it now says so.
-- Body copied forward from 20261002170250_send-inngest-events-from-postgres.sql.
CREATE OR REPLACE FUNCTION util.send_inngest_event(p_name TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  event_url TEXT;
BEGIN
  SELECT decrypted_secret INTO event_url
  FROM vault.decrypted_secrets
  WHERE name = 'inngest_event_url';
  IF event_url IS NULL THEN
    RAISE LOG 'send_inngest_event(%) skipped: Vault secret inngest_event_url is not set', p_name;
    RETURN;
  END IF;
  PERFORM net.http_post(
    event_url,
    jsonb_build_object('name', p_name, 'data', COALESCE(p_data, '{}'::jsonb)),
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json')
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_inngest_event(%) failed: % %', p_name, SQLERRM, SQLSTATE;
END;
$$;
