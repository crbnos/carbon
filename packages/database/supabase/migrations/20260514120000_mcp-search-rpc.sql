-- packages/database/supabase/migrations/20260514120000_mcp-search-rpc.sql
--
-- Semantic search RPC for MCP tools. Joins the active mcpToolVersion rows to
-- their mcpToolEmbedding and ranks by cosine distance to the caller-supplied
-- query embedding. Filters on module / classification are applied in SQL.
-- Returns a `totalCount` per row so the caller can keep the existing paged
-- output format without a second roundtrip.

BEGIN;

CREATE OR REPLACE FUNCTION public.search_mcp_tools(
  query_embedding vector,
  filter_module text DEFAULT NULL,
  filter_classification text DEFAULT NULL,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE (
  "toolId"         text,
  "module"         text,
  "name"           text,
  "description"    text,
  "classification" text,
  "distance"       float,
  "totalCount"     bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH filtered AS (
    SELECT v.*, e."embedding"
    FROM "mcpToolVersion" v
    INNER JOIN "mcpToolEmbedding" e ON e."toolVersionId" = v."id"
    WHERE v."isActive"
      AND (filter_module IS NULL OR v."module" = filter_module)
      AND (filter_classification IS NULL OR v."classification" = filter_classification)
  ),
  total AS (SELECT count(*) AS c FROM filtered)
  SELECT
    f."toolId",
    f."module",
    f."name",
    f."description",
    f."classification",
    (f."embedding" <=> query_embedding)::float AS distance,
    (SELECT c FROM total) AS "totalCount"
  FROM filtered f
  ORDER BY f."embedding" <=> query_embedding
  LIMIT result_limit OFFSET result_offset;
$$;

GRANT EXECUTE ON FUNCTION public.search_mcp_tools(vector, text, text, int, int) TO service_role;

COMMIT;
