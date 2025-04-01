ALTER TYPE "purchaseOrderType" ADD VALUE 'Outside Processing';

ALTER TABLE "purchaseOrder" ADD COLUMN "purchaseOrderType" "purchaseOrderType" NOT NULL DEFAULT 'Purchase';
ALTER TABLE "purchaseOrder" ADD COLUMN "jobId" TEXT;
ALTER TABLE "purchaseOrder" ADD CONSTRAINT "purchaseOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchaseOrder" ADD COLUMN "jobReadableId" TEXT;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "jobId" TEXT;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "jobOperationId" TEXT;
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

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


ALTER TABLE "purchaseOrderLine" ADD COLUMN "quantityShipped" NUMERIC;

ALTER TABLE "shipment" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipment" ADD COLUMN "supplierInteractionId" TEXT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_supplierInteractionId_fkey" FOREIGN KEY ("supplierInteractionId") REFERENCES "supplierInteraction" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "methodOperation" ADD COLUMN "operationMinimumCost" NUMERIC DEFAULT 0;
ALTER TABLE "methodOperation" ADD COLUMN "operationLeadTime" NUMERIC DEFAULT 0;
ALTER TABLE "methodOperation" ADD COLUMN "operationUnitCost" NUMERIC DEFAULT 0;

