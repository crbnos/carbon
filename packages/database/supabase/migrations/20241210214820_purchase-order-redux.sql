DROP VIEW "purchaseOrders";
DROP VIEW "purchaseOrderLines";

ALTER TABLE "purchaseOrder" DROP COLUMN "notes";
ALTER TABLE "purchaseOrderLine" DROP COLUMN "notes";
ALTER TABLE "purchaseOrder" DROP COLUMN "type";


ALTER TABLE "purchaseOrderLine" ADD COLUMN "internalNotes" JSON DEFAULT '{}'::JSON;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "externalNotes" JSON DEFAULT '{}'::JSON;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "exchangeRate" NUMERIC(10,4) DEFAULT 1;

ALTER TABLE "purchaseOrderLine" RENAME COLUMN "unitPrice" TO "supplierUnitPrice";
ALTER TABLE "purchaseOrderLine" ADD COLUMN "unitPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "supplierExtendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "extendedPrice" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierUnitPrice" * "exchangeRate" * "purchaseQuantity"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "supplierShippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "shippingCost" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierShippingCost" * "exchangeRate"
) STORED;

ALTER TABLE "purchaseOrderLine" ADD COLUMN "modelUploadId" TEXT REFERENCES "modelUpload"("id") ON DELETE SET NULL;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "supplierTaxAmount" NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxAmount" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" * "exchangeRate"
) STORED;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "taxPercent" NUMERIC(10,5) GENERATED ALWAYS AS (
  "supplierTaxAmount" / (("supplierUnitPrice" + "supplierShippingCost") * "purchaseQuantity")
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
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."supplierUnitPrice", 0)) + COALESCE(pol."supplierShippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
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
AFTER UPDATE OF "exchangeRate" ON "supplierQuote"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_purchase_order_line_price_exchange_rate();

