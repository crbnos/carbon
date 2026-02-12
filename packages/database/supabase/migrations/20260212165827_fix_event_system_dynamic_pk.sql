-- Fix dispatch_event_batch to dynamically find primary key column
-- instead of hardcoding 'id'

-- Helper function to get primary key column name for a table
CREATE OR REPLACE FUNCTION public.get_primary_key_column(p_table_name TEXT)
RETURNS TEXT AS $$
DECLARE
  pk_column TEXT;
BEGIN
  -- First try to get primary key
  SELECT a.attname INTO pk_column
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    AND i.indisprimary
  LIMIT 1;
  
  -- If no primary key, try to get any unique index column
  IF pk_column IS NULL THEN
    SELECT a.attname INTO pk_column
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = ('"' || p_table_name || '"')::regclass
    LIMIT 1;
  END IF;
  
  RETURN COALESCE(pk_column, 'id');
END;
$$ LANGUAGE plpgsql STABLE;

-- Updated dispatch_event_batch function with dynamic primary key support
CREATE OR REPLACE FUNCTION public.dispatch_event_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, extensions
AS $$
DECLARE
  sub RECORD;
  msg_batch JSONB[];
  rec_company_id TEXT;
  has_subs BOOLEAN;
  current_actor_id TEXT;
  pk_column TEXT;
  query_text TEXT;
BEGIN
  -- Guard: Skip if we're in a sync operation (prevents circular triggers)
  -- Set this via: SET LOCAL "app.sync_in_progress" = 'true';
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Capture the current authenticated user (will be NULL for service role operations)
  current_actor_id := auth.uid()::TEXT;

  -- Get the primary key column for this table
  pk_column := public.get_primary_key_column(TG_TABLE_NAME);

  -- A. Extract Company ID (Partition Key)
  -- We need this to efficiently filter subscriptions.
  -- NOTE: For STATEMENT-level triggers, OLD/NEW are not available.
  -- We must query the transition tables (batched_new/batched_old) instead.
  IF TG_OP = 'DELETE' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_old t LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  ELSE -- UPDATE
    SELECT t."companyId" INTO rec_company_id FROM batched_new t LIMIT 1;
  END IF;

  -- Performance Guard: If record has no companyId, we can't match any subscriptions.
  IF rec_company_id IS NULL THEN RETURN NULL; END IF;

  -- B. Fast Check: Any active subscriptions for this Company + Table + Op?
  SELECT EXISTS (
    SELECT 1 FROM "eventSystemSubscription" 
    WHERE "table" = TG_TABLE_NAME 
    AND "companyId" = rec_company_id -- Use the Index!
    AND "active" = TRUE 
    AND TG_OP = ANY("operations")
  ) INTO has_subs;

  IF NOT has_subs THEN RETURN NULL; END IF;


  -- C. Iterate Subscriptions (Filtered by Company)
  FOR sub IN 
    SELECT * FROM "eventSystemSubscription" 
    WHERE "table" = TG_TABLE_NAME 
      AND "companyId" = rec_company_id -- Use the Index!
      AND "active" = TRUE 
      AND TG_OP = ANY("operations")
  LOOP
    
    -- D. Build Batch Payload
    -- Filter rows using the subscription's JSONB filter
    -- Only include rows belonging to the correct companyId (Redundant but safe)

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
                        ''timestamp'', NOW()
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
                        ''timestamp'', NOW()
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
                        ''timestamp'', NOW()
                    )
                )
            )
            FROM batched_new n
            JOIN batched_old o ON n.%I = o.%I
            WHERE n."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(n)::jsonb @> $9)
        ', pk_column, pk_column, pk_column);
        
        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id, 
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter;
    END IF;

    -- E. Send Batch (PGMQ)
    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
    END IF;

  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispatch_event_batch() IS 'Dispatches database events to PGMQ with dynamic primary key support and auth.uid() captured as actorId';
