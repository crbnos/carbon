CREATE OR REPLACE FUNCTION public.check_inspection_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_companies TEXT[];
  v_items     TEXT[];
  v_units     TEXT[];
  v_item_id   TEXT;
  v_unit      TEXT;
  v_item      TEXT;
  v_unit_name TEXT;
  i           INT;
BEGIN
  -- Stock leaves only through a new ledger row.
  IF TG_OP <> 'INSERT' THEN
    RETURN NULL;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Only an inspection hold: a unit On Hold for another reason (a customer
  -- return awaiting its RMA disposition) is not this guard's to refuse.
  SELECT b."itemId" INTO v_item_id
  FROM batched_new b
  JOIN "trackedEntity" te ON te."id" = b."trackedEntityId"
  WHERE b."quantity" < 0
    AND te."status" = 'On Hold'
    AND public.inspection_line_lot_open(te."companyId", te."attributes" ->> 'Receipt Line')
  ORDER BY b."entryNumber"
  LIMIT 1;
  IF FOUND THEN
    SELECT "readableIdWithRevision" INTO v_item FROM "item" WHERE "id" = v_item_id;
    RAISE EXCEPTION '% is held for inspection. Quality must decide its inspection lot before it can move.',
      COALESCE(v_item, v_item_id);
  END IF;

  -- The (item, unit) pairs an untracked move takes stock from where a lot can
  -- hold stock. A Partial lot stops holding when its NCR closes (inspection_held_quantity).
  SELECT
    array_agg(k.c ORDER BY k.c, k.i, k.u),
    array_agg(k.i ORDER BY k.c, k.i, k.u),
    array_agg(k.u ORDER BY k.c, k.i, k.u)
  INTO v_companies, v_items, v_units
  FROM (
    SELECT DISTINCT b."companyId" AS c, b."itemId" AS i, b."storageUnitId" AS u
    FROM batched_new b
    WHERE b."quantity" < 0
      AND b."trackedEntityId" IS NULL
      AND b."storageUnitId" IS NOT NULL
      AND public.inspection_holds_at(b."companyId", b."itemId", b."storageUnitId")
  ) k;
  IF v_units IS NULL THEN
    RETURN NULL;
  END IF;

  -- Two moves out of the same held (item, unit) must not both pass on the same
  -- on-hand: the second waits for the first to commit, then reads its rows.
  -- One order for every statement, so two statements cannot deadlock.
  FOR i IN 1 .. array_length(v_units, 1) LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('inspection-hold:' || v_companies[i] || ':' || v_items[i] || ':' || v_units[i], 0)
    );
  END LOOP;

  -- Held and on-hand from one snapshot, taken after the locks: read apart, a
  -- receipt committing between the two reads counts on one side only. On-hand
  -- already includes this statement's rows. Only untracked rows: serial and
  -- batch stock is held by its status, above.
  SELECT k.i, k.u INTO v_item_id, v_unit
  FROM unnest(v_companies, v_items, v_units) AS k(c, i, u)
  CROSS JOIN LATERAL (
    SELECT
      public.inspection_held_quantity(k.c, k.i, k.u) AS held,
      public.inspection_untracked_on_hand(k.c, k.i, k.u) AS on_hand
  ) s
  WHERE s.held > 0 AND s.on_hand < s.held
  ORDER BY k.c, k.i, k.u
  LIMIT 1;
  IF FOUND THEN
    SELECT "readableIdWithRevision" INTO v_item FROM "item" WHERE "id" = v_item_id;
    SELECT "name" INTO v_unit_name FROM "storageUnit" WHERE "id" = v_unit;
    RAISE EXCEPTION '% is held for inspection in %. Quality must decide its inspection lot before it can move.',
      COALESCE(v_item, v_item_id), COALESCE(v_unit_name, v_unit);
  END IF;
  RETURN NULL;
END;
$function$;
