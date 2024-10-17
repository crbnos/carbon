-- Quote currency
ALTER TABLE "quote" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "quote" ADD COLUMN "exchangeRate" NUMERIC(10,4);
ALTER TABLE "quote" ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_currencyCode_fkey" 
  FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

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

-- Sales Order currency
ALTER TABLE "salesOrder" ALTER COLUMN "currencyCode" DROP DEFAULT;
ALTER TABLE "salesOrder" ADD COLUMN "exchangeRate" NUMERIC(10,4);
ALTER TABLE "salesOrder" ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "salesOrder" DROP CONSTRAINT "salesOrder_currencyCode_fkey";
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_currencyCode_fkey" 
  FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

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

-- Purchase Order currency
ALTER TABLE "purchaseOrder" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "purchaseOrder" ADD COLUMN "exchangeRate" NUMERIC(10,4);
ALTER TABLE "purchaseOrder" ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "purchaseOrder" ADD CONSTRAINT "purchaseOrder_currencyCode_fkey" 
  FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    sm."name" AS "shippingMethodName",
    st."name" AS "shippingTermName",
    pt."name" AS "paymentTermName",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."dropShipment",
    l."id" AS "locationId",
    l."name" AS "locationName",
    EXISTS(SELECT 1 FROM "purchaseOrderFavorite" pf WHERE pf."purchaseOrderId" = p.id AND pf."userId" = auth.uid()::text) AS favorite
  FROM "purchaseOrder" p
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingMethod" sm ON sm."id" = pd."shippingMethodId"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pp."paymentTermId"
  LEFT JOIN "location" l ON l."id" = pd."locationId";

-- Remove currencyCode from customerPayment, supplierPayment, quotePayment, salesOrderPayment, and purchaseOrderPayment
ALTER TABLE "customerPayment" DROP COLUMN "currencyCode";
ALTER TABLE "supplierPayment" DROP COLUMN "currencyCode";
ALTER TABLE "quotePayment" DROP COLUMN "currencyCode";
ALTER TABLE "salesOrderPayment" DROP COLUMN "currencyCode";
ALTER TABLE "purchaseOrderPayment" DROP COLUMN "currencyCode";

-- Fix the currency RLS policies
DROP POLICY IF EXISTS "Employees with accounting_view can view currencies" ON "currency";
CREATE POLICY "Employees with accounting_view can view currencies" ON "currency"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('accounting_view', "companyId")
  );

DROP POLICY IF EXISTS "Employees with accounting_create can insert currencies" ON "currency";
DROP POLICY IF EXISTS "Employees with accounting_delete can delete currencies" ON "currency";

-- Add exchangeRate and convertedUnitPrice to quoteLinePrice
ALTER TABLE "quoteLinePrice" ADD COLUMN "exchangeRate" NUMERIC(10,4) DEFAULT 1;
ALTER TABLE "quoteLinePrice" ADD COLUMN "convertedUnitPrice" NUMERIC(10,5) GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED;

-- Add a trigger to update the exchangeRate on quoteLinePrice when the exchangeRate is updated
CREATE OR REPLACE FUNCTION update_quote_line_price_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "quoteLinePrice"
  SET "exchangeRate" = NEW."exchangeRate"
  WHERE "quoteId" = NEW."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_quote_line_price_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "quote"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_quote_line_price_exchange_rate();
