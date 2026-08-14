-- Currency display: whether a currency amount keeps the non-significant zeros
-- its currency's decimals imply.
--
-- The DEFAULT is true — amounts pad to currency.decimalPlaces ("$300.00",
-- "$3.50", "¥63"). Fixed-width money is the accounting convention: it keeps
-- columns of amounts aligned in ledgers, invoices and reports, and an explicit
-- ".00" reads as a currency amount rather than a bare count. We are not
-- innovating on that by default.
--
-- Set false and display drops the padding instead ("$300", "$3.5"), which is
-- what some teams prefer for dense on-screen tables. QuickBooks exposes the
-- same choice as a preference rather than picking for the customer.
--
-- Named POSITIVELY, like its neighbours showSupplierReadableId and
-- showCustomerReadableId. The negative form it replaced ("hide...") had to be
-- inverted at three separate layers — the switch, the fetcher payload, and the
-- formatter hook — each one a place to get the polarity backwards.
--
-- DISPLAY ONLY, and in-app only: stored values are unaffected (rounding still
-- happens at the currency's decimals either way), and printed documents keep
-- padding regardless, since a customer-facing invoice is exactly where
-- fixed-width money matters most.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showCurrencyTrailingZeros" BOOLEAN NOT NULL DEFAULT true;
