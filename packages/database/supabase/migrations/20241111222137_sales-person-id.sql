ALTER TABLE "salesRfq" ADD COLUMN "salesPersonId" TEXT;
ALTER TABLE "salesOrder" ADD COLUMN "salesPersonId" TEXT;

DROP VIEW "salesRfqs";
CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  opp."quoteId",
  opp."salesOrderId",
  EXISTS(SELECT 1 FROM "salesRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."salesRfqId" = rfq.id;

DROP VIEW "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
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