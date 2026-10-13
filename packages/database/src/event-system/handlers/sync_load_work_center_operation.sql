CREATE OR REPLACE FUNCTION public.sync_load_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only a starting event loads: an event inserted with an endTime (an ERP
  -- entry, an assigned interval, a closed sensor run) never does.
  IF (p_new->>'endTime') IS NOT NULL OR (p_new->>'workCenterId') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "workCenter"
  SET "loadedJobOperationId" = p_new->>'jobOperationId',
      "loadedAt" = (p_new->>'startTime')::timestamptz
  WHERE "id" = p_new->>'workCenterId'
    AND ("loadedAt" IS NULL OR "loadedAt" <= (p_new->>'startTime')::timestamptz)
    AND "loadedJobOperationId" IS DISTINCT FROM p_new->>'jobOperationId';
END;
$function$;
