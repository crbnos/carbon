CREATE OR REPLACE FUNCTION public.check_inspection_hold(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- Refuses a stock movement OUT of held stock: a serial or batch unit that is
-- On Hold while its receipt line's inspection lot is open, or untracked
-- quantity an open inspection lot holds at its storage unit. The postings that
-- ARE the release (the rejected move, the NCR write-off, a receipt void, an
-- inventory count, a return shipment) set app.inspection_release for their
-- transaction. A plain RAISE (P0001): the API passes its text to the person;
-- any other SQLSTATE reads as a server failure and is withheld.
DECLARE
  v_qty       NUMERIC := (p_new->>'quantity')::numeric;
  v_unit      TEXT := p_new->>'storageUnitId';
  v_entity    TEXT := p_new->>'trackedEntityId';
  v_item_id   TEXT := p_new->>'itemId';
  v_company   TEXT := p_new->>'companyId';
  v_held      NUMERIC;
  v_on_hand   NUMERIC;
  v_item      TEXT;
  v_unit_name TEXT;
BEGIN
  IF p_operation <> 'INSERT' OR v_qty IS NULL OR v_qty >= 0 THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  IF v_entity IS NOT NULL THEN
    -- Only an inspection hold: a unit On Hold for another reason (a customer
    -- return awaiting its RMA disposition) is not this guard's to refuse.
    IF EXISTS (
      SELECT 1
      FROM "trackedEntity" te
      JOIN "inspection" i
        ON i."sourceDocument" = 'Receipt'
       AND i."sourceDocumentLineId" = te."attributes" ->> 'Receipt Line'
       AND i."companyId" = te."companyId"
      WHERE te."id" = v_entity
        AND te."status" = 'On Hold'
        AND i."status" IN ('Pending', 'In Progress')
    ) THEN
      SELECT "readableIdWithRevision" INTO v_item FROM "item" WHERE "id" = v_item_id;
      RAISE EXCEPTION '% is held for inspection. Quality must decide its inspection lot before it can move.',
        COALESCE(v_item, v_item_id);
    END IF;
    RETURN;
  END IF;

  IF v_unit IS NULL THEN
    RETURN;
  END IF;

  -- Fast path: no lot that can hold stock names this item at this unit.
  IF NOT EXISTS (
    SELECT 1 FROM "inspection"
    WHERE "storageUnitId" = v_unit
      AND "itemId" = v_item_id
      AND "status" IN ('Pending', 'In Progress', 'Partial')
  ) THEN
    RETURN;
  END IF;

  v_held := public.inspection_held_quantity(v_company, v_item_id, v_unit);
  IF v_held <= 0 THEN
    RETURN;
  END IF;

  -- Two moves out of the same held (item, unit) must not both pass on the same
  -- on-hand: the second waits for the first to commit, then reads its row.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('inspection-hold:' || v_company || ':' || v_item_id || ':' || v_unit, 0)
  );

  SELECT COALESCE(SUM("quantity"), 0) INTO v_on_hand
  FROM "itemLedger"
  WHERE "storageUnitId" = v_unit
    AND "itemId" = v_item_id
    AND "companyId" = v_company;

  IF v_on_hand + v_qty < v_held THEN
    SELECT "readableIdWithRevision" INTO v_item FROM "item" WHERE "id" = v_item_id;
    SELECT "name" INTO v_unit_name FROM "storageUnit" WHERE "id" = v_unit;
    RAISE EXCEPTION '% is held for inspection in %. Quality must decide its inspection lot before it can move.',
      COALESCE(v_item, v_item_id), COALESCE(v_unit_name, v_unit);
  END IF;
END;
$function$;
