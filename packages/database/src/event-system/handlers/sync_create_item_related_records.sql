CREATE OR REPLACE FUNCTION public.sync_create_item_related_records(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  base_currency TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT "baseCurrencyCode"
  INTO base_currency
  FROM "company"
  WHERE "id" = p_new->>'companyId';

  INSERT INTO "itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (p_new->>'id', 'FIFO', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  VALUES (p_new->>'id', COALESCE(base_currency, 'USD'), p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT
    p_new->>'id',
    l.id,
    p_new->>'createdBy',
    p_new->>'companyId'
  FROM "location" l
  WHERE l."companyId" = p_new->>'companyId';
END;
$function$;
