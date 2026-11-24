-- An invoice reference must stay in the request's company, including direct
-- API writes. purchaseInvoice still has a single-column primary key.
CREATE UNIQUE INDEX IF NOT EXISTS "purchaseInvoice_id_companyId_key"
  ON "purchaseInvoice" ("id", "companyId");

-- Replace the constraint atomically and preserve its name for PostgREST embeds.
ALTER TABLE "paymentRequest"
  DROP CONSTRAINT "paymentRequest_purchaseInvoiceId_fkey",
  ADD CONSTRAINT "paymentRequest_purchaseInvoiceId_fkey"
    FOREIGN KEY ("purchaseInvoiceId", "companyId")
    REFERENCES "purchaseInvoice" ("id", "companyId")
    ON DELETE CASCADE;
