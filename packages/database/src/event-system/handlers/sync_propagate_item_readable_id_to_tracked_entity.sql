CREATE OR REPLACE FUNCTION public.sync_propagate_item_readable_id_to_tracked_entity(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'readableIdWithRevision') IS NOT DISTINCT FROM (p_old->>'readableIdWithRevision') THEN
    RETURN;
  END IF;

  UPDATE "trackedEntity"
  SET "sourceDocumentReadableId" = p_new->>'readableIdWithRevision'
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = p_new->>'id';
END;
$function$;
