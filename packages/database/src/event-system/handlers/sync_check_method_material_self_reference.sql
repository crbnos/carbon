CREATE OR REPLACE FUNCTION public.sync_check_method_material_self_reference(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  parent_item_id TEXT;
  cycle_found BOOLEAN;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN RETURN; END IF;

  -- A make method belongs to exactly one item, so a materialMakeMethodId equal
  -- to the row's own makeMethodId is always a self-loop regardless of itemId.
  IF p_new->>'materialMakeMethodId' = p_new->>'makeMethodId' THEN
    RAISE EXCEPTION 'An item cannot use its own make method as a material sub-method'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "itemId" INTO parent_item_id
  FROM "makeMethod"
  WHERE "id" = p_new->>'makeMethodId'
    AND "companyId" = p_new->>'companyId';

  IF parent_item_id = p_new->>'itemId' THEN
    RAISE EXCEPTION 'An item cannot be a material on its own bill of materials'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Multi-node cycles (A needs B, B needs A): would the new material's own
  -- active-method BOM graph reach back to this method's item? Bounded walk
  -- over active methods only — the graph MRP plans against. UNION (not UNION
  -- ALL) dedupes, so the walk terminates even over pre-existing cycles; the
  -- depth cap is a backstop. BOM edits are UI-volume, so the walk is cheap.
  WITH RECURSIVE reachable AS (
    SELECT p_new->>'itemId' AS item_id, 0 AS depth
    UNION
    SELECT mm."itemId", r.depth + 1
    FROM reachable r
    JOIN "activeMakeMethods" amm
      ON amm."itemId" = r.item_id
     AND amm."companyId" = p_new->>'companyId'
    JOIN "methodMaterial" mm
      ON mm."makeMethodId" = amm."id"
     AND mm."companyId" = amm."companyId"
    WHERE r.depth < 100
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE item_id = parent_item_id)
  INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'Adding this material would create a loop in the bill of materials: its own BOM already contains this item'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
