-- Add auth.uid() capture to event system
-- This allows event handlers (like audit log) to know who triggered the event

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
BEGIN
  -- Guard: Skip if we're in a sync operation (prevents circular triggers)
  -- Set this via: SET LOCAL "app.sync_in_progress" = 'true';
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Capture the current authenticated user (will be NULL for service role operations)
  current_actor_id := auth.uid()::TEXT;

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
        SELECT array_agg(
            jsonb_build_object(
                'subscriptionId', sub.id,
                'triggerType', TG_LEVEL,
                'handlerType', sub."handlerType",
                'handlerConfig', sub."config",
                'companyId', rec_company_id,
                'actorId', current_actor_id,
                'event', jsonb_build_object(
                    'table', TG_TABLE_NAME, 
                    'operation', TG_OP, 
                    'recordId', t.id, 
                    'new', row_to_json(t)::jsonb, 
                    'old', null,
                    'timestamp', NOW()
                )
            )
        ) INTO msg_batch
        FROM batched_new t
        WHERE t."companyId" = rec_company_id
          AND (sub.filter = '{}'::jsonb OR row_to_json(t)::jsonb @> sub.filter);

    ELSIF TG_OP = 'DELETE' THEN
        SELECT array_agg(
            jsonb_build_object(
                'subscriptionId', sub.id,
                'triggerType', TG_LEVEL,
                'handlerType', sub."handlerType",
                'handlerConfig', sub."config",
                'companyId', rec_company_id,
                'actorId', current_actor_id,
                'event', jsonb_build_object(
                    'table', TG_TABLE_NAME, 
                    'operation', TG_OP, 
                    'recordId', t.id, 
                    'new', null, 
                    'old', row_to_json(t)::jsonb,
                    'timestamp', NOW()
                )
            )
        ) INTO msg_batch
        FROM batched_old t
        WHERE t."companyId" = rec_company_id
          AND (sub.filter = '{}'::jsonb OR row_to_json(t)::jsonb @> sub.filter);

    ELSIF TG_OP = 'UPDATE' THEN
        SELECT array_agg(
            jsonb_build_object(
                'subscriptionId', sub.id,
                'triggerType', TG_LEVEL,
                'handlerType', sub."handlerType",
                'handlerConfig', sub."config",
                'companyId', rec_company_id,
                'actorId', current_actor_id,
                'event', jsonb_build_object(
                    'table', TG_TABLE_NAME, 
                    'operation', TG_OP, 
                    'recordId', n.id, 
                    'new', row_to_json(n)::jsonb, 
                    'old', row_to_json(o)::jsonb,
                    'timestamp', NOW()
                )
            )
        ) INTO msg_batch
        FROM batched_new n
        JOIN batched_old o ON n.id = o.id
        WHERE n."companyId" = rec_company_id
          AND (sub.filter = '{}'::jsonb OR row_to_json(n)::jsonb @> sub.filter);
    END IF;

    -- E. Send Batch (PGMQ)
    IF msg_batch IS NOT NULL AND array_length(msg_batch, 1) > 0 THEN
      PERFORM pgmq.send_batch('event_system', msg_batch);
    END IF;

  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispatch_event_batch() IS 'Dispatches database events to PGMQ with auth.uid() captured as actorId for audit purposes';
