CREATE OR REPLACE FUNCTION public.check_nonconformance_inspection_link(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- A Partial untracked receipt lot holds its rejected remainder until its
-- linked NCR closes, and closing that NCR (closeIssue) writes the remainder
-- off. A direct link to an NCR that is already Closed would release the
-- remainder with no write-off; re-pointing or deleting the lot's link would
-- leave it held with no NCR to decide it. Only a posting that sets
-- app.inspection_release changes such a link; a company wipe, restore or
-- import sets one of the two flags, and deleting the company is never
-- refused. A plain RAISE (P0001), so the API shows the text.
DECLARE
  v_lot TEXT;
BEGIN
  IF p_operation = 'UPDATE'
     AND (p_new->'inspectionId') IS NOT DISTINCT FROM (p_old->'inspectionId')
     AND (p_new->'nonConformanceId') IS NOT DISTINCT FROM (p_old->'nonConformanceId') THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  -- The lot this change takes the link from (re-point, unlink).
  IF p_operation IN ('UPDATE', 'DELETE') THEN
    SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
    FROM "inspection" i
    JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
    WHERE i."id" = p_old->>'inspectionId'
      AND i."sourceDocument" = 'Receipt'
      AND i."status" = 'Partial'
      AND it."itemTrackingType" = 'Inventory'
      AND i."lotSize" - COALESCE(i."acceptedQuantity", 0) > 0
      AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity");
    IF FOUND AND EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
      RAISE EXCEPTION 'Inspection lot % holds its rejected part until its NCR is completed. Complete the NCR instead of moving or removing its link.',
        v_lot;
    END IF;
  END IF;

  -- The lot this change links to an NCR that is already Closed.
  IF p_operation IN ('INSERT', 'UPDATE') THEN
    SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
    FROM "inspection" i
    JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
    JOIN "nonConformance" nc
      ON nc."id" = p_new->>'nonConformanceId' AND nc."status" = 'Closed'
    WHERE i."id" = p_new->>'inspectionId'
      AND i."sourceDocument" = 'Receipt'
      AND i."status" = 'Partial'
      AND it."itemTrackingType" = 'Inventory'
      AND i."lotSize" - COALESCE(i."acceptedQuantity", 0) > 0
      AND public.inspection_lot_holds(i."id", i."status", i."acceptedQuantity");
    IF FOUND THEN
      RAISE EXCEPTION 'Inspection lot % holds its rejected part until its own NCR is completed. Link it to an open NCR.',
        v_lot;
    END IF;
  END IF;
END;
$function$;
