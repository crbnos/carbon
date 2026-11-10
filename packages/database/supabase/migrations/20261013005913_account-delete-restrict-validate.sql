-- Validates the account foreign keys 20261013005642 added NOT VALID. Its own
-- migration, so its own transaction: VALIDATE takes SHARE UPDATE EXCLUSIVE,
-- which lets writes continue while it scans the existing rows.

ALTER TABLE "journalLine" VALIDATE CONSTRAINT "journalLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" VALIDATE CONSTRAINT "purchaseOrderLine_accountId_fkey";
ALTER TABLE "salesOrderLine" VALIDATE CONSTRAINT "salesOrderLine_accountId_fkey";
ALTER TABLE "salesInvoiceLine" VALIDATE CONSTRAINT "salesInvoiceLine_accountId_fkey";
ALTER TABLE "purchaseInvoiceLine" VALIDATE CONSTRAINT "purchaseInvoiceLine_accountId_fkey";
ALTER TABLE "supplierQuoteLine" VALIDATE CONSTRAINT "supplierQuoteLine_accountId_fkey";
