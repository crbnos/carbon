CREATE OR REPLACE FUNCTION public.sync_on_maintenance_dispatch_complete(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_new->>'status') = 'Completed' AND ((p_old->>'status') IS NULL OR (p_old->>'status') != 'Completed')) THEN
    RETURN;
  END IF;

  -- End all active events for this dispatch
  UPDATE "maintenanceDispatchEvent"
  SET
    "endTime" = COALESCE((p_new->>'completedAt')::timestamptz, NOW()),
    "updatedBy" = p_new->>'updatedBy',
    "updatedAt" = NOW()
  WHERE
    "maintenanceDispatchId" = p_new->>'id'
    AND "endTime" IS NULL;

  -- Set actualEndTime if not already set
  IF (p_new->>'actualEndTime') IS NULL THEN
    UPDATE "maintenanceDispatch"
    SET
      "actualEndTime" = NOW(),
      "updatedBy" = p_new->>'updatedBy',
      "updatedAt" = NOW()
    WHERE id = p_new->>'id';
  END IF;
END;
$function$;
