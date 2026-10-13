-- A journal line or a document line must never lose its account. SET NULL
-- silently emptied Draft and Provisional lines when an account was deleted.
-- RESTRICT refuses the delete, so the user deactivates the account instead.

ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountId_fkey";
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "salesOrderLine" DROP CONSTRAINT IF EXISTS "salesOrderLine_accountId_fkey";
ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "salesInvoiceLine" DROP CONSTRAINT IF EXISTS "salesInvoiceLine_accountId_fkey";
ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "purchaseInvoiceLine" DROP CONSTRAINT IF EXISTS "purchaseInvoiceLine_accountId_fkey";
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "supplierQuoteLine" DROP CONSTRAINT IF EXISTS "supplierQuoteLine_accountId_fkey";
ALTER TABLE "supplierQuoteLine" ADD CONSTRAINT "supplierQuoteLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
