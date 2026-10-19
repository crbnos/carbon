CREATE OR REPLACE FUNCTION public.sync_load_work_center_operation(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_work_center_id text := p_new->>'workCenterId';
  v_company_id text := p_new->>'companyId';
  v_operation_id text := p_new->>'jobOperationId';
  v_start timestamptz := (p_new->>'startTime')::timestamptz;
  v_boundary timestamptz;
  v_loaded text;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Only a starting event loads: an event inserted with an endTime (an ERP
  -- entry, an assigned interval, a closed sensor run) never does.
  IF (p_new->>'endTime') IS NOT NULL OR v_work_center_id IS NULL THEN
    RETURN;
  END IF;

  -- This runs as the owner (the dispatchers are SECURITY DEFINER), and the
  -- event's workCenterId and jobOperationId are single-column FKs: an event
  -- may only load its OWN company's operation onto its own company's work
  -- center, or another company's sensor time would land on it. (A starting
  -- event reopens a Done operation first: sync_set_job_operation_in_progress.)
  IF NOT EXISTS (
    SELECT 1 FROM "workCenter"
    WHERE "id" = v_work_center_id AND "companyId" = v_company_id
  ) OR NOT EXISTS (
    SELECT 1 FROM "jobOperation"
    WHERE "id" = v_operation_id AND "companyId" = v_company_id
  ) THEN
    RETURN;
  END IF;

  -- One load at a time per work center.
  PERFORM pg_advisory_xact_lock(hashtextextended('workCenterLoad:' || v_work_center_id, 0));

  -- The open row is the load. A start older than the newest boundary in the
  -- history (a load or an unload) never loads: a late event must not undo a
  -- load or an unload that came after it.
  SELECT max(GREATEST("loadedAt", COALESCE("unloadedAt", "loadedAt")))
  INTO v_boundary
  FROM "workCenterLoad"
  WHERE "workCenterId" = v_work_center_id AND "companyId" = v_company_id;
  IF v_boundary IS NOT NULL AND v_start < v_boundary THEN RETURN; END IF;

  -- A reload of the operation already loaded writes nothing.
  SELECT "jobOperationId" INTO v_loaded
  FROM "workCenterLoad"
  WHERE "workCenterId" = v_work_center_id
    AND "companyId" = v_company_id
    AND "unloadedAt" IS NULL;
  IF v_loaded = v_operation_id THEN RETURN; END IF;

  UPDATE "workCenterLoad"
  SET "unloadedAt" = v_start
  WHERE "workCenterId" = v_work_center_id
    AND "companyId" = v_company_id
    AND "unloadedAt" IS NULL;

  INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt")
  VALUES (v_company_id, v_work_center_id, v_operation_id, v_start);
END;
$function$;
