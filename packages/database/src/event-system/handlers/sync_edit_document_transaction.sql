CREATE OR REPLACE FUNCTION public.sync_edit_document_transaction(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  INSERT INTO "documentTransaction" ("documentId", "type", "userId")
  VALUES (p_new->>'id', 'Edit', p_new->>'createdBy');
END;
$function$;
