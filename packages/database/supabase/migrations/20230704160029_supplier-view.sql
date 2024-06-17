CREATE OR REPLACE VIEW "suppliers" AS 
  SELECT 
    s.id,
    s.name,
    s."supplierTypeId",
    st.name AS "type",
    s."supplierStatusId",
    ss.name AS "status",
    po.count AS "orderCount",
    i.count AS "partCount",
    s."customFields",
    s."companyId"
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
  ) i ON i."supplierId" = s.id;

CREATE OR REPLACE VIEW "customers" AS 
  SELECT 
    c.id,
    c.name,
    c."customerTypeId",
    ct.name AS "type",
    c."customerStatusId",
    cs.name AS "status",
    c."customFields",
    c."companyId"
    -- so.count AS "orderCount"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId";

  -- LEFT JOIN (
  --   SELECT 
  --     "customerId",
  --     COUNT(*) AS "count"
  --   FROM "salesOrder"
  --   GROUP BY "customerId"
  -- ) so ON so."customerId" = c.id
