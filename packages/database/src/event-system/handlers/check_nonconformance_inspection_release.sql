CREATE OR REPLACE FUNCTION public.check_nonconformance_inspection_release(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ncr JSONB;
  v_lot TEXT;
BEGIN
  IF p_operation = 'UPDATE' THEN
    IF p_old->>'status' = 'Closed' AND p_new->>'status' IS DISTINCT FROM 'Closed' THEN
      IF current_setting('app.inspection_release', true) = 'on'
         OR current_setting('app.sync_in_progress', true) = 'true' THEN
        RETURN;
      END IF;
      SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
      FROM "nonConformanceInspection" nci
      JOIN "inspection" i ON i."id" = nci."inspectionId"
      JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
      WHERE nci."nonConformanceId" = p_new->>'id'
        AND i."sourceDocument" = 'Receipt'
        AND i."status" = 'Partial'
        AND it."itemTrackingType" = 'Inventory'
        AND i."acceptedQuantity" IS NOT NULL
        AND i."lotSize" - i."acceptedQuantity" > 0
      ORDER BY 1
      LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'This NCR released the rejected part of inspection lot %, so it cannot be reopened.',
          v_lot;
      END IF;
      RETURN;
    END IF;
    IF p_new->>'status' IS DISTINCT FROM 'Closed'
       OR p_old->>'status' IS NOT DISTINCT FROM 'Closed' THEN
      RETURN;
    END IF;
    v_ncr := p_new;
  ELSIF p_operation = 'DELETE' THEN
    IF p_old->>'status' IS NOT DISTINCT FROM 'Closed' THEN
      IF current_setting('app.inspection_release', true) = 'on'
         OR current_setting('app.sync_in_progress', true) = 'true'
         OR NOT EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
        RETURN;
      END IF;
      SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
      FROM "nonConformanceInspection" nci
      JOIN "inspection" i ON i."id" = nci."inspectionId"
      JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
      WHERE nci."nonConformanceId" = p_old->>'id'
        AND i."sourceDocument" = 'Receipt'
        AND i."status" = 'Partial'
        AND it."itemTrackingType" = 'Inventory'
        AND i."acceptedQuantity" IS NOT NULL
        AND i."lotSize" - i."acceptedQuantity" > 0
      ORDER BY 1
      LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'This NCR released the rejected part of inspection lot %, so it cannot be deleted.',
          v_lot;
      END IF;
      RETURN;
    END IF;
    v_ncr := p_old;
  ELSE
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
  FROM "nonConformanceInspection" nci
  JOIN "inspection" i ON i."id" = nci."inspectionId"
  JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
  WHERE nci."nonConformanceId" = v_ncr->>'id'
    AND i."sourceDocument" = 'Receipt'
    AND i."status" = 'Partial'
    AND it."itemTrackingType" = 'Inventory'
    AND i."lotSize" - COALESCE(i."acceptedQuantity", 0) > 0
    AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity")
  ORDER BY 1
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_operation = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "company" c WHERE c."id" = v_ncr->>'companyId') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'This NCR holds the rejected part of inspection lot %. Complete the NCR to post its disposition instead of deleting it.',
      v_lot;
  END IF;
  RAISE EXCEPTION 'This NCR holds the rejected part of inspection lot %. Complete the NCR to post its disposition and close it.',
    v_lot;
END;
$function$;
