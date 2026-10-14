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
  current_workflow_run_id TEXT;
  pk_columns TEXT[];
  pk_join TEXT;
  record_id_expr TEXT;
  query_text TEXT;
  did_enqueue BOOLEAN := FALSE;
  ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];
BEGIN
  current_actor_id := auth.uid()::TEXT;
  current_workflow_run_id :=
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'workflow_run_id';
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
      AND ("handlerType" NOT IN ('SYNC','WEBHOOK','WORKFLOW')
           OR current_setting('app.sync_in_progress', true) IS DISTINCT FROM 'true')
  ) INTO has_subs;

  IF NOT has_subs THEN RETURN NULL; END IF;

  -- Looked up only once a subscription exists: almost no company subscribes
  -- to most tables, and this catalog read ran on every write statement.
  pk_columns := public.get_primary_key_columns(TG_TABLE_NAME);

  -- Pair UPDATE rows on the full key: single-column pairing cross-joins rows
  -- on tables with composite identity.
  SELECT string_agg(format('n.%I = o.%I', col, col), ' AND ')
    INTO pk_join
  FROM unnest(pk_columns) AS col;

  -- recordId names one row. "id" does that wherever it is part of the key
  -- ((id, companyId) tables); a primary key without one is every column joined
  -- by ':', since a single column of it is shared by many rows. A table with no
  -- primary key keeps the one column it always sent: the audit log files
  -- itemPlanning (unique on itemId + locationId) under its itemId.
  -- %1$s is the row alias.
  IF 'id' = ANY(pk_columns) THEN
    record_id_expr := '%1$s."id"::TEXT';
  ELSIF EXISTS (
    SELECT 1 FROM pg_index WHERE indrelid = TG_RELID AND indisprimary
  ) THEN
    SELECT 'concat_ws('':'', ' || string_agg(format('%%1$s.%I::TEXT', col), ', ') || ')'
      INTO record_id_expr
    FROM unnest(pk_columns) AS col;
  ELSE
    record_id_expr := format('%%1$s.%I::TEXT', public.get_primary_key_column(TG_TABLE_NAME));
  END IF;

  FOR sub IN
    SELECT * FROM "eventSystemSubscription"
    WHERE "table" = TG_TABLE_NAME
      AND "companyId" = rec_company_id
      AND "active" = TRUE
      AND TG_OP = ANY("operations")
      AND ("handlerType" NOT IN ('SYNC','WEBHOOK','WORKFLOW')
           OR current_setting('app.sync_in_progress', true) IS DISTINCT FROM 'true')
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
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', %s,
                        ''new'', row_to_json(t)::jsonb,
                        ''old'', null,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_new t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', format(record_id_expr, 't'));

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;

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
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', %s,
                        ''new'', null,
                        ''old'', row_to_json(t)::jsonb,
                        ''timestamp'', clock_timestamp()
                    )
                )
            )
            FROM batched_old t
            WHERE t."companyId" = $5
              AND ($9 = ''{}''::jsonb OR row_to_json(t)::jsonb @> $9)
        ', format(record_id_expr, 't'));

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;

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
                    ''workflowRunId'', $10,
                    ''event'', jsonb_build_object(
                        ''table'', $7,
                        ''operation'', $8,
                        ''recordId'', %s,
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
              AND (NOT $11 OR (to_jsonb(n) - $12) IS DISTINCT FROM (to_jsonb(o) - $12))
        ', format(record_id_expr, 'n'), pk_join);

        EXECUTE query_text INTO msg_batch
        USING sub.id, TG_LEVEL, sub."handlerType", sub."config", rec_company_id,
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id,
              sub."handlerType" IN ('AUDIT', 'SEARCH', 'EMBEDDING'),
              ignored_columns;
    END IF;

    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
      did_enqueue := TRUE;
    END IF;

  END LOOP;

  -- Wake the Inngest drainer once per transaction: the GUC is txn-local, so a
  -- bulk import posts a single doorbell instead of one per statement.
  IF did_enqueue
     AND current_setting('carbon.event_wake_sent', true) IS DISTINCT FROM 'true' THEN
    PERFORM util.wake_event_queue();
    PERFORM set_config('carbon.event_wake_sent', 'true', true);
  END IF;

  RETURN NULL;
END;
$function$;
