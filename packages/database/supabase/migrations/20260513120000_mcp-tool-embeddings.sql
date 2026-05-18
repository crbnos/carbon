-- packages/database/supabase/migrations/20260513120000_mcp-tool-embeddings.sql
--
-- MCP tool versions + embeddings, fed by a pgmq queue consumed by the
-- mcp-embeddings-worker edge function via pg_cron.

BEGIN;

CREATE TABLE "mcpToolVersion" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "toolId"          text NOT NULL,
  "module"          text NOT NULL,
  "name"            text NOT NULL,
  "description"     text NOT NULL,
  "classification"  text NOT NULL CHECK ("classification" IN ('READ','WRITE','DESTRUCTIVE')),
  "descriptionHash" text NOT NULL UNIQUE,
  "isActive"        boolean NOT NULL DEFAULT false,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "mcpToolVersion_active_unique"
  ON "mcpToolVersion"("toolId") WHERE "isActive";

CREATE INDEX "mcpToolVersion_toolId_idx" ON "mcpToolVersion"("toolId");

CREATE TABLE "mcpToolEmbedding" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "toolVersionId" uuid NOT NULL UNIQUE REFERENCES "mcpToolVersion"("id") ON DELETE CASCADE,
  "embedding"     vector(768) NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "mcpToolEmbedding_embedding_idx"
  ON "mcpToolEmbedding" USING hnsw ("embedding" vector_cosine_ops);

-- updatedAt trigger for both tables.
CREATE OR REPLACE FUNCTION util.mcp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mcpToolVersion_touch"
  BEFORE UPDATE ON "mcpToolVersion"
  FOR EACH ROW EXECUTE FUNCTION util.mcp_touch_updated_at();

CREATE TRIGGER "mcpToolEmbedding_touch"
  BEFORE UPDATE ON "mcpToolEmbedding"
  FOR EACH ROW EXECUTE FUNCTION util.mcp_touch_updated_at();

-- pgmq queue: app sends one message per boot containing the manifest contentHash.
SELECT pgmq.create('mcp_embeddings_queue');

-- Thin RPC wrappers so the app + edge function can call pgmq without touching
-- the pgmq schema directly.
CREATE OR REPLACE FUNCTION public.pgmq_send(queue_name text, message jsonb)
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgmq.send(queue_name, message);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_send(text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pgmq_read(queue_name text, vt int, qty int)
RETURNS SETOF pgmq.message_record LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM pgmq.read(queue_name, vt, qty);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_read(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.pgmq_delete(queue_name text, msg_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgmq.delete(queue_name, msg_id);
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_delete(text, bigint) TO service_role;

-- Atomic manifest application: inserts new versions + their embeddings, then
-- flips isActive in a single transaction (function body = implicit txn).
CREATE OR REPLACE FUNCTION public.apply_mcp_manifest(
  new_rows jsonb,
  active_hashes text[],
  active_tool_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row jsonb;
  v_version_id uuid;
BEGIN
  -- Insert new versions; ignore conflicts (concurrent worker invocations).
  FOR row IN SELECT * FROM jsonb_array_elements(new_rows)
  LOOP
    INSERT INTO "mcpToolVersion" (
      "toolId", "module", "name", "description", "classification", "descriptionHash", "isActive"
    ) VALUES (
      row->>'toolId',
      row->>'module',
      row->>'name',
      row->>'description',
      row->>'classification',
      row->>'descriptionHash',
      false
    )
    ON CONFLICT ("descriptionHash") DO UPDATE
      SET "updatedAt" = now()
    RETURNING "id" INTO v_version_id;

    INSERT INTO "mcpToolEmbedding" ("toolVersionId", "embedding")
    VALUES (
      v_version_id,
      (SELECT array_agg(x::float)::vector FROM jsonb_array_elements_text(row->'embedding') AS x)
    )
    ON CONFLICT ("toolVersionId") DO NOTHING;
  END LOOP;

  -- Atomic active swap.
  UPDATE "mcpToolVersion" SET "isActive" = false
    WHERE "toolId" = ANY(active_tool_ids) AND "isActive";
  UPDATE "mcpToolVersion" SET "isActive" = true
    WHERE "descriptionHash" = ANY(active_hashes);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_mcp_manifest(jsonb, text[], text[]) TO service_role;

-- pg_cron polls the queue every 30s and invokes the edge function.
SELECT cron.schedule(
  'mcp-embeddings-worker',
  '30 seconds',
  $$
    DO $cron$
    BEGIN
      IF EXISTS (SELECT 1 FROM pgmq.metrics('mcp_embeddings_queue') WHERE queue_length > 0) THEN
        PERFORM util.invoke_edge_function(
          name => 'mcp-embeddings-worker',
          body => jsonb_build_object('triggeredAt', now())
        );
      END IF;
    END;
    $cron$;
  $$
);

COMMIT;
