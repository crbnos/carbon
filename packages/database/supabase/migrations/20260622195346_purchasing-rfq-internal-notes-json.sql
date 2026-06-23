-- "purchasingRfq"."internalNotes" was created as TEXT, unlike every other entity
-- (purchaseOrder, supplierQuote, quote, purchasingRfqLine) where it is JSON. The
-- rich-text Editor writes a JSONContent object, so the TEXT column stored a JSON
-- string that the loader handed back to the Editor unparsed, rendering raw JSON.
-- Align the column type with the rest of the codebase.
--
-- The "purchasingRfqs" view selects rfq.* so it depends on this column and must be
-- dropped before the type change, then recreated unchanged.

DROP VIEW IF EXISTS "purchasingRfqs";

ALTER TABLE "purchasingRfq"
  ALTER COLUMN "internalNotes" TYPE JSON USING
    CASE
      WHEN "internalNotes" IS NULL OR "internalNotes" = '' THEN '{}'::JSON
      ELSE "internalNotes"::JSON
    END,
  ALTER COLUMN "internalNotes" SET DEFAULT '{}';

CREATE OR REPLACE VIEW "purchasingRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rfq.*,
    l."name" AS "locationName",
    (SELECT COUNT(*) FROM "purchasingRfqSupplier" rs WHERE rs."purchasingRfqId" = rfq.id) AS "supplierCount",
    (SELECT COALESCE(array_agg(s."id" ORDER BY s."id"), ARRAY[]::TEXT[]) FROM "purchasingRfqSupplier" rs JOIN "supplier" s ON s.id = rs."supplierId" WHERE rs."purchasingRfqId" = rfq.id) AS "supplierIds",
    EXISTS(SELECT 1 FROM "purchasingRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "purchasingRfq" rfq
  LEFT JOIN "location" l ON l.id = rfq."locationId";
