ALTER TABLE "purchaseOrderDelivery" 
ADD COLUMN IF NOT EXISTS "supplierShippingCost" NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE "costLedger" RENAME COLUMN IF EXISTS "costPostedToGL" TO "nominalCost";
ALTER TABLE "costLedger" ADD COLUMN IF NOT EXISTS "supplierId" TEXT REFERENCES "supplier" ("id");
ALTER TABLE "costLedger" DROP COLUMN IF EXISTS "itemReadableId";

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('purchaseInvoiceDelivery', 'Purchase Invoice Delivery', 'Invoicing');

CREATE TABLE "purchaseInvoiceDelivery" (
  "id" TEXT NOT NULL,
  "locationId" TEXT,
  "shippingMethodId" TEXT,
  "shippingTermId" TEXT,
  "supplierShippingCost" NUMERIC NOT NULL DEFAULT 0,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "purchaseInvoiceDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchaseInvoiceDelivery_id_fkey" FOREIGN KEY ("id") REFERENCES "purchaseInvoice" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoiceDelivery_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoiceDelivery_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "shippingMethod" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoiceDelivery_shippingTermId_fkey" FOREIGN KEY ("shippingTermId") REFERENCES "shippingTerm" ("id") ON DELETE CASCADE,
  CONSTRAINT "purchaseInvoiceDelivery_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT
);


CREATE POLICY "Employees with invoicing_view can view purchase invoice deliveries" ON "purchaseInvoiceDelivery"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('invoicing_view', "companyId")
  );
  

CREATE POLICY "Employees with invoicing_create can insert purchase invoice deliveries" ON "purchaseInvoiceDelivery"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('invoicing_create', "companyId")
);

CREATE POLICY "Employees with invoicing_update can update purchase invoice deliveries" ON "purchaseInvoiceDelivery"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('invoicing_update', "companyId")
  );

CREATE POLICY "Employees with invoicing_delete can delete purchase invoice deliveries" ON "purchaseInvoiceDelivery"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('invoicing_delete', "companyId")
  );


-- Backfill purchaseInvoiceDelivery table for existing purchase invoices
WITH supplier_shipping AS (
  SELECT 
    ss."supplierId",
    ss."shippingMethodId",
    ss."shippingTermId"
  FROM "supplierShipping" ss
),
purchase_invoices AS (
  SELECT 
    pi."id",
    pi."supplierId",
    pi."companyId",
    pi."locationId"
  FROM "purchaseInvoice" pi
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pi.id = pid.id
  WHERE pid.id IS NULL
)
INSERT INTO "purchaseInvoiceDelivery" (
  "id",
  "locationId", 
  "shippingMethodId",
  "shippingTermId",
  "companyId"
)
SELECT
  pi."id",
  pi."locationId",
  ss."shippingMethodId",
  ss."shippingTermId", 
  pi."companyId"
FROM purchase_invoices pi
LEFT JOIN supplier_shipping ss ON pi."supplierId" = ss."supplierId";



DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType", 
    pl."orderTotal" + pd."supplierShippingCost" * p."exchangeRate" AS "orderTotal",
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
    pl."orderTotal" + COALESCE(pid."supplierShippingCost", 0) * pi."exchangeRate" AS "orderTotal",
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
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id";


DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost"
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
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id";