

-- Update quote foreign key constraints for customer
ALTER TABLE "quote" DROP CONSTRAINT "quote_customerId_fkey";
ALTER TABLE "quote" ADD CONSTRAINT "quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL;

-- Update quotePayment foreign key constraints for customer
ALTER TABLE "quotePayment" DROP CONSTRAINT "quotePayment_invoiceCustomerId_fkey";
ALTER TABLE "quotePayment" ADD CONSTRAINT "quotePayment_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer"("id") ON DELETE SET NULL;

-- Update salesOrder foreign key constraints for customer
ALTER TABLE "salesOrder" DROP CONSTRAINT "salesOrder_customerId_fkey";
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL;

-- Update salesOrderPayment foreign key constraints for customer
ALTER TABLE "salesOrderPayment" DROP CONSTRAINT "salesOrderPayment_invoiceCustomerId_fkey";
ALTER TABLE "salesOrderPayment" ADD CONSTRAINT "salesOrderPayment_invoiceCustomerId_fkey" FOREIGN KEY ("invoiceCustomerId") REFERENCES "customer"("id") ON DELETE SET NULL;

-- Update purchaseOrder foreign key constraints for supplier
ALTER TABLE "purchaseOrder" DROP CONSTRAINT "purchaseOrder_supplierId_fkey";
ALTER TABLE "purchaseOrder" ADD CONSTRAINT "purchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL;

-- Update purchaseOrderPayment foreign key constraints for supplier
ALTER TABLE "purchaseOrderPayment" DROP CONSTRAINT "purchaseOrderPayment_invoiceSupplierId_fkey";
ALTER TABLE "purchaseOrderPayment" ADD CONSTRAINT "purchaseOrderPayment_invoiceSupplierId_fkey" FOREIGN KEY ("invoiceSupplierId") REFERENCES "supplier"("id") ON DELETE SET NULL;