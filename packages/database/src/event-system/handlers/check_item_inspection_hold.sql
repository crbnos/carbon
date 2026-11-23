CREATE OR REPLACE FUNCTION public.check_item_inspection_hold(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lot TEXT;
BEGIN
  IF p_operation <> 'UPDATE'
     OR (p_new->'itemTrackingType') IS NOT DISTINCT FROM (p_old->'itemTrackingType') THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
  FROM "inspection" i
  WHERE i."itemId" = p_old->>'id'
    AND i."companyId" = p_old->>'companyId'
    AND i."sourceDocument" = 'Receipt'
    AND (
      i."status" IN ('Pending', 'In Progress')
      OR (
        i."status" = 'Partial'
        AND i."acceptedQuantity" IS NOT NULL
        AND 'Inventory' IN (p_old->>'itemTrackingType', p_new->>'itemTrackingType')
        AND NOT EXISTS (
          SELECT 1
          FROM "nonConformanceInspection" nci
          JOIN "nonConformance" nc ON nc."id" = nci."nonConformanceId"
          WHERE nci."inspectionId" = i."id" AND nc."status" = 'Closed'
        )
      )
    )
  ORDER BY 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This item is held for inspection under lot %. Finish that lot and its NCR before its tracking type can change.',
      v_lot;
  END IF;
END;
$function$;
