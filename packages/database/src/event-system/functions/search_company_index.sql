CREATE OR REPLACE FUNCTION public.search_company_index(p_company_id text, p_query text, p_entity_types text[], p_limit integer DEFAULT 20)
 RETURNS TABLE(id bigint, "entityType" text, "entityId" text, title text, description text, link text, tags text[], metadata jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_table_name TEXT;
  v_sanitized TEXT;
  v_tsquery_text TEXT;
  v_like_pattern TEXT;
  v_prefix_pattern TEXT;
BEGIN
  v_table_name := 'searchIndex_' || p_company_id;

  -- Strip tsquery operators; keep alphanumerics, whitespace, `_`, `-`.
  v_sanitized := regexp_replace(coalesce(trim(p_query), ''), '[^[:alnum:][:space:]_-]', ' ', 'g');
  v_sanitized := trim(regexp_replace(v_sanitized, '\s+', ' ', 'g'));

  IF v_sanitized = '' THEN
    RETURN;
  END IF;

  -- Build `tok1:* & tok2:* & ...` for the FTS branch (word-prefix match).
  SELECT string_agg(tok || ':*', ' & ')
    INTO v_tsquery_text
    FROM regexp_split_to_table(v_sanitized, '\s+') AS tok
   WHERE tok ~ '[[:alnum:]]';

  -- Defensive fallback - should not trigger in practice since v_sanitized is
  -- non-empty and contains at least one alnum, but keep the function robust.
  IF v_tsquery_text IS NULL OR v_tsquery_text = '' THEN
    RETURN;
  END IF;

  -- Substring + prefix patterns use the ORIGINAL sanitized string so users
  -- can search by any slice of a stored title (e.g. "269" inside "S000269").
  v_like_pattern   := '%' || v_sanitized || '%';
  v_prefix_pattern := v_sanitized || '%';

  RETURN QUERY EXECUTE format('
    WITH q AS (
      SELECT to_tsquery(''english'', $1) AS query
    )
    SELECT
      si.id,
      si."entityType",
      si."entityId",
      si.title,
      si.description,
      si.link,
      si.tags,
      si.metadata
    FROM %I si, q
    WHERE si."entityType" = ANY($2)
      AND (
        si."searchVector" @@ q.query
        OR si.title ILIKE $4
        OR si.description ILIKE $4
      )
    ORDER BY
      -- Boost rows where the title starts with the query (e.g. typing "S000"
      -- pins "S000269" to the top).
      CASE WHEN si.title ILIKE $5 THEN 0 ELSE 1 END,
      ts_rank_cd(si."searchVector", q.query) DESC,
      si.id DESC
    LIMIT $3
  ', v_table_name)
  USING v_tsquery_text, p_entity_types, p_limit, v_like_pattern, v_prefix_pattern;
END;
$function$;
