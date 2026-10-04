CREATE OR REPLACE FUNCTION public.sync_set_job_operation_in_progress(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only set to In Progress if endTime is NULL (event is starting, not already ended)
  IF (p_new->>'endTime') IS NULL THEN
    UPDATE "jobOperation"
    SET "status" = 'In Progress'
    WHERE id = p_new->>'jobOperationId';
  END IF;

  -- Set parent job to In Progress if it is still Ready
  UPDATE "job"
  SET "status" = 'In Progress'
  WHERE id = (
    SELECT "jobId" FROM "jobOperation" WHERE id = p_new->>'jobOperationId'
  )
  AND "status" = 'Ready';
END;
$function$;
