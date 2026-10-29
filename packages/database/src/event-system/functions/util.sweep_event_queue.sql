CREATE OR REPLACE FUNCTION util.sweep_event_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq', 'extensions'
AS $function$
BEGIN
  -- Only visible messages count: rows hidden by a read's visibility timeout
  -- are already being drained and must not trigger a spurious wake.
  IF EXISTS (
    SELECT 1 FROM pgmq.q_event_system WHERE vt <= clock_timestamp()
  ) THEN
    PERFORM util.wake_event_queue();
  END IF;
END;
$function$;
