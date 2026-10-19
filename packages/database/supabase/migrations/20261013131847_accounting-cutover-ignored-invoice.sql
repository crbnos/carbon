-- Invoices the accounting enable wizard leaves out of the opening journal.
--
-- Before the cutover another system kept the books, so an invoice can be open
-- in Carbon and already settled there. The user ignores it on Migration
-- Clearing: it drops out of Carbon's open items, and the enable marks it Paid
-- as of the day before the cutover, as the Xero and QuickBooks pulls do.
-- Only wizard state: the enable reads it once, and a row whose invoice is no
-- longer open at the cutover does nothing. No foreign key on "invoiceId": it
-- is a sales or a purchase invoice, and a stale row is harmless.

CREATE TABLE IF NOT EXISTS "accountingCutoverIgnoredInvoice" (
    "id" TEXT NOT NULL DEFAULT id('acii'),
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "accountingCutoverIgnoredInvoice_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "accountingCutoverIgnoredInvoice_companyId_invoiceId_key"
        UNIQUE ("companyId", "invoiceId"),
    CONSTRAINT "accountingCutoverIgnoredInvoice_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "accountingCutoverIgnoredInvoice_companyId_idx"
    ON "accountingCutoverIgnoredInvoice" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingCutoverIgnoredInvoice_createdBy_idx"
    ON "accountingCutoverIgnoredInvoice" ("createdBy");
CREATE INDEX IF NOT EXISTS "accountingCutoverIgnoredInvoice_updatedBy_idx"
    ON "accountingCutoverIgnoredInvoice" ("updatedBy");

ALTER TABLE "accountingCutoverIgnoredInvoice" ENABLE ROW LEVEL SECURITY;
