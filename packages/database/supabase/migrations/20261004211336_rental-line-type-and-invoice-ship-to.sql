-- 1) No field is called "kind" (.claude/rules/conventions-database.md). The rental
--    invoice line's Rent / Charge / Purchase Option is its line type; a charge's is
--    its charge type.
ALTER TYPE "rentalInvoiceLineKind" RENAME TO "rentalInvoiceLineType";
ALTER TABLE "salesInvoiceLine" RENAME COLUMN "rentalInvoiceLineKind" TO "rentalLineType";
ALTER TABLE "rentalAgreementCharge" RENAME COLUMN "kind" TO "chargeType";

-- A view keeps the output names it was created with, so sl.* must be re-expanded.
-- Definition unchanged from 20261004014728.
DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId"
     FROM "customerPartToItem" cp
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id
     LIMIT 1) as "customerPartId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

-- 2) A sales invoice's customer ship-to, as on salesOrderShipment. A contract copies
--    its ship-to here when it drafts an invoice; an invoice converted from an order
--    copies the order's.
ALTER TABLE "salesInvoiceShipment"
  ADD COLUMN IF NOT EXISTS "customerLocationId" TEXT REFERENCES "customerLocation"("id");
CREATE INDEX IF NOT EXISTS "salesInvoiceShipment_customerLocationId_idx"
  ON "salesInvoiceShipment" ("customerLocationId");
