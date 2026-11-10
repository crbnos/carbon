CREATE OR REPLACE FUNCTION public.check_inspection_lot_release(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_holds BOOLEAN;
BEGIN
  IF p_operation NOT IN ('UPDATE', 'DELETE') THEN
    RETURN;
  END IF;
  IF p_old->>'sourceDocument' IS DISTINCT FROM 'Receipt'
     AND (p_operation = 'DELETE' OR p_new->>'sourceDocument' IS DISTINCT FROM 'Receipt') THEN
    RETURN;
  END IF;

  IF p_operation = 'DELETE' THEN
    IF p_old->>'status' NOT IN ('Pending', 'In Progress', 'Partial')
       OR NOT public.inspection_lot_holds(
         p_old->>'id',
         (p_old->>'status')::"inspectionStatusType",
         (p_old->>'acceptedQuantity')::numeric
       ) THEN
      RETURN;
    END IF;
    IF current_setting('app.inspection_release', true) = 'on'
       OR current_setting('app.sync_in_progress', true) = 'true' THEN
      RETURN;
    END IF;
    IF p_old->>'storageUnitId' IS NULL AND NOT (
      p_old->>'status' IN ('Pending', 'In Progress')
      AND EXISTS (
        SELECT 1 FROM "trackedEntity" te
        WHERE te."companyId" = p_old->>'companyId'
          AND te."attributes" ->> 'Receipt Line' = p_old->>'sourceDocumentLineId'
          AND te."status" = 'On Hold'
      )
    ) THEN
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Inspection lot % holds stock. Quality must decide it before it can be deleted.',
      COALESCE(p_old->>'inspectionId', p_old->>'id');
  END IF;

  v_holds := p_old->>'status' IN ('Pending', 'In Progress', 'Partial')
    AND public.inspection_lot_holds(
      p_old->>'id',
      (p_old->>'status')::"inspectionStatusType",
      (p_old->>'acceptedQuantity')::numeric
    );
  IF (p_new->'status') IS NOT DISTINCT FROM (p_old->'status')
     AND (p_new->'sourceDocument') IS NOT DISTINCT FROM (p_old->'sourceDocument')
     AND (NOT v_holds OR (
       (p_new->'storageUnitId') IS NOT DISTINCT FROM (p_old->'storageUnitId')
       AND (p_new->'acceptedQuantity') IS NOT DISTINCT FROM (p_old->'acceptedQuantity')
       AND (p_new->'lotSize') IS NOT DISTINCT FROM (p_old->'lotSize')
       AND (p_new->'itemId') IS NOT DISTINCT FROM (p_old->'itemId')
       AND (p_new->'sourceDocumentLineId') IS NOT DISTINCT FROM (p_old->'sourceDocumentLineId')
     )) THEN
    RETURN;
  END IF;

  IF p_old->>'status' IN ('Pending', 'In Progress')
     AND p_new->>'status' IN ('Pending', 'In Progress')
     AND (p_new->'sourceDocument') IS NOT DISTINCT FROM (p_old->'sourceDocument')
     AND (p_new->'storageUnitId') IS NOT DISTINCT FROM (p_old->'storageUnitId')
     AND (p_new->'acceptedQuantity') IS NOT DISTINCT FROM (p_old->'acceptedQuantity')
     AND (p_new->'lotSize') IS NOT DISTINCT FROM (p_old->'lotSize')
     AND (p_new->'itemId') IS NOT DISTINCT FROM (p_old->'itemId')
     AND (p_new->'sourceDocumentLineId') IS NOT DISTINCT FROM (p_old->'sourceDocumentLineId') THEN
    RETURN;
  END IF;

  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Inspection lot % changes only through its inspection decision (Accept, Reject or Partial).',
    COALESCE(p_new->>'inspectionId', p_new->>'id');
END;
$function$;
