CREATE OR REPLACE FUNCTION public.sync_kanban_level_check(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  is_below BOOLEAN;
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  IF (p_new->>'replenishmentSystem') IS DISTINCT FROM 'Transfer'
    OR (p_new->>'replenishmentLevel') IS NULL
  THEN
    RETURN;
  END IF;

  -- An UPDATE that changes nothing the level check reads does not re-check.
  IF p_operation = 'UPDATE'
    AND (p_new->'replenishmentLevel') IS NOT DISTINCT FROM (p_old->'replenishmentLevel')
    AND (p_new->'replenishmentSystem') IS NOT DISTINCT FROM (p_old->'replenishmentSystem')
    AND (p_new->'quantity') IS NOT DISTINCT FROM (p_old->'quantity')
    AND (p_new->'itemId') IS NOT DISTINCT FROM (p_old->'itemId')
    AND (p_new->'locationId') IS NOT DISTINCT FROM (p_old->'locationId')
    AND (p_new->'storageUnitId') IS NOT DISTINCT FROM (p_old->'storageUnitId')
    AND (p_new->'fromStorageUnitId') IS NOT DISTINCT FROM (p_old->'fromStorageUnitId')
  THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM get_kanban_projected_quantities(p_new->>'companyId', ARRAY[p_new->>'id']) p
    WHERE p."projectedQuantity" < p."replenishmentLevel"
  ) INTO is_below;

  IF is_below THEN
    PERFORM util.send_inngest_event(
      'carbon/kanban.level-check',
      jsonb_build_object('companyId', p_new->>'companyId', 'kanbanIds', jsonb_build_array(p_new->>'id'))
    );
  END IF;
END;
$function$;
