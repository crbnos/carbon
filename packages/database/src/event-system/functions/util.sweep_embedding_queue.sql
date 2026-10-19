CREATE OR REPLACE FUNCTION util.sweep_embedding_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq', 'extensions'
AS $function$
BEGIN
  -- Only visible messages count: rows hidden by a read's visibility timeout
  -- are already being drained.
  IF EXISTS (
    SELECT 1 FROM pgmq.q_embedding_jobs WHERE vt <= clock_timestamp()
  ) THEN
    PERFORM util.send_inngest_event('carbon/embedding-queue.process', '{}'::jsonb);
  END IF;
END;
$function$;
