CREATE OR REPLACE FUNCTION public.sync_job_complete_or_canceled(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
        PERFORM util.send_inngest_event(
          'carbon/notify',
          jsonb_build_object(
            'companyId', p_new->>'companyId',
            'documentId', p_new->>'id',
            'event', 'job-completed',
            'recipient', jsonb_build_object(
              'type', 'group',
              'groupIds', group_ids
            ),
            'from', 'system'
          )
        );
      END IF;
    END IF;
  END IF;
END;
$function$;
