ALTER TABLE "quote" DROP CONSTRAINT "quote_customerContactId_fkey";
ALTER TABLE "quote" ADD CONSTRAINT "quote_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact"("id") ON DELETE SET NULL;

ALTER TABLE "quote" DROP CONSTRAINT "quote_customerLocationId_fkey";
ALTER TABLE "quote" ADD CONSTRAINT "quote_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL;

ALTER TABLE "quotePayment" DROP CONSTRAINT "quotePayment_invoiceCustomerContactId_fkey";
ALTER TABLE "quotePayment" ADD CONSTRAINT "quotePayment_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "customerContact"("id") ON DELETE SET NULL;

ALTER TABLE "quotePayment" DROP CONSTRAINT "quotePayment_invoiceCustomerLocationId_fkey";
ALTER TABLE "quotePayment" ADD CONSTRAINT "quotePayment_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrder" DROP CONSTRAINT "salesOrder_customerLocationId_fkey";
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrderLine_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrder" DROP CONSTRAINT "salesOrder_customerContactId_fkey";
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrderPayment" DROP CONSTRAINT "salesOrderPayment_invoiceCustomerContactId_fkey";
ALTER TABLE "salesOrderPayment" ADD CONSTRAINT "salesOrderPayment_invoiceCustomerContactId_fkey" FOREIGN KEY ("invoiceCustomerContactId") REFERENCES "customerContact"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrderPayment" DROP CONSTRAINT "salesOrderPayment_invoiceCustomerLocationId_fkey";
ALTER TABLE "salesOrderPayment" ADD CONSTRAINT "salesOrderPayment_invoiceCustomerLocationId_fkey" FOREIGN KEY ("invoiceCustomerLocationId") REFERENCES "customerLocation"("id") ON DELETE SET NULL;

ALTER TABLE "purchaseOrder" DROP CONSTRAINT "purchaseOrder_supplierContactId_fkey";
ALTER TABLE "purchaseOrder" ADD CONSTRAINT "purchaseOrder_supplierContactId_fkey" FOREIGN KEY ("supplierContactId") REFERENCES "supplierContact"("id") ON DELETE SET NULL;

ALTER TABLE "purchaseOrder" DROP CONSTRAINT "purchaseOrder_supplierLocationId_fkey";
ALTER TABLE "purchaseOrder" ADD CONSTRAINT "purchaseOrder_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "supplierLocation"("id") ON DELETE SET NULL;


ALTER TABLE "purchaseOrderPayment" DROP CONSTRAINT "purchaseOrderPayment_invoiceSupplierContactId_fkey";
ALTER TABLE "purchaseOrderPayment" ADD CONSTRAINT "purchaseOrderPayment_invoiceSupplierContactId_fkey" FOREIGN KEY ("invoiceSupplierContactId") REFERENCES "supplierContact"("id") ON DELETE SET NULL;

ALTER TABLE "purchaseOrderPayment" DROP CONSTRAINT "purchaseOrderPayment_invoiceSupplierLocationId_fkey";
ALTER TABLE "purchaseOrderPayment" ADD CONSTRAINT "purchaseOrderPayment_invoiceSupplierLocationId_fkey" FOREIGN KEY ("invoiceSupplierLocationId") REFERENCES "supplierLocation"("id") ON DELETE SET NULL;
