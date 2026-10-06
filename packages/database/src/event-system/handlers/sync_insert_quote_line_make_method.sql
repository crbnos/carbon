CREATE OR REPLACE FUNCTION public.sync_insert_quote_line_make_method(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;
  IF (p_new->>'methodType') != 'Make to Order' THEN RETURN; END IF;
  IF (p_new->>'itemId') IS NULL THEN RETURN; END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  INSERT INTO "quoteMakeMethod" (
    "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
  ) VALUES (
    p_new->>'quoteId', p_new->>'id', p_new->>'itemId',
    p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
  );
END;
$function$;
