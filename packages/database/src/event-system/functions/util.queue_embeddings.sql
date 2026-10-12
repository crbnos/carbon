CREATE OR REPLACE FUNCTION util.queue_embeddings(record_id text, embedding_table text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pgmq.send(
    queue_name => 'embedding_jobs',
    msg => jsonb_build_object(
      'id', record_id,
      'table', embedding_table
    )
  );
END;
$function$;
