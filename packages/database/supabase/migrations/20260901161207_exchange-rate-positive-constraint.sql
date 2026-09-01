-- An exchange rate of zero or below is never meaningful, and zero is actively
-- destructive: the sales `converted*` generated columns multiply by the rate
-- with no guard, so a single zero silently zeroes every priced line on the
-- document. The purchasing columns substitute 1 for a zero rate instead, which
-- is quieter but just as wrong -- it prices a foreign document at par.
--
-- `currency` has carried CHECK ("exchangeRate" > 0) since 20230330024715, and
-- `payment`/`memo` since 20260630093809. Every document table was missed.
--
-- NULL is left alone deliberately. It means "no rate set", which is a different
-- condition from a bad rate and one that real rows still carry; deciding what a
-- historical NULL should become is a data decision, not a schema one.
--
-- With zero unrepresentable, the purchasing generated columns' zero-guard
-- becomes unreachable rather than load-bearing. It is left in place: removing it
-- would mean dropping and rebuilding stored generated columns on the largest
-- transactional tables in the schema, for no behavioural gain.

ALTER TABLE "quote"
  ADD CONSTRAINT "quote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "quoteLinePrice"
  ADD CONSTRAINT "quoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "salesOrder"
  ADD CONSTRAINT "salesOrder_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "salesOrderLine"
  ADD CONSTRAINT "salesOrderLine_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "salesInvoice"
  ADD CONSTRAINT "salesInvoice_exchangeRate_check"
  CHECK ("exchangeRate" > 0);

ALTER TABLE "salesInvoiceLine"
  ADD CONSTRAINT "salesInvoiceLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0);

ALTER TABLE "purchaseOrder"
  ADD CONSTRAINT "purchaseOrder_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "purchaseOrderLine"
  ADD CONSTRAINT "purchaseOrderLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0);

ALTER TABLE "purchaseInvoice"
  ADD CONSTRAINT "purchaseInvoice_exchangeRate_check"
  CHECK ("exchangeRate" > 0);

ALTER TABLE "purchaseInvoiceLine"
  ADD CONSTRAINT "purchaseInvoiceLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0);

ALTER TABLE "supplierQuote"
  ADD CONSTRAINT "supplierQuote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "supplierQuoteLinePrice"
  ADD CONSTRAINT "supplierQuoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);
