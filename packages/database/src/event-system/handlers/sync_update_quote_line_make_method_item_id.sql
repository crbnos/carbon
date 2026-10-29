CREATE OR REPLACE FUNCTION public.sync_update_quote_line_make_method_item_id(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_version NUMERIC(10, 2);
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  -- Only fire when methodType/itemId change is relevant to Make to Order
  IF NOT (
    ((p_old->>'methodType') = 'Make to Order' AND (p_old->>'itemId') IS DISTINCT FROM (p_new->>'itemId'))
    OR ((p_new->>'methodType') = 'Make to Order' AND (p_old->>'methodType') != 'Make to Order')
  ) THEN
    RETURN;
  END IF;

  SELECT "version" INTO v_version FROM "activeMakeMethods" WHERE "itemId" = p_new->>'itemId';

  IF NOT EXISTS (
    SELECT 1 FROM "quoteMakeMethod"
    WHERE "quoteLineId" = p_new->>'id' AND "parentMaterialId" IS NULL
  ) THEN
    INSERT INTO "quoteMakeMethod" (
      "quoteId", "quoteLineId", "itemId", "companyId", "createdAt", "createdBy", "version"
    ) VALUES (
      p_new->>'quoteId', p_new->>'id', p_new->>'itemId',
      p_new->>'companyId', NOW(), p_new->>'createdBy', v_version
    );
  ELSE
    UPDATE "quoteMakeMethod"
    SET "itemId" = p_new->>'itemId',
        "version" = v_version
    WHERE "quoteLineId" = p_new->>'id' AND "parentMaterialId" IS NULL;
  END IF;
END;
$function$;
