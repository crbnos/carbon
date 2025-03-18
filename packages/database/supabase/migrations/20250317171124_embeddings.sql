 -- Example: enable the "vector" extension.
CREATE EXTENSION vector
WITH
  SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pgmq;

-- For async HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net
WITH
  SCHEMA extensions;

-- For scheduled processing and retries
-- (pg_cron will create its own schema)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- For clearing embeddings during updates
CREATE EXTENSION IF NOT EXISTS hstore
WITH
  SCHEMA extensions;

COMMIT;

ALTER TABLE "item" ADD COLUMN "embedding" halfvec(384);
ALTER TABLE "supplier" ADD COLUMN "embedding" halfvec(384);

CREATE INDEX ON "item" USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX ON "supplier" USING hnsw (embedding halfvec_cosine_ops);


-- Schema for utility functions
CREATE SCHEMA util;

-- Utility function to get the Supabase project URL (required for Edge Functions)
CREATE FUNCTION util.project_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  api_url text;
  anon_key text;
BEGIN
  SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
  RETURN api_url;
END;
$$;

-- Generic function to invoke any Edge Function
CREATE OR REPLACE FUNCTION util.invoke_edge_function(
  name text,
  body jsonb,
  timeout_milliseconds int = 5 * 60 * 1000  -- default 5 minute timeout
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  headers_raw text;
  auth_header text;
BEGIN
  -- If we're in a PostgREST session, reuse the request headers for authorization
  headers_raw := current_setting('request.headers', true);

  -- Only try to parse if headers are present
  auth_header := CASE
    WHEN headers_raw IS NOT NULL THEN
      (headers_raw::json->>'authorization')
    ELSE
      NULL
  END;

  -- Perform async HTTP request to the edge function
  PERFORM net.http_post(
    url => util.project_url() || '/functions/v1/' || name,
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header
    ),
    body => body,
    timeout_milliseconds => timeout_milliseconds
  );
END;
$$;

-- Generic trigger function to clear a column on update
CREATE OR REPLACE FUNCTION util.clear_column()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    clear_column text := TG_ARGV[0];
BEGIN
    NEW := NEW #= hstore(clear_column, NULL);
    RETURN NEW;
END;
$$;

-- Queue for processing embedding jobs
SELECT pgmq.create('embedding_jobs');

-- Generic trigger function to queue embedding jobs
CREATE OR REPLACE FUNCTION util.queue_embeddings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  content_function text = TG_ARGV[0];
  embedding_column text = TG_ARGV[1];
BEGIN
  PERFORM pgmq.send(
    queue_name => 'embedding_jobs',
    msg => jsonb_build_object(
      'id', NEW.id,
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'contentFunction', content_function,
      'embeddingColumn', embedding_column
    )
  );
  RETURN NEW;
END;
$$;

-- Function to process embedding jobs from the queue
CREATE OR REPLACE FUNCTION util.process_embeddings(
  batch_size INT = 10,
  max_requests INT = 10,
  timeout_milliseconds INT = 5 * 60 * 1000 -- default 5 minute timeout
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
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
  -- Finally aggregate all batches into array
  SELECT array_agg(batch_array)
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
$$;

-- Schedule the embedding processing
SELECT
  cron.schedule(
    'process-embeddings',
    '10 seconds',
    $$
    SELECT util.process_embeddings();
    $$
  );

