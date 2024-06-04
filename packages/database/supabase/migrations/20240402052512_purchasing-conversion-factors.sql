ALTER TABLE "purchaseOrderLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;

ALTER TABLE "itemSupplier" ADD COLUMN "unitPrice" NUMERIC(10, 2) DEFAULT 0;

ALTER TABLE "unitOfMeasure" DROP CONSTRAINT "unitOfMeasure_code_check";

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    pol.*,
    po."supplierId" ,
    i.name as "itemName",
    i.description as "itemDescription",
    ps."supplierPartId"
  FROM "purchaseOrderLine" pol
    INNER JOIN "purchaseOrder" po 
      ON po.id = pol."purchaseOrderId"
    -- TODO: this is an unnecessary join, we should remove it after replacing PO line with item instead of part
    LEFT OUTER JOIN "item" i
      ON i.id = pol."itemId"
    LEFT OUTER JOIN "itemSupplier" ps 
      ON i.id = ps."itemId" AND po."supplierId" = ps."supplierId";

ALTER TABLE "receiptLine" ADD COLUMN "conversionFactor" NUMERIC(10, 2) DEFAULT 1;

