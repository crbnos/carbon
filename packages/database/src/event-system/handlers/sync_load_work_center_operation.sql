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

  -- This runs as the owner (the dispatchers are SECURITY DEFINER), and the
  -- event's workCenterId and jobOperationId are single-column FKs: an event
  -- may only load its OWN company's operation onto its own company's work
  -- center, or another company's sensor time would land on it.
  UPDATE "workCenter"
  SET "loadedJobOperationId" = p_new->>'jobOperationId',
      "loadedAt" = (p_new->>'startTime')::timestamptz
  WHERE "id" = p_new->>'workCenterId'
    AND "companyId" = p_new->>'companyId'
    AND ("loadedAt" IS NULL OR "loadedAt" <= (p_new->>'startTime')::timestamptz)
    AND "loadedJobOperationId" IS DISTINCT FROM p_new->>'jobOperationId'
    AND EXISTS (
      SELECT 1 FROM "jobOperation"
      WHERE "id" = p_new->>'jobOperationId'
        AND "companyId" = p_new->>'companyId'
    );
  IF NOT FOUND THEN RETURN; END IF;

  -- The history: the previous load ends where this one starts. The OEE sync
  -- gives a run to the operation loaded when it started.
  UPDATE "workCenterLoad"
  SET "unloadedAt" = (p_new->>'startTime')::timestamptz
  WHERE "workCenterId" = p_new->>'workCenterId'
    AND "companyId" = p_new->>'companyId'
    AND "unloadedAt" IS NULL;

  INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt")
  VALUES (
    p_new->>'companyId',
    p_new->>'workCenterId',
    p_new->>'jobOperationId',
    (p_new->>'startTime')::timestamptz
  );
END;
$function$;
