CREATE OR REPLACE FUNCTION util.process_embeddings(batch_size integer DEFAULT 10, max_requests integer DEFAULT 10, timeout_milliseconds integer DEFAULT ((5 * 60) * 1000))
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  job_batches JSONB[];
  batch JSONB;
BEGIN
  WITH
    -- First get jobs and assign batch numbers
    numbered_jobs AS (
      SELECT
        message || jsonb_build_object('jobId', msg_id) AS job_info,
        (row_number() OVER (ORDER BY 1) - 1) / batch_size AS batch_num
      FROM pgmq.read(
        queue_name => 'embedding_jobs',
        vt => timeout_milliseconds / 1000,
        qty => max_requests * batch_size
      )
    ),
    -- Then group jobs into batches
    batched_jobs AS (
      SELECT
        jsonb_agg(job_info) AS batch_array,
        batch_num
      FROM numbered_jobs
      GROUP BY batch_num
    )
  -- Finally aggregate all batches into array, defaulting to an empty array
  -- (FOREACH errors on NULL arrays, e.g. when the queue has no pending jobs)
  SELECT COALESCE(array_agg(batch_array), ARRAY[]::JSONB[])
  FROM batched_jobs
  INTO job_batches;

  -- Invoke the embed edge function for each batch
  FOREACH batch IN ARRAY job_batches LOOP
    PERFORM util.invoke_edge_function(
      name => 'embed',
      body => batch,
      timeout_milliseconds => timeout_milliseconds
    );
  END LOOP;
END;
$function$;
