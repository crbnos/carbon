CREATE OR REPLACE FUNCTION public.check_nonconformance_inspection_release(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- A Partial receipt lot holds its rejected remainder until its NCR closes, and
-- closing the NCR (closeIssue) writes that remainder off. A direct status edit
-- (PostgREST) to Closed would release it with no write-off. Only closeIssue,
-- which sets app.inspection_release, closes such an NCR; a company wipe,
-- restore or import sets one of the two flags. A plain RAISE (P0001), so the
-- API shows the text.
DECLARE
  v_lot TEXT;
BEGIN
  -- Hot path: only a change of status to Closed.
  IF p_operation <> 'UPDATE'
     OR p_new->>'status' IS DISTINCT FROM 'Closed'
     OR p_old->>'status' IS NOT DISTINCT FROM 'Closed' THEN
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
  WHERE nci."nonConformanceId" = p_new->>'id'
    AND i."sourceDocument" = 'Receipt'
    AND i."status" = 'Partial'
    AND it."itemTrackingType" = 'Inventory'
    AND i."lotSize" - COALESCE(i."acceptedQuantity", 0) > 0
    AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity")
  ORDER BY 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This NCR holds the rejected part of inspection lot %. Complete the NCR to post its disposition and close it.',
      v_lot;
  END IF;
END;
$function$;
