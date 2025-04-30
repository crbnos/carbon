-- Drop existing constraints
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT "purchaseInvoiceLines_accountNumber_fkey";

ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT "purchaseInvoiceLines_inventoryUnitOfMeasureCode_fkey";
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT "purchaseInvoiceLines_purchaseUnitOfMeasureCode_fkey";
ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT "purchaseInvoiceLines_companyId_fkey";

-- Add constraints with ON DELETE CASCADE
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_accountNumber_fkey" 
  FOREIGN KEY ("accountNumber", "companyId") REFERENCES "account" ("number", "companyId") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_inventoryUnitOfMeasureCode_fkey" 
  FOREIGN KEY ("inventoryUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_purchaseUnitOfMeasureCode_fkey" 
  FOREIGN KEY ("purchaseUnitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure" ("code", "companyId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLines_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE;


-- Drop existing constraint for externalLink
ALTER TABLE "externalLink" DROP CONSTRAINT "externalLinks_customerId_fkey";

-- Add constraint with ON DELETE CASCADE
ALTER TABLE "externalLink" ADD CONSTRAINT "externalLinks_customerId_fkey" 
  FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE;