CREATE OR REPLACE FUNCTION public.check_tracked_entity_inspection_hold(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- A serial or batch unit is held by its On Hold status while its receipt
-- line's lot is open, so a direct edit (PostgREST) could release it without a
-- decision. Only the postings that ARE the release (they set
-- app.inspection_release) change its status or its receipt line then. A plain
-- RAISE (P0001), so the API shows the text.
DECLARE
  v_line TEXT;
  v_item TEXT;
BEGIN
  -- Hot path: most updates are of units that are not On Hold.
  IF p_operation <> 'UPDATE' OR p_old->>'status' IS DISTINCT FROM 'On Hold' THEN
    RETURN;
  END IF;
  v_line := p_old->'attributes'->>'Receipt Line';
  IF v_line IS NULL THEN
    RETURN;
  END IF;
  IF p_new->>'status' = 'On Hold'
     AND (p_new->'attributes'->>'Receipt Line') IS NOT DISTINCT FROM v_line THEN
    RETURN;
  END IF;
  IF current_setting('app.inspection_release', true) = 'on'
     OR current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  IF public.inspection_line_lot_open(p_old->>'companyId', v_line) THEN
    SELECT "readableIdWithRevision" INTO v_item FROM "item" WHERE "id" = p_old->>'itemId';
    RAISE EXCEPTION '% % is held for inspection. Quality must decide its inspection lot before it can be released.',
      COALESCE(v_item, p_old->>'itemId', ''), COALESCE(p_old->>'readableId', p_old->>'id');
  END IF;
END;
$function$;
