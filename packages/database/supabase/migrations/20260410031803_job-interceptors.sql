-- =============================================================================
-- Convert legacy job triggers to event system interceptors.
--
-- AFTER INSERT -> after_sync_functions:
--   sync_insert_job_make_method:
--     Inserts a jobMakeMethod row with jobId, itemId, companyId, createdBy.
--
-- AFTER UPDATE -> sync_functions (BEFORE):
--   sync_job_complete_or_canceled:
--     When status changes to Completed or Cancelled, clears kanban jobId.
--     When status changes to Completed, sends job-completed notification
--     via the trigger edge function.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Job interceptor functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_insert_job_make_method(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy")
  VALUES (p_new->>'id', p_new->>'itemId', p_new->>'companyId', p_new->>'createdBy');
END;
$$;

CREATE OR REPLACE FUNCTION sync_job_complete_or_canceled(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  group_ids TEXT[];
BEGIN
  IF p_operation = 'UPDATE'
    AND (p_old->>'status') != (p_new->>'status')
    AND ((p_new->>'status') = 'Completed' OR (p_new->>'status') = 'Cancelled')
  THEN
    UPDATE "kanban"
    SET "jobId" = NULL
    WHERE "jobId" = p_new->>'id';

    -- Send notification on job completion
    IF (p_new->>'status') = 'Completed' THEN
      IF (p_new->>'salesOrderId') IS NULL THEN
        SELECT "inventoryJobCompletedNotificationGroup" INTO group_ids
        FROM "companySettings" WHERE "id" = p_new->>'companyId';
      ELSE
        SELECT "salesJobCompletedNotificationGroup" INTO group_ids
        FROM "companySettings" WHERE "id" = p_new->>'companyId';
      END IF;

      IF (p_new->>'assignee') IS NOT NULL THEN
        group_ids := array_append(COALESCE(group_ids, '{}'), p_new->>'assignee');
      END IF;

      IF array_length(group_ids, 1) > 0 THEN
        PERFORM util.invoke_edge_function(
          name => 'trigger',
          body => jsonb_build_object(
            'type', 'notify',
            'event', 'job-completed',
            'documentId', p_new->>'id',
            'companyId', p_new->>'companyId',
            'recipient', jsonb_build_object(
              'type', 'group',
              'groupIds', group_ids
            )
          )
        );
      END IF;
    END IF;
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- Drop legacy triggers
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS insert_job_make_method_trigger ON "job";
DROP TRIGGER IF EXISTS "job_completed_or_canceled_trigger" ON "job";


-- -----------------------------------------------------------------------------
-- Attach event triggers with interceptor arrays
-- -----------------------------------------------------------------------------

SELECT attach_event_trigger('job',
  ARRAY['sync_job_complete_or_canceled']::TEXT[],
  ARRAY['sync_insert_job_make_method']::TEXT[]
);
