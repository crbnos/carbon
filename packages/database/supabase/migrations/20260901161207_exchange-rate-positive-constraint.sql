-- An exchange rate of zero or below is never meaningful, and zero is actively
-- destructive: the sales `converted*` generated columns multiply by the rate
-- with no guard, so one zero silently zeroes every priced line on the document.
-- The purchasing columns substitute 1 for a zero rate instead, which is quieter
-- but just as wrong -- it prices a foreign document at par.
--
-- `currency` has carried CHECK ("exchangeRate" > 0) since 20230330024715, and
-- `payment`/`memo` since 20260630093809. Every document table was missed.
--
-- NaN is excluded explicitly. PostgreSQL orders NaN ABOVE all finite values, so
-- `'NaN'::numeric > 0` is TRUE and a bare `> 0` check would accept it -- after
-- which every converted* column on the document becomes NaN.
--
-- NULL is left alone deliberately. It means "no rate set", which is a different
-- condition from a bad rate and one that real rows still carry; deciding what a
-- historical NULL should become is a data decision, not a schema one.
--
-- Added NOT VALID then validated separately: a plain ADD CONSTRAINT ... CHECK
-- holds ACCESS EXCLUSIVE while it scans, which across twelve transactional
-- tables can block writes or time the migration out. NOT VALID takes only a
-- brief lock, and VALIDATE CONSTRAINT runs under SHARE UPDATE EXCLUSIVE, which
-- does not block reads or writes.
--
-- With zero unrepresentable, the purchasing generated columns' zero-guard
-- becomes unreachable rather than load-bearing. It is left in place: removing it
-- would mean dropping and rebuilding stored generated columns on the largest
-- transactional tables in the schema, for no behavioural gain.

ALTER TABLE "quote"
  ADD CONSTRAINT "quote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "quoteLinePrice"
  ADD CONSTRAINT "quoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "salesOrder"
  ADD CONSTRAINT "salesOrder_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "salesOrderLine"
  ADD CONSTRAINT "salesOrderLine_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "purchaseOrder"
  ADD CONSTRAINT "purchaseOrder_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "supplierQuote"
  ADD CONSTRAINT "supplierQuote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "supplierQuoteLinePrice"
  ADD CONSTRAINT "supplierQuoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "salesInvoice"
  ADD CONSTRAINT "salesInvoice_exchangeRate_check"
  CHECK ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN')
  NOT VALID;

ALTER TABLE "salesInvoiceLine"
  ADD CONSTRAINT "salesInvoiceLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN')
  NOT VALID;

ALTER TABLE "purchaseOrderLine"
  ADD CONSTRAINT "purchaseOrderLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN')
  NOT VALID;

ALTER TABLE "purchaseInvoice"
  ADD CONSTRAINT "purchaseInvoice_exchangeRate_check"
  CHECK ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN')
  NOT VALID;

ALTER TABLE "purchaseInvoiceLine"
  ADD CONSTRAINT "purchaseInvoiceLine_exchangeRate_check"
  CHECK ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN')
  NOT VALID;

-- Validate separately: no write-blocking lock.
ALTER TABLE "quote" VALIDATE CONSTRAINT "quote_exchangeRate_check";
ALTER TABLE "quoteLinePrice" VALIDATE CONSTRAINT "quoteLinePrice_exchangeRate_check";
ALTER TABLE "salesOrder" VALIDATE CONSTRAINT "salesOrder_exchangeRate_check";
ALTER TABLE "salesOrderLine" VALIDATE CONSTRAINT "salesOrderLine_exchangeRate_check";
ALTER TABLE "purchaseOrder" VALIDATE CONSTRAINT "purchaseOrder_exchangeRate_check";
ALTER TABLE "supplierQuote" VALIDATE CONSTRAINT "supplierQuote_exchangeRate_check";
ALTER TABLE "supplierQuoteLinePrice" VALIDATE CONSTRAINT "supplierQuoteLinePrice_exchangeRate_check";
ALTER TABLE "salesInvoice" VALIDATE CONSTRAINT "salesInvoice_exchangeRate_check";
ALTER TABLE "salesInvoiceLine" VALIDATE CONSTRAINT "salesInvoiceLine_exchangeRate_check";
ALTER TABLE "purchaseOrderLine" VALIDATE CONSTRAINT "purchaseOrderLine_exchangeRate_check";
ALTER TABLE "purchaseInvoice" VALIDATE CONSTRAINT "purchaseInvoice_exchangeRate_check";
ALTER TABLE "purchaseInvoiceLine" VALIDATE CONSTRAINT "purchaseInvoiceLine_exchangeRate_check";
