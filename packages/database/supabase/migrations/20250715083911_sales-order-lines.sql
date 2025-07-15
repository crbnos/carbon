ALTER TABLE "salesRfq" ADD COLUMN "customerEngineeringContactId" TEXT REFERENCES "customerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD COLUMN "customerEngineeringContactId" TEXT REFERENCES "customerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salesOrder" ADD COLUMN "customerEngineeringContactId" TEXT REFERENCES "customerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



DROP VIEW IF EXISTS "salesRfqs";
CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName"
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId";

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    sl."lines",
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
      SUM(
        DISTINCT (1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0))
      ) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE 
          WHEN j.id IS NOT NULL THEN json_build_object(
            'id', j.id, 
            'jobId', j."jobId", 
            'status', CASE 
              WHEN j."status" = 'Cancelled' THEN 'Cancelled'
              WHEN j."dueDate" IS NOT NULL AND j."dueDate" < CURRENT_DATE THEN 'Overdue'
              WHEN j."dueDate" IS NOT NULL AND j."dueDate" = CURRENT_DATE THEN 'Due Today'
              ELSE j."status"
            END,
            'productionQuantity', j."productionQuantity",
            'quantityComplete', j."quantityComplete",
            'salesOrderLineId', sol.id,
            'assignee', j."assignee"
          )
          ELSE NULL 
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs",
      ARRAY_AGG(
        json_build_object(
          'id', sol.id,
          'methodType', sol."methodType",
          'saleQuantity', sol."saleQuantity"
        )
      ) AS "lines"
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


DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  qs."shippingCost"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" != 'No Quote') AS "lines",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" = 'Complete') AS "completedLines", 
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "quoteLine"
    INNER JOIN "item" i
      ON i."id" = "quoteLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId";

DROP FUNCTION IF EXISTS get_sales_order_lines(TEXT);
CREATE OR REPLACE FUNCTION get_sales_order_lines(customer_id TEXT)
RETURNS TABLE (
  "customerReference" TEXT,
  "salesOrderId" TEXT,
  "customerContactName" TEXT,
  "customerEngineeringContactName" TEXT,
  "saleQuantity" NUMERIC(9,2),
  "quantityToSend" NUMERIC(9,2),
  "quantitySent" NUMERIC(9,2),
  "quantityInvoiced" NUMERIC(9,2),
  "unitPrice" NUMERIC(9,2),
  "unitOfMeasureCode" TEXT,
  "locationId" TEXT,
  "orderDate" DATE,
  "promisedDate" DATE,
  "receiptRequestedDate" DATE,
  "receiptPromisedDate" DATE,
  "salesOrderStatus" "salesOrderStatus",
  "readableId" TEXT,
  "revision" TEXT,
  "readableIdWithRevision" TEXT,
  "customerId" TEXT,
  "thumbnailPath" TEXT,
  "jobOperations" JSONB,
  "jobQuantityShipped" NUMERIC(9,2),
  "jobQuantityComplete" NUMERIC(9,2),
  "jobProductionQuantity" NUMERIC(9,2),
  "jobStatus" "jobStatus"
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    so."customerReference",
    so."salesOrderId",
    COALESCE(pc."fullName", pc."email") AS "customerContactName",
    COALESCE(ec."fullName", ec."email") AS "customerEngineeringContactName",
    sol."saleQuantity",
    sol."quantityToSend",
    sol."quantitySent",
    sol."quantityInvoiced", 
    sol."unitPrice",
    sol."unitOfMeasureCode",
    sol."locationId",
    so."orderDate",
    sol."promisedDate",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    so."status" AS "salesOrderStatus",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    so."customerId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    COALESCE(
      (
        SELECT jsonb_agg(DISTINCT 
          jsonb_build_object(
            'id', jo.id,
            'jobId', jo."jobId",
            'order', jo."order",
            'status', jo.status,
            'description', jo."description",
            'operationType', jo."operationType",
            'operationQuantity', jo."operationQuantity",
            'quantityComplete', jo."quantityComplete"
          )
        )
        FROM "jobOperation" jo
        INNER JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
        WHERE jo."jobId" = j.id AND jmm."parentMaterialId" IS NULL
      ),
      '[]'::jsonb
    ) AS "jobOperations",
    j."quantityShipped" AS "jobQuantityShipped",
    j."quantityComplete" AS "jobQuantityComplete",
    j."productionQuantity" AS "jobProductionQuantity",
    j."status" AS "jobStatus"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so
    ON so."id" = sol."salesOrderId"
  LEFT JOIN "salesOrderShipment" ss 
    ON ss."id" = so."id"
  INNER JOIN "item" i
    ON i."id" = sol."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "job" j
    ON j."salesOrderLineId" = sol."id"
  LEFT JOIN "customerContact" pcc 
    ON pcc."id" = so."customerContactId"
  LEFT JOIN "contact" pc
    ON pc."id" = pcc."contactId"
  LEFT JOIN "customerContact" ecc
    ON ecc."id" = so."customerEngineeringContactId"
  LEFT JOIN "contact" ec
    ON ec."id" = ecc."contactId"
  WHERE so."customerId" = customer_id;
END;
$$ LANGUAGE plpgsql;
