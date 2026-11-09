CREATE OR REPLACE FUNCTION public.check_nonconformance_inspection_link(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lot TEXT;
  v_status TEXT;
  v_source TEXT;
  v_tracking TEXT;
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

  IF p_operation IN ('UPDATE', 'DELETE') THEN
    SELECT COALESCE(i."inspectionId", i."id") INTO v_lot
    FROM "inspection" i
    JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
    WHERE i."id" = p_old->>'inspectionId'
      AND i."sourceDocument" = 'Receipt'
      AND i."status" = 'Partial'
      AND it."itemTrackingType" = 'Inventory'
      AND i."acceptedQuantity" IS NOT NULL
      AND i."lotSize" - i."acceptedQuantity" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "nonConformanceInspection" sibling
        WHERE sibling."nonConformanceId" = p_old->>'nonConformanceId'
          AND sibling."inspectionId" <> p_old->>'inspectionId'
      );
    IF FOUND AND EXISTS (SELECT 1 FROM "company" c WHERE c."id" = p_old->>'companyId') THEN
      RAISE EXCEPTION 'Inspection lot % is decided by this NCR, so its link cannot be moved or removed.',
        v_lot;
    END IF;
  END IF;

  IF p_operation IN ('INSERT', 'UPDATE') THEN
    PERFORM 1 FROM "nonConformance" nc WHERE nc."id" = p_new->>'nonConformanceId' FOR NO KEY UPDATE;
    PERFORM 1 FROM "inspection" i WHERE i."id" = p_new->>'inspectionId' FOR NO KEY UPDATE;

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

    SELECT COALESCE(i."inspectionId", i."id"), i."status"::TEXT, i."sourceDocument"::TEXT, it."itemTrackingType"::TEXT
      INTO v_lot, v_status, v_source, v_tracking
    FROM "inspection" i
    LEFT JOIN "item" it ON it."id" = i."itemId" AND it."companyId" = i."companyId"
    WHERE i."id" = p_new->>'inspectionId';
    IF v_source = 'Receipt'
       AND v_status NOT IN ('Passed', 'Cancelled')
       AND v_tracking = 'Inventory'
       AND EXISTS (
      SELECT 1 FROM "nonConformanceInspection" nci
      WHERE nci."inspectionId" = p_new->>'inspectionId'
        AND nci."nonConformanceId" <> p_new->>'nonConformanceId'
        AND nci."id" IS DISTINCT FROM p_old->>'id'
    ) THEN
      RAISE EXCEPTION 'Inspection lot % already has its NCR. A receipt lot belongs to one NCR.',
        v_lot;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "nonConformanceInspection" nci
      JOIN "inspection" other ON other."id" = nci."inspectionId"
      WHERE nci."nonConformanceId" = p_new->>'nonConformanceId'
        AND nci."inspectionId" <> p_new->>'inspectionId'
        AND nci."id" IS DISTINCT FROM p_old->>'id'
        AND ((v_source = 'Receipt' AND v_status = 'Partial')
          OR (other."sourceDocument" = 'Receipt' AND other."status" = 'Partial'))
    ) THEN
      RAISE EXCEPTION 'A Partial inspection lot must be the only lot on its NCR. Lot % cannot join this NCR.',
        v_lot;
    END IF;
  END IF;
END;
$function$;
