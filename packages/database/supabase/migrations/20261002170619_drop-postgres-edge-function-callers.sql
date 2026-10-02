-- Nothing calls an edge function from Postgres any more.
--
-- The 10 s `process-embeddings` cron rings util.sweep_embedding_queue() (the
-- previous migration) instead of batching the queue into the `embed` edge
-- function, so util.process_embeddings and the helpers it posted through go.
-- No CASCADE: a caller nobody knew about fails this migration instead of
-- silently losing its function.

SELECT cron.schedule(
  'process-embeddings',
  '10 seconds',
  $$
    SELECT util.sweep_embedding_queue();
  $$
);

DROP FUNCTION IF EXISTS util.process_embeddings(INTEGER, INTEGER, INTEGER);
-- A database that ran this branch's first cut has the no-argument doorbell.
DROP FUNCTION IF EXISTS util.process_embeddings();
DROP FUNCTION IF EXISTS util.invoke_edge_function(TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS util.api_url();
DROP FUNCTION IF EXISTS util.anon_key();
