CREATE OR REPLACE FUNCTION public.sync_set_initial_dependency_status(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Don't update if operation is already Done, In Progress, or Canceled
  IF EXISTS (
    SELECT 1
    FROM "jobOperation"
    WHERE id = p_new->>'operationId'
      AND status IN ('Done', 'In Progress', 'Canceled')
  ) THEN
    RETURN;
  END IF;

  -- Check if there are any incomplete dependencies
  IF EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
    WHERE dep."operationId" = p_new->>'operationId'
      AND jo.status != 'Done'
  ) THEN
    UPDATE "jobOperation"
    SET status = 'Waiting'
    WHERE id = p_new->>'operationId';
  ELSE
    UPDATE "jobOperation"
    SET status = 'Ready'
    WHERE id = p_new->>'operationId';
  END IF;
END;
$function$;
