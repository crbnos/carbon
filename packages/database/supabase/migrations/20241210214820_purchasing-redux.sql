DROP VIEW "purchaseOrders";
DROP VIEW "purchaseOrderLines";

ALTER TABLE "purchaseOrder" DROP COLUMN IF EXISTS "notes";
ALTER TABLE "purchaseOrder" DROP COLUMN IF EXISTS "type";

ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "notes";
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "internalNotes" JSON DEFAULT '{}'::JSON;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "externalNotes" JSON DEFAULT '{}'::JSON;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "exchangeRate" NUMERIC(10,4) DEFAULT 1;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'purchaseOrderLine' 
    AND column_name = 'supplierUnitPrice'
  ) THEN
    ALTER TABLE "purchaseOrderLine" RENAME COLUMN "unitPrice" TO "supplierUnitPrice";
  END IF;
END $$;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "unitPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierExtendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "extendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierShippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "shippingCost" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE SET NULL;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierTaxAmount" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxAmount" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN (("supplierUnitPrice" + "supplierShippingCost") * "purchaseQuantity") = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "purchaseQuantity")
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

ALTER TABLE "purchaseOrder" ALTER COLUMN "exchangeRate" SET DEFAULT 1;
UPDATE "purchaseOrder" SET "exchangeRate" = 1 WHERE "exchangeRate" IS NULL;
ALTER TABLE "purchaseOrderLine" ALTER COLUMN "exchangeRate" SET NOT NULL;


CREATE OR REPLACE FUNCTION update_purchase_order_line_price_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "purchaseOrderLine"
  SET "exchangeRate" = NEW."exchangeRate"
  WHERE "purchaseOrderId" = NEW."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER update_purchase_order_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "purchaseOrder"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_purchase_order_line_price_exchange_rate();


ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    s.*,
    st.name AS "type",    
    ss.name AS "status",
    po.count AS "orderCount",
    p.count AS "partCount"
  FROM "supplier" s
  LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
  LEFT JOIN "supplierStatus" ss ON ss.id = s."supplierStatusId"
  LEFT JOIN (
    SELECT 
      "supplierId",
      COUNT(*) AS "count"
    FROM "purchaseOrder"
    GROUP BY "supplierId"
  ) po ON po."supplierId" = s.id
  LEFT JOIN (
    SELECT 
      "supplierId",
      COUNT(*) AS "count"
    FROM "supplierPart"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id;


DROP VIEW IF EXISTS "supplierQuoteLines";
ALTER TABLE "supplierQuoteLine" DROP COLUMN IF EXISTS "notes";
ALTER TABLE "supplierQuoteLine" DROP COLUMN IF EXISTS "taxPercent";
ALTER TABLE "supplierQuoteLine" ADD COLUMN IF NOT EXISTS "internalNotes" JSON DEFAULT '{}'::JSON;
ALTER TABLE "supplierQuoteLine" ADD COLUMN IF NOT EXISTS "externalNotes" JSON DEFAULT '{}'::JSON;

DROP VIEW IF EXISTS "supplierQuoteLines";
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."type" as "itemType",
    i."thumbnailPath",
    ic."unitCost" as "unitCost"
  FROM "supplierQuoteLine" ql
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
);

ALTER TABLE "purchaseOrder" 
  ALTER COLUMN "orderDate" DROP DEFAULT,
  ALTER COLUMN "orderDate" DROP NOT NULL;

ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "internalNotes" JSON DEFAULT '{}'::JSON;

DROP VIEW IF EXISTS "receipts";

ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "purchaseOrderId";
ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "purchaseOrderCompletedDate";
ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "supplierQuoteId";
ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "supplierQuoteCompletedDate";
ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "quoteDocumentPath";
ALTER TABLE "supplierInteraction" DROP COLUMN IF EXISTS "salesOrderDocumentPath";

ALTER TABLE "supplierQuote" ADD COLUMN IF NOT EXISTS "supplierInteractionId" TEXT NOT NULL REFERENCES "supplierInteraction"("id") ON DELETE RESTRICT;

ALTER TABLE "purchaseOrder" ADD COLUMN IF NOT EXISTS "supplierInteractionId" TEXT NOT NULL REFERENCES "supplierInteraction"("id") ON DELETE RESTRICT;
ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "supplierInteractionId" TEXT REFERENCES "supplierInteraction"("id") ON DELETE RESTRICT;

ALTER TABLE "purchaseInvoice" ADD COLUMN "supplierInteractionId" TEXT NOT NULL REFERENCES "supplierInteraction"("id") ON DELETE RESTRICT;


DROP VIEW IF EXISTS "supplierQuotes";
CREATE OR REPLACE VIEW "supplierQuotes"
WITH
  (SECURITY_INVOKER = true) AS
SELECT
  q.*,
  ql."thumbnailPath",
  ql."itemType"
FROM
  "supplierQuote" q
  LEFT JOIN (
    SELECT
      "supplierQuoteId",
      MIN(
        CASE
          WHEN i."thumbnailPath" IS NULL
          AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
          ELSE i."thumbnailPath"
        END
      ) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM
      "supplierQuoteLine"
      INNER JOIN "item" i ON i."id" = "supplierQuoteLine"."itemId"
      LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY
      "supplierQuoteId"
  ) ql ON ql."supplierQuoteId" = q.id;

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


DROP VIEW IF EXISTS "purchaseInvoiceLines";

ALTER TABLE "purchaseInvoice" ADD COLUMN "internalNotes" JSON DEFAULT '{}'::JSON;
ALTER TABLE "purchaseInvoice" ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "purchaseInvoice" ADD COLUMN "locationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL;

ALTER TABLE "purchaseInvoiceLine" DROP COLUMN "currencyCode";
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "internalNotes" JSON DEFAULT '{}'::JSON;

ALTER TABLE "purchaseInvoiceLine" RENAME COLUMN "unitPrice" TO "supplierUnitPrice";
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "unitPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "supplierExtendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "extendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "quantity"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "supplierShippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "shippingCost" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE SET NULL;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "supplierTaxAmount" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxAmount" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN (("supplierUnitPrice" + "supplierShippingCost") * "quantity") = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "quantity")
  END
) STORED;

CREATE OR REPLACE FUNCTION update_purchase_invoice_line_price_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "purchaseInvoiceLine"
  SET "exchangeRate" = NEW."exchangeRate"
  WHERE "purchaseInvoiceId" = NEW."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER update_purchase_invoice_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "purchaseInvoice"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_purchase_invoice_line_price_exchange_rate();

DROP VIEW "purchaseInvoices";
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

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "supplierTaxAmount" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxAmount" NUMERIC(10,5) GENERATED ALWAYS AS ("supplierTaxAmount" * "exchangeRate") STORED;
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  CASE 
    WHEN ("supplierUnitPrice" + "supplierShippingCost") * "quantity" = 0 THEN 0
    ELSE "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "quantity")
  END
) STORED;