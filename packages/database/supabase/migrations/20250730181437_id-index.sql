-- Create indexes on readable ID columns for better query performance
CREATE INDEX IF NOT EXISTS "idx_purchaseOrder_purchaseOrderId" ON "purchaseOrder" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "idx_salesOrder_salesOrderId" ON "salesOrder" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "idx_quote_quoteId" ON "quote" ("quoteId");
CREATE INDEX IF NOT EXISTS "idx_salesRfq_salesRfqId" ON "salesRfq" ("rfqId");
CREATE INDEX IF NOT EXISTS "idx_job_jobId" ON "job" ("jobId");
CREATE INDEX IF NOT EXISTS "idx_supplierQuote_supplierQuoteId" ON "supplierQuote" ("supplierQuoteId");
CREATE INDEX IF NOT EXISTS "idx_salesInvoice_invoiceId" ON "salesInvoice" ("invoiceId");
CREATE INDEX IF NOT EXISTS "idx_purchaseInvoice_invoiceId" ON "purchaseInvoice" ("invoiceId");
