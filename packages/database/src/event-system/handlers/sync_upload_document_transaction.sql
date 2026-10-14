CREATE OR REPLACE FUNCTION public.sync_upload_document_transaction(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "documentTransaction" ("documentId", "type", "userId")
  VALUES (p_new->>'id', 'Upload', p_new->>'createdBy');
END;
$function$;
