

-- Add existing records with null embeddings to background jobs queue
SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'item'
  )
)
FROM item 
WHERE embedding IS NULL;

SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'supplier'
  )
)
FROM supplier
WHERE embedding IS NULL;

SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'customer'
  )
)
FROM customer
WHERE embedding IS NULL;
