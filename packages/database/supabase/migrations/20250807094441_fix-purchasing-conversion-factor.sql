DROP VIEW IF EXISTS "purchaseOrders";
DROP VIEW IF EXISTS "purchaseOrderLines";
DROP VIEW IF EXISTS "purchaseInvoices";
DROP VIEW IF EXISTS "purchaseInvoiceLines";

-- Fix purchasing conversion factors
-- The exchange rate should be used to convert FROM supplier currency TO base currency
-- So we need to divide by exchange rate, not multiply

-- Fix supplierQuoteLinePrice columns
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "taxAmount";

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "quantity"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

-- Fix purchaseOrderLine columns
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "taxAmount";

ALTER TABLE "purchaseOrderLine" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

-- Fix purchaseInvoiceLine columns
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "taxAmount";

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "unitPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "extendedPrice" NUMERIC GENERATED ALWAYS AS (
  "supplierUnitPrice" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "shippingCost" NUMERIC GENERATED ALWAYS AS (
  "supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxAmount" NUMERIC GENERATED ALWAYS AS (
  "supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END
) STORED;

-- Fix totalAmount column for purchaseInvoiceLine
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "totalAmount";
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "totalAmount" NUMERIC GENERATED ALWAYS AS (
  ("supplierUnitPrice" * "quantity" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END) + 
  ("supplierShippingCost" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END) + 
  ("supplierTaxAmount" / CASE WHEN "exchangeRate" = 0 THEN 1 ELSE "exchangeRate" END)
) STORED;


DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType", 
    pl."orderTotal" + pd."supplierShippingCost" * CASE WHEN p."exchangeRate" = 0 THEN 1 ELSE p."exchangeRate" END AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT 
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id";


DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
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

DROP VIEW IF EXISTS "purchaseInvoices";
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    pi."subtotal",
    pi."totalDiscount",
    pi."totalAmount",
    pi."totalTax",
    pi."balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."datePaid" IS NULL THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    pt."name" AS "paymentTermName"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT 
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."quantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id";

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
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