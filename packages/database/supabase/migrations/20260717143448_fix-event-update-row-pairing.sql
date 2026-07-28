-- Fix event-system UPDATE row pairing for tables with composite identity.
--
-- dispatch_event_batch() paired old/new transition rows by a SINGLE key column
-- from get_primary_key_column(). For tables whose row identity is composite —
-- e.g. "itemPlanning", unique on ("itemId", "locationId") with no PK — a single
-- statement updating several rows of the same parent cross-joined old×new rows
-- (every before-row paired with every after-row of the same item) and emitted
-- spurious audit diffs, including phantom "locationId changed" entries. Bulk
-- writers that trigger this exist today: the CSV importer updates all of an
-- item's itemPlanning rows in one statement, as do the demand/production
-- planning SQL functions.
--
-- Fix: pair on EVERY column of the table's primary key (or, when the table has
-- no PK, its smallest unique index). recordId keeps using the legacy
-- single-column resolver so audit entity resolution is unchanged.

CREATE OR REPLACE FUNCTION public.get_primary_key_columns(p_table_name TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pk_columns TEXT[];
BEGIN
  -- All columns of the primary key
  SELECT array_agg(a.attname ORDER BY a.attnum) INTO pk_columns
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    AND i.indisprimary;

  -- No PK: key columns of the smallest valid, non-partial, non-expression
  -- unique index. Partial/expression indexes don't guarantee row identity for
  -- every row, and INCLUDE columns (positions past indnkeyatts) aren't part of
  -- the uniqueness constraint — the slice keeps key columns only.
  IF pk_columns IS NULL THEN
    SELECT array_agg(a.attname ORDER BY a.attnum) INTO pk_columns
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid
      AND a.attnum = ANY ((i.indkey::int2[])[1:i.indnkeyatts])
    WHERE i.indexrelid = (
      SELECT i2.indexrelid
      FROM pg_index i2
      WHERE i2.indrelid = ('"' || p_table_name || '"')::regclass
        AND i2.indisunique
        AND i2.indisvalid
        AND i2.indpred IS NULL
        AND i2.indexprs IS NULL
      ORDER BY i2.indnkeyatts ASC
      LIMIT 1
    );
  END IF;

  -- Last resort: the legacy single-column resolver
  IF pk_columns IS NULL OR array_length(pk_columns, 1) IS NULL THEN
    pk_columns := ARRAY[public.get_primary_key_column(p_table_name)];
  END IF;

  RETURN pk_columns;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_event_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq', 'extensions'
AS $function$
DECLARE
  sub RECORD;
  msg_batch JSONB[];
  rec_company_id TEXT;
  has_subs BOOLEAN;
  current_actor_id TEXT;
  pk_column TEXT;
  pk_join TEXT;
  query_text TEXT;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  current_actor_id := auth.uid()::TEXT;
  pk_column := public.get_primary_key_column(TG_TABLE_NAME);

  -- Pair UPDATE transition rows on the table's full row identity, not just
  -- the first key column — single-column pairing cross-joins rows on tables
  -- with composite identity (see migration header).
  SELECT string_agg(format('n.%I = o.%I', col, col), ' AND ')
    INTO pk_join
  FROM unnest(public.get_primary_key_columns(TG_TABLE_NAME)) AS col;

  IF TG_OP = 'DELETE' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_old t LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  ELSE
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  END IF;

  IF rec_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  ) INTO has_subs;

  IF NOT has_subs THEN RETURN NULL; END IF;

  FOR sub IN
    SELECT * FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
  LOOP

    IF TG_OP = 'INSERT' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', row_to_json(t)::jsonb,
                        ''old'', null,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;

    ELSIF TG_OP = 'DELETE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', t.%I::TEXT,
                        ''new'', null,
                        ''old'', row_to_json(t)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_old t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', pk_column);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;

    ELSIF TG_OP = 'UPDATE' THEN
        query_text := format('
            SELECT array_agg(
                jsonb_build_object(
                    ''subscriptionId'', $1,
                    ''triggerType'', $2,
                    ''handlerType'', $3,
                    ''handlerConfig'', $4,
                    ''companyId'', $5,
                    ''actorId'', $6,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', n.%I::TEXT,
                        ''new'', row_to_json(n)::jsonb,
                        ''old'', row_to_json(o)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new n
            JOIN batched_old o ON %s
            WHERE n."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(n)::jsonb @> $9)
        ', pk_column, pk_join);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;
    END IF;

    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
    END IF;

  END LOOP;

  RETURN NULL;
END;
$function$;
