-- Tag queue messages with `workflowRunId`, read from the `workflow_run_id` JWT
-- claim: null unless a running workflow made the write. Also restores the
-- composite-key UPDATE pairing from 20260717143448, reverted by 20260721184852.

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
  current_workflow_run_id TEXT;
  pk_column TEXT;
  pk_join TEXT;
  query_text TEXT;
  did_enqueue BOOLEAN := FALSE;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  current_actor_id := auth.uid()::TEXT;
  current_workflow_run_id :=
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'workflow_run_id';
  pk_column := public.get_primary_key_column(TG_TABLE_NAME);

  -- Pair UPDATE rows on the full key: single-column pairing cross-joins rows
  -- on tables with composite identity.
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
                    ''workflowRunId'', $10,
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
              current_actor_id, TG_TABLE_NAME, TG_OP, sub.filter,
              current_workflow_run_id;
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
$$;

COMMENT ON FUNCTION public.dispatch_event_batch() IS 'Dispatches database events to PGMQ and wakes the Inngest drainer via wake_event_queue() (once per transaction). Uses clock_timestamp() so each event has a unique microsecond timestamp even when batched. Stamps workflowRunId from the workflow_run_id JWT claim so workflow-made writes are distinguishable.';
