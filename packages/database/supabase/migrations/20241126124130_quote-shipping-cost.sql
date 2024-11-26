ALTER TABLE "quoteShipment" ADD COLUMN "shippingCost" NUMERIC(10,4) DEFAULT 0;
ALTER TABLE "salesOrderShipment" ADD COLUMN "shippingCost" NUMERIC(10,4) DEFAULT 0;


DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
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
      COUNT("id") FILTER (WHERE "status" != 'No Quote') AS "lines",
      COUNT("id") FILTER (WHERE "status" = 'Complete') AS "completedLines"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    l."name" AS "locationName",
    c."name" AS "customerName",
    u."avatarUrl" AS "createdByAvatar",
    u."fullName" AS "createdByFullName",
    u2."avatarUrl" AS "updatedByAvatar",
    u2."fullName" AS "updatedByFullName",
    u3."avatarUrl" AS "closedByAvatar",
    u3."fullName" AS "closedByFullName",
    EXISTS(SELECT 1 FROM "salesOrderFavorite" sf WHERE sf."salesOrderId" = s.id AND sf."userId" = auth.uid()::text) AS favorite
  FROM "salesOrder" s
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingMethod" sm ON sm."id" = ss."shippingMethodId"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  LEFT JOIN "location" l ON l."id" = ss."locationId"
  LEFT JOIN "customer" c ON c."id" = s."customerId"
  LEFT JOIN "user" u ON u."id" = s."createdBy"
  LEFT JOIN "user" u2 ON u2."id" = s."updatedBy"
  LEFT JOIN "user" u3 ON u3."id" = s."closedBy";