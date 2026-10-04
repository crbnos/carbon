CREATE OR REPLACE FUNCTION public.sync_protect_system_required_actions(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'DELETE' THEN
    IF (p_old->>'systemType') IS NOT NULL THEN
      -- Allow cascading deletes when the parent company is being deleted
      IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = p_old->>'companyId') THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'Cannot delete a system-defined required action. You may deactivate it instead.';
    END IF;
  END IF;

  IF p_operation = 'UPDATE' THEN
    IF (p_old->>'systemType') IS NOT NULL AND (p_new->>'systemType') IS DISTINCT FROM (p_old->>'systemType') THEN
      RAISE EXCEPTION 'Cannot change the systemType of a system-defined required action.';
    END IF;
    IF (p_old->>'systemType') IS NULL AND (p_new->>'systemType') IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot assign a systemType to a custom required action.';
    END IF;
  END IF;
END;
$function$;
