-- Whether accepting the quote online emails the new sales order to the customer.
-- Chosen when the quote is finalized; on by default.
ALTER TABLE "quote"
  ADD COLUMN "emailOrderOnAcceptance" BOOLEAN NOT NULL DEFAULT true;
