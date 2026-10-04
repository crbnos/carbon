CREATE OR REPLACE FUNCTION public.set_shelf_life_on_operation_started(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  v_new_status := p_new->>'status';
  IF v_new_status <> 'In Progress' THEN
    RETURN;
  END IF;

  v_old_status := p_old->>'status';
  IF v_old_status = 'In Progress' THEN
    RETURN;
  END IF;

  PERFORM set_shelf_life_for_operation(p_new->>'id', 'Before');
END;
$function$;
