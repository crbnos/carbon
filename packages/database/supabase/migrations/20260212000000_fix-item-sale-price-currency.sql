-- Fix the create_item_related_records trigger to use the company's
-- baseCurrencyCode instead of hardcoded 'USD'
CREATE OR REPLACE FUNCTION public.create_item_related_records()
RETURNS TRIGGER AS $$
DECLARE
  base_currency TEXT;
BEGIN
  SELECT "baseCurrencyCode" INTO base_currency
  FROM public."company"
  WHERE "id" = new."companyId";

  INSERT INTO public."itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId")
  VALUES (new.id, COALESCE(base_currency, 'USD'), new."createdBy", new."companyId");

  -- Insert itemPlanning records for each location
  INSERT INTO public."itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT
    new.id,
    l.id,
    new."createdBy",
    new."companyId"
  FROM public."location" l
  WHERE l."companyId" = new."companyId";

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
