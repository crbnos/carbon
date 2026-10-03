CREATE OR REPLACE FUNCTION util.wake_event_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  PERFORM util.send_inngest_event('carbon/event-queue.process', '{}'::jsonb);
END;
$function$;
