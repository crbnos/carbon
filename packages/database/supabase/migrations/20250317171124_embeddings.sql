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
ALTER TABLE "customer" ADD COLUMN "embedding" halfvec(384);

CREATE INDEX ON "item" USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX ON "supplier" USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX ON "customer" USING hnsw (embedding halfvec_cosine_ops);


-- Schema for utility functions
CREATE SCHEMA util;

-- Utility function to get the Supabase project URL (required for Edge Functions)
CREATE FUNCTION util.api_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  api_url text;
BEGIN
  SELECT "apiUrl" INTO api_url FROM "config" LIMIT 1;
  RETURN api_url;
END;
$$;

CREATE FUNCTION util.anon_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  anon_key text;
BEGIN
  SELECT "anonKey" INTO  anon_key FROM "config" LIMIT 1;
  RETURN anon_key;
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
      'Bearer ' || util.anon_key()
  END;

  -- Perform async HTTP request to the edge function
  PERFORM net.http_post(
    url => util.api_url() || '/functions/v1/' || name,
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

-- Generic function to queue embedding jobs
DROP FUNCTION IF EXISTS util.queue_embeddings;
CREATE OR REPLACE FUNCTION util.queue_embeddings(
  record_id text,
  embedding_table text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pgmq.send(
    queue_name => 'embedding_jobs',
    msg => jsonb_build_object(
      'id', record_id,
      'table', embedding_table
    )
  );
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


-- Recreate functions with updated logic
CREATE OR REPLACE FUNCTION public.create_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  CASE new.type
    WHEN 'Part' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Part', new.id, '/x/part/' || new.id, new."companyId");
    WHEN 'Service' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Service', new.id, '/x/service/' || new.id, new."companyId");
    WHEN 'Tool' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Tool', new.id, '/x/tool/' || new.id, new."companyId");
    WHEN 'Consumable' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Consumable', new.id, '/x/consumable/' || new.id, new."companyId");
    WHEN 'Material' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Material', new.id, '/x/material/' || new.id, new."companyId");
    WHEN 'Fixture' THEN
      INSERT INTO public.search(name, description, entity, uuid, link, "companyId")
      VALUES (new."readableId", new.name || ' ' || COALESCE(new.description, ''), 'Fixture', new.id, '/x/fixture/' || new.id, new."companyId");
  END CASE;

  PERFORM util.queue_embeddings(new.id, 'item');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.update_item_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old.name <> new.name OR old.description <> new.description OR old."readableId" <> new."readableId" OR old.type <> new.type) THEN
    UPDATE public.search 
    SET name = new."readableId", 
        description = new.name || ' ' || COALESCE(new.description, ''),
        link = CASE new.type
          WHEN 'Part' THEN '/x/part/' || new.id
          WHEN 'Service' THEN '/x/service/' || new.id
          WHEN 'Tool' THEN '/x/tool/' || new.id
          WHEN 'Consumable' THEN '/x/consumable/' || new.id
          WHEN 'Material' THEN '/x/material/' || new.id
          WHEN 'Fixture' THEN '/x/fixture/' || new.id
        END
    WHERE entity = 'Part' AND uuid = new.id AND "companyId" = new."companyId";

    PERFORM util.queue_embeddings(new.id, 'item');
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.create_customer_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new.name, 'Customer', new.id, '/x/customer/' || new.id, new."companyId");
  PERFORM util.queue_embeddings(new.id, 'customer');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.update_customer_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old.name <> new.name) THEN
    UPDATE public.search SET name = new.name
    WHERE entity = 'Customer' AND uuid = new.id;
    PERFORM util.queue_embeddings(new.id, 'customer');
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.create_supplier_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new.name, 'Supplier', new.id, '/x/supplier/' || new.id, new."companyId");
  PERFORM util.queue_embeddings(new.id, 'supplier');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.update_supplier_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old.name <> new.name) THEN
    UPDATE public.search SET name = new.name
    WHERE entity = 'Supplier' AND uuid = new.id;
    PERFORM util.queue_embeddings(new.id, 'supplier');
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.items_search(
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  p_company_id text
)
RETURNS TABLE (
  id text,
  "readableId" text,
  name text,
  description text,
  similarity float
)
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT
    item.id,
    item."readableId",
    item.name,
    item.description,
    1 - (item.embedding <=> query_embedding) AS similarity
  FROM item
  WHERE 1 - (item.embedding <=> query_embedding) > match_threshold
  AND "companyId" = p_company_id
  ORDER BY (item.embedding <=> query_embedding) ASC
  LIMIT LEAST(match_count, 10);
$$;

CREATE OR REPLACE FUNCTION public.suppliers_search(
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  p_company_id text
)
RETURNS TABLE (
  id text,
  name text,
  similarity float
)
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT
    supplier.id,
    supplier.name,
    1 - (supplier.embedding <=> query_embedding) AS similarity
  FROM supplier
  WHERE 1 - (supplier.embedding <=> query_embedding) > match_threshold
  AND "companyId" = p_company_id
  ORDER BY (supplier.embedding <=> query_embedding) ASC
  LIMIT LEAST(match_count, 10);
$$;



