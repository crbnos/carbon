CREATE OR REPLACE FUNCTION util.wake_event_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  api_url TEXT;
  anon_key TEXT;
BEGIN
  SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;

  IF api_url IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    api_url || '/functions/v1/event-wake',
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'wake_event_queue failed: % %', SQLERRM, SQLSTATE;
END;
$function$;
