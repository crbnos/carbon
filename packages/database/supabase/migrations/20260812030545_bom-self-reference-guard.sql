-- BOM self-reference guard: an item can never be a material on its own make
-- method.
--
-- Six production rows said "to make one X, consume Q of X", each with
-- materialMakeMethodId pointing back at its own makeMethodId — a one-node
-- cycle in the method graph. Nothing validated against it: the BOM editor
-- accepts any item as a material, and upsertMethodMaterial resolves
-- materialMakeMethodId from the child item's active method, so picking the
-- parent item assembles the loop automatically. Downstream: MRP emits phantom
-- self-demand (demand inflated by (1 + qty)), jobs copy the row and require
-- their own output item as a picked/purchased input, and every recursive
-- method-tree walker terminates only via incidental cycle guards.

-- ---------------------------------------------------------------------------
-- 1. Delete the existing self-references (6 rows across 3 tenants, all
--    verified accidental: purchased hardware and mis-picks, plus one junk row
--    in a test tenant; across ALL make method versions, not just active ones).
-- ---------------------------------------------------------------------------

DELETE FROM "methodMaterial" mm
USING "makeMethod" m
WHERE m."id" = mm."makeMethodId"
  AND m."companyId" = mm."companyId"
  AND m."itemId" = mm."itemId";

-- ---------------------------------------------------------------------------
-- 2. Sync interceptor: veto the write inline, for every write path
--    (PostgREST, Kysely, SQL). BEFORE ROW via dispatch_event_interceptors;
--    RAISE aborts the statement.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_check_method_material_self_reference(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned: runs on every write to this table, so the caller is an ordinary
-- application role and must not control name resolution.
SET search_path = public, pg_temp
AS $$
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
$$;

-- Explicit 3-argument form. The 2-argument overload is dropped by
-- 20260812002453, which runs first, but naming every argument keeps this call
-- unambiguous no matter which overloads exist when it runs.
SELECT attach_event_trigger(
  'methodMaterial',
  ARRAY['sync_check_method_material_self_reference']::TEXT[],
  ARRAY[]::TEXT[]
);
