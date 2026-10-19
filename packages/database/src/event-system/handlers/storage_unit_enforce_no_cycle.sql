CREATE OR REPLACE FUNCTION public.storage_unit_enforce_no_cycle(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_self_id   TEXT;
  v_cursor_id TEXT;
  v_depth     INTEGER := 0;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_cursor_id := p_new->>'parentId';
  IF v_cursor_id IS NULL THEN
    RETURN;
  END IF;

  v_self_id := p_new->>'id';

  WHILE v_cursor_id IS NOT NULL LOOP
    IF v_cursor_id = v_self_id THEN
      RAISE EXCEPTION 'Cycle detected in storage unit hierarchy at %', v_self_id;
    END IF;

    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'Storage unit hierarchy exceeds max depth (possible cycle)';
    END IF;

    SELECT "parentId" INTO v_cursor_id
    FROM "storageUnit"
    WHERE "id" = v_cursor_id;
  END LOOP;
END;
$function$;
