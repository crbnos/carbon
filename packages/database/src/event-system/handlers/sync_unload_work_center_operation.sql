CREATE OR REPLACE FUNCTION public.sync_unload_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A deleted operation unloads too: the pointer has no foreign key, because
  -- one would make PostgREST embeds of workCenter from jobOperation ambiguous.
  IF p_operation = 'DELETE' THEN
    UPDATE "workCenter"
    SET "loadedJobOperationId" = NULL,
        "loadedAt" = NULL
    WHERE "loadedJobOperationId" = p_old->>'id';
    UPDATE "workCenterLoad"
    SET "unloadedAt" = NOW()
    WHERE "jobOperationId" = p_old->>'id'
      AND "companyId" = p_old->>'companyId'
      AND "unloadedAt" IS NULL;
    RETURN;
  END IF;

  -- An operation moved to another work center leaves the old one: its sensor
  -- time there is no longer this operation's.
  IF p_operation = 'UPDATE'
     AND (p_old->>'workCenterId') IS DISTINCT FROM (p_new->>'workCenterId') THEN
    UPDATE "workCenter"
    SET "loadedJobOperationId" = NULL,
        "loadedAt" = NULL
    WHERE "id" = p_old->>'workCenterId'
      AND "companyId" = p_old->>'companyId'
      AND "loadedJobOperationId" = p_new->>'id';
    UPDATE "workCenterLoad"
    SET "unloadedAt" = NOW()
    WHERE "workCenterId" = p_old->>'workCenterId'
      AND "companyId" = p_old->>'companyId'
      AND "jobOperationId" = p_new->>'id'
      AND "unloadedAt" IS NULL;
  END IF;

  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') NOT IN ('Done', 'Canceled') THEN RETURN; END IF;
  IF (p_old->>'status') = (p_new->>'status') THEN RETURN; END IF;

  UPDATE "workCenter"
  SET "loadedJobOperationId" = NULL,
      "loadedAt" = NULL
  WHERE "loadedJobOperationId" = p_new->>'id';
  UPDATE "workCenterLoad"
  SET "unloadedAt" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "companyId" = p_new->>'companyId'
    AND "unloadedAt" IS NULL;
END;
$function$;
