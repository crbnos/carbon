DROP VIEW IF EXISTS "quoteLines";
DROP VIEW IF EXISTS "supplierQuoteLines";

ALTER TABLE "quoteLinePrice" 
  DROP COLUMN IF EXISTS "convertedUnitPrice",
  DROP COLUMN IF EXISTS "convertedNetUnitPrice", 
  DROP COLUMN IF EXISTS "convertedNetExtendedPrice",
  DROP COLUMN IF EXISTS "convertedShippingCost",
  DROP COLUMN IF EXISTS "netUnitPrice",
  DROP COLUMN IF EXISTS "netExtendedPrice",
  ALTER COLUMN "unitPrice" TYPE NUMERIC(16,5),
  ALTER COLUMN "shippingCost" TYPE NUMERIC(16,5),
  ADD COLUMN "convertedUnitPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED,
  ADD COLUMN "netUnitPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent")) STORED,
  ADD COLUMN "netExtendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent") * "quantity") STORED,
  ADD COLUMN "convertedNetUnitPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent")) STORED,
  ADD COLUMN "convertedNetExtendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent") * "quantity") STORED,
  ADD COLUMN "convertedShippingCost" NUMERIC(16,5) GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED;

-- Drop dependent views first
DROP VIEW IF EXISTS "salesOrderLines";
DROP VIEW IF EXISTS "salesOrders";

-- Update salesOrderLine columns
ALTER TABLE "salesOrderLine"
  DROP COLUMN IF EXISTS "convertedAddOnCost",
  DROP COLUMN IF EXISTS "convertedShippingCost",
  DROP COLUMN IF EXISTS "convertedUnitPrice",
  ALTER COLUMN "unitPrice" TYPE NUMERIC(16,5),
  ALTER COLUMN "setupPrice" TYPE NUMERIC(16,5),
  ALTER COLUMN "addOnCost" TYPE NUMERIC(16,5),
  ALTER COLUMN "shippingCost" TYPE NUMERIC(16,5),
  ADD COLUMN "convertedAddOnCost" NUMERIC(16,5) GENERATED ALWAYS AS ("addOnCost" * "exchangeRate") STORED,
  ADD COLUMN "convertedShippingCost" NUMERIC(16,5) GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  ADD COLUMN "convertedUnitPrice" NUMERIC(16,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED;



DROP VIEW IF EXISTS "purchaseOrderLines";
DROP VIEW IF EXISTS "purchaseOrders";

-- Update purchaseOrderLine columns
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "taxAmount";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "supplierExtendedPrice";
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "taxPercent";

ALTER TABLE "purchaseOrderLine" ALTER COLUMN "supplierUnitPrice" TYPE NUMERIC(16,5);
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "supplierShippingCost" TYPE NUMERIC(16,5);
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "supplierTaxAmount" TYPE NUMERIC(16,5);

ALTER TABLE "purchaseOrderLine" ADD COLUMN "unitPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "supplierExtendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "extendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "shippingCost" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxAmount" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN (("supplierUnitPrice" + "supplierShippingCost") * "purchaseQuantity") = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "purchaseQuantity")
  END
) STORED;



DROP VIEW IF EXISTS "purchaseInvoiceLines";
DROP VIEW IF EXISTS "purchaseInvoices";


-- Update itemUnitSalePrice columns
ALTER TABLE "itemUnitSalePrice"
  ALTER COLUMN "unitSalePrice" TYPE NUMERIC(16,5);

-- Update itemCost columns
ALTER TABLE "itemCost"
  ALTER COLUMN "unitCost" TYPE NUMERIC(16,5);



-- Update purchaseInvoiceLine columns
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "totalAmount";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "taxAmount";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "supplierExtendedPrice";
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "taxPercent";
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "supplierUnitPrice" TYPE NUMERIC(16,5);
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "supplierShippingCost" TYPE NUMERIC(16,5);
ALTER TABLE "purchaseInvoiceLine" ALTER COLUMN "supplierTaxAmount" TYPE NUMERIC(16,5);

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "supplierExtendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "unitPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "extendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "shippingCost" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxAmount" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN (("supplierUnitPrice" + "supplierShippingCost") * "quantity") = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "quantity")
  END
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "totalAmount" NUMERIC(16,5) GENERATED ALWAYS AS (
  ("supplierUnitPrice" * "quantity" * "exchangeRate") + 
  ("supplierShippingCost" * "exchangeRate") + 
  ("supplierTaxAmount" * "exchangeRate")
) STORED;



-- Update supplierQuoteLinePrice columns
-- First drop the generated columns that depend on the columns we want to modify
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "supplierExtendedPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "extendedPrice";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "taxAmount";
ALTER TABLE "supplierQuoteLinePrice" DROP COLUMN IF EXISTS "taxPercent";

-- Now we can modify the base columns
ALTER TABLE "supplierQuoteLinePrice"
  ALTER COLUMN "supplierUnitPrice" TYPE NUMERIC(16,5),
  ALTER COLUMN "supplierShippingCost" TYPE NUMERIC(16,5),
  ALTER COLUMN "supplierTaxAmount" TYPE NUMERIC(16,5),
  ALTER COLUMN "quantity" TYPE NUMERIC(16,5);

-- Finally recreate the generated columns
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "unitPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "supplierExtendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "quantity"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "extendedPrice" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "quantity"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "shippingCost" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxAmount" NUMERIC(16,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN ("supplierUnitPrice" + "supplierShippingCost") * "quantity" = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "quantity")
  END
) STORED;


DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal",
    sl."jobs",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    l."name" AS "locationName"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT 
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM((1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0))) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE 
          WHEN j.id IS NOT NULL THEN json_build_object('id', j.id, 'jobId', j."jobId", 'status', j."status")
          ELSE NULL 
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "location" l ON l."id" = ss."locationId";


DROP VIEW IF EXISTS "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);

DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType", 
    pl."orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    l."id" AS "locationId",
    l."name" AS "locationName"
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
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "location" l ON l."id" = pd."locationId";


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
    pl."orderTotal",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Submitted' THEN 'Overdue'
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
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId";

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

DROP VIEW IF EXISTS "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

DROP VIEW IF EXISTS "supplierQuoteLines";
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."type" as "itemType",
    COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
    ic."unitCost" as "unitCost"
  FROM "supplierQuoteLine" ql
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
);