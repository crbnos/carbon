ALTER TABLE "purchaseOrderLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;

ALTER TABLE "partSupplier" ADD COLUMN "unitPrice" NUMERIC(10, 2) DEFAULT 0;

ALTER TABLE "unitOfMeasure" DROP CONSTRAINT "unitOfMeasure_code_check";

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    pol.*,
    po."supplierId" ,
    -- p.name AS "partName",
    -- p.description AS "partDescription",
    ps."supplierPartId",
    s.name AS "serviceName",
    s.description AS "serviceDescription",
    ss."supplierServiceId"
  FROM "purchaseOrderLine" pol
    INNER JOIN "purchaseOrder" po 
      ON po.id = pol."purchaseOrderId"
    LEFT OUTER JOIN "part" p
      ON p.id = pol."partId"
    LEFT OUTER JOIN "partSupplier" ps 
      ON p.id = ps."partId" AND po."supplierId" = ps."supplierId"
    LEFT OUTER JOIN "service" s
      ON s.id = pol."serviceId"
    LEFT OUTER JOIN "serviceSupplier" ss 
      ON s.id = ss."serviceId" AND po."supplierId" = ss."supplierId";

ALTER TABLE "receiptLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;

