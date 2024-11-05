-- Add taxPercent to quote
ALTER TABLE "quote"
  ADD COLUMN "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

DROP VIEW IF EXISTS "quotes";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite,
  opp."salesRfqId",
  opp."salesOrderId"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("id") FILTER (WHERE "status" != 'No Quote') AS "lines",
      COUNT("id") FILTER (WHERE "status" = 'Complete') AS "completedLines"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;

-- Add shippingCost, convertedShippingCost, and taxPercent to quoteLinePrice
ALTER TABLE "quoteLinePrice" 
  ADD COLUMN "shippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0,
  ADD COLUMN "convertedShippingCost" NUMERIC(10,5) GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  ADD COLUMN "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

-- Add a trigger to update the taxPercent on quoteLinePrice when the taxPercent on quote is updated
CREATE OR REPLACE FUNCTION update_quote_line_price_tax_percent()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "quoteLinePrice"
  SET "taxPercent" = NEW."taxPercent"
  WHERE "quoteId" = NEW."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_quote_line_price_tax_percent_trigger
AFTER UPDATE OF "taxPercent" ON "quote"
FOR EACH ROW
WHEN (OLD."taxPercent" IS DISTINCT FROM NEW."taxPercent")
EXECUTE FUNCTION update_quote_line_price_tax_percent();

-- Add taxPercent to salesOrder
ALTER TABLE "salesOrder"
  ADD COLUMN "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

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

-- Add shippingCost, convertedShippingCost, and taxPercent to salesOrderLine
ALTER TABLE "salesOrderLine"
  ADD COLUMN "shippingCost" NUMERIC(10,5) NOT NULL DEFAULT 0,
  ADD COLUMN "convertedShippingCost" NUMERIC(10,5) GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  ADD COLUMN "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

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

-- Add a trigger to update the taxPercent on salesOrderLine when the taxPercent on salesOrder is updated
CREATE OR REPLACE FUNCTION update_sales_order_line_tax_percent()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "salesOrderLine"
  SET "taxPercent" = NEW."taxPercent"
  WHERE "salesOrderId" = NEW."id";  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_sales_order_line_tax_percent_trigger
AFTER UPDATE OF "taxPercent" ON "salesOrder"
FOR EACH ROW
WHEN (OLD."taxPercent" IS DISTINCT FROM NEW."taxPercent")
EXECUTE FUNCTION update_sales_order_line_tax_percent();

-- Add taxPercent to customer
ALTER TABLE "customer"
  ADD COLUMN "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1);

DROP VIEW "customers";
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    c.*,
    ct.name AS "type",
    cs.name AS "status",
    so.count AS "orderCount"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
  LEFT JOIN (
    SELECT 
      "customerId",
      COUNT(*) AS "count"
    FROM "salesOrder"
    GROUP BY "customerId"
  ) so ON so."customerId" = c.id;