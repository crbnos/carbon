DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType",
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    l."name" AS "locationName",
    EXISTS(SELECT 1 FROM "salesOrderFavorite" sf WHERE sf."salesOrderId" = s.id AND sf."userId" = auth.uid()::text) AS favorite
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT 
      "salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "salesOrderLine"
    INNER JOIN "item" i
      ON i."id" = "salesOrderLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingMethod" sm ON sm."id" = ss."shippingMethodId"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  LEFT JOIN "location" l ON l."id" = ss."locationId";

DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite,
  opp."salesRfqId",
  opp."salesOrderId",
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
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;