CREATE OR REPLACE FUNCTION public.sync_job_recompute_service_line(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'salesOrderLineId') IS NULL THEN RETURN; END IF;

  -- Only when the completion state actually changed.
  IF (p_old->>'status') IS NOT DISTINCT FROM (p_new->>'status') THEN RETURN; END IF;
  IF NOT (
    (p_old->>'status') IN ('Completed', 'Closed')
    OR (p_new->>'status') IN ('Completed', 'Closed')
  ) THEN
    RETURN;
  END IF;

  PERFORM recompute_service_line_fulfillment(
    p_new->>'salesOrderLineId',
    p_new->>'companyId',
    p_new->>'updatedBy'
  );
END;
$function$;
