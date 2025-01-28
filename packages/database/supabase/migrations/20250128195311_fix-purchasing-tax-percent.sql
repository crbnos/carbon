DROP VIEW IF EXISTS "purchaseOrderLines";
ALTER TABLE "purchaseOrderLine" DROP COLUMN "taxPercent";

DROP VIEW IF EXISTS "purchaseInvoiceLines";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN "taxPercent";

ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost") = 0 THEN 0
    ELSE "supplierTaxAmount" / ("supplierUnitPrice" * "purchaseQuantity" + "supplierShippingCost")
  END
) STORED;

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    sp."supplierPartId"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN ("supplierUnitPrice" * "quantity" + "supplierShippingCost") = 0 THEN 0
    ELSE "supplierTaxAmount" / ("supplierUnitPrice" * "quantity" + "supplierShippingCost")
  END
) STORED;

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
);

ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN "taxPercent";
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN ("supplierUnitPrice" * "quantity" + "supplierShippingCost")  = 0 THEN 0
    ELSE "supplierTaxAmount" / ("supplierUnitPrice" * "quantity" + "supplierShippingCost")
  END
) STORED;