-- Customer additional fields
ALTER TABLE "customer" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "customer" ADD CONSTRAINT "customer_currencyCode_fkey" 
  FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer" ADD COLUMN "phone" TEXT;
ALTER TABLE "customer" ADD COLUMN "fax" TEXT;
ALTER TABLE "customer" ADD COLUMN "website" TEXT;

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

-- Supplier additional fields
ALTER TABLE "supplier" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_currencyCode_fkey" 
  FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier" ADD COLUMN "phone" TEXT;
ALTER TABLE "supplier" ADD COLUMN "fax" TEXT;
ALTER TABLE "supplier" ADD COLUMN "website" TEXT;

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
    FROM "buyMethod"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id;