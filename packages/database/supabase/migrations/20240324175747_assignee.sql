DROP VIEW "customers";
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    c.*,
    ct.name AS "type",
    cs.name AS "status"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId";

DROP VIEW "parts";
CREATE OR REPLACE VIEW "parts" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i.blocked,
    p.*,
    pg.name AS "itemGroup",
    ps."supplierIds"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ps."supplierId") AS "supplierIds"
    FROM "itemSupplier" ps
    GROUP BY "itemId"
  )  ps ON ps."itemId" = p."itemId";
  
DROP VIEW "purchaseOrders";
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

DROP VIEW "purchaseInvoices";
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS 
  SELECT 
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."supplierReference",
    pi."invoiceSupplierId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
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
    pi."customFields",
    pi."companyId",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Submitted' THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    pt."name" AS "paymentTermName"
  FROM "purchaseInvoice" pi
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId";

DROP VIEW "quotes";
ALTER TABLE "quote" DROP COLUMN "ownerId";
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  l."name" AS "locationName",
  ql."itemIds",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      array_agg("itemId") AS "itemIds"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "location" l
    ON l.id = q."locationId";

DROP VIEW "receipts";
CREATE OR REPLACE VIEW "receipts" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    r.*,
    l."name" as "locationName"
  FROM "receipt" r
  LEFT JOIN "location" l
    ON l.id = r."locationId";

DROP VIEW "requestForQuotes";
CREATE OR REPLACE VIEW "requestForQuotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  r.*,
  l."name" AS "locationName",
  rs."supplierIds",
  rp."itemIds",
  EXISTS(SELECT 1 FROM "requestForQuoteFavorite" pf WHERE pf."requestForQuoteId" = r.id AND pf."userId" = auth.uid()::text) AS favorite
FROM "requestForQuote" r
LEFT JOIN "location" l
  ON l.id = r."locationId"
LEFT JOIN (
  SELECT
    "requestForQuoteId",
    array_agg(rs."supplierId") AS "supplierIds"
  FROM "requestForQuoteSupplier" rs
  GROUP BY "requestForQuoteId"
) rs
  ON rs."requestForQuoteId" = r.id
LEFT JOIN (
  SELECT
    "requestForQuoteId",
    array_agg(rp."itemId") AS "itemIds"
  FROM "requestForQuoteLine" rp
  GROUP BY "requestForQuoteId"
) rp
  ON rp."requestForQuoteId" = r.id;

DROP VIEW "services";
CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    i.name,
    i.description,
    i."itemGroupId",
    i.active,
    i.blocked,
    pg.name AS "itemGroup",
    ss."supplierIds"
  FROM "service" s
  INNER JOIN "item" i ON i.id = s."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "serviceId",
      array_agg(ss."supplierId") AS "supplierIds"
    FROM "serviceSupplier" ss
    GROUP BY "serviceId"
  )  ss ON ss."serviceId" = s.id;
  

DROP VIEW "suppliers";
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
    FROM "itemSupplier"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id;