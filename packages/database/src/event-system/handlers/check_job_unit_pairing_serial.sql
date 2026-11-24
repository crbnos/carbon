CREATE OR REPLACE FUNCTION public.check_job_unit_pairing_serial(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company text := p_new->>'companyId';
  v_item text := COALESCE(p_new->>'itemId', CASE WHEN p_new->>'sourceDocument' = 'Item' THEN p_new->>'sourceDocumentId' END);
  v_serial text := p_new->>'readableId';
BEGIN
  IF p_operation = 'DELETE' OR (p_operation = 'UPDATE'
    AND (p_new->>'readableId', p_new->>'companyId', p_new->>'itemId', p_new->>'sourceDocument', p_new->>'sourceDocumentId')
      IS NOT DISTINCT FROM
        (p_old->>'readableId', p_old->>'companyId', p_old->>'itemId', p_old->>'sourceDocument', p_old->>'sourceDocumentId')) THEN
    RETURN;
  END IF;

  -- The foreign keys retain immutable identity on delete. On an update,
  -- prevent an edit from making the two ends disagree with their snapshot.
  IF p_operation = 'UPDATE' AND EXISTS (
    SELECT 1 FROM "jobUnitPairing" p
    WHERE p."companyId" = p_old->>'companyId' AND p."releasedAt" IS NULL
      AND (p."sourceId" = p_old->>'id' OR p."outputId" = p_old->>'id')
  ) THEN
    RAISE EXCEPTION 'This unit is paired to a packing job. Correct the issue before changing the serial or item.';
  END IF;

  IF v_item IS NULL OR NULLIF(btrim(v_serial), '') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM "companySettings" cs WHERE cs.id = v_company AND cs."serialNumberFromComponent")
    AND NOT EXISTS (SELECT 1 FROM "jobUnitPairing" p WHERE p."companyId" = v_company) THEN
    RETURN;
  END IF;

  -- The issue posting takes the same lock before checking existing serials.
  -- This keeps a manual or generated number on the same sales SKU from
  -- racing an issue that is about to bind that number.
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(v_company, v_item, v_serial)::text, 0));
  IF EXISTS (
    SELECT 1 FROM "trackedEntity" output
    JOIN "jobUnitPairing" p ON p."companyId" = output."companyId" AND p."outputId" = output.id
    WHERE output."companyId" = v_company AND output."readableId" = v_serial
      AND output."itemId" = v_item AND output.id <> p_new->>'id' AND p."releasedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'This sales item already has a packed unit with serial %.', v_serial;
  END IF;
END;
$function$;
