-- Currency & exchange rate refactor, part 3 of 3: the missing salesInvoice
-- header->line rate propagation, rate-positivity CHECKs on every document
-- table, and translateTrialBalance re-pointed at the global "exchangeRate"
-- store (which resolves its multiply-direction contradiction: the rate is now
-- a true target-per-source pair ratio).
-- Spec: .ai/specs/2026-09-02-currency-exchange-rate-refactor.md

-- 1) salesInvoice header->line propagation. Forked from the purchaseInvoice
--    pair (20241210214820:325 + 20260616061244), which every sibling document
--    has and salesInvoice never got.
CREATE OR REPLACE FUNCTION update_sales_invoice_line_exchange_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "salesInvoiceLine"
  SET "exchangeRate" = NEW."exchangeRate",
      "updatedBy" = COALESCE(NEW."updatedBy", 'system'),
      "updatedAt" = NOW()
  WHERE "invoiceId" = NEW."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_sales_invoice_line_exchange_rate_trigger ON "salesInvoice";
CREATE TRIGGER update_sales_invoice_line_exchange_rate_trigger
AFTER UPDATE OF "exchangeRate" ON "salesInvoice"
FOR EACH ROW
WHEN (OLD."exchangeRate" IS DISTINCT FROM NEW."exchangeRate")
EXECUTE FUNCTION update_sales_invoice_line_exchange_rate();

CREATE OR REPLACE FUNCTION sync_sales_invoice_line_exchange_rate_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exchangeRate" IS NULL OR NEW."exchangeRate" = 1 THEN
    SELECT "exchangeRate" INTO NEW."exchangeRate"
    FROM "salesInvoice"
    WHERE "id" = NEW."invoiceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sales_invoice_line_exchange_rate_insert_trigger ON "salesInvoiceLine";
CREATE TRIGGER sales_invoice_line_exchange_rate_insert_trigger
BEFORE INSERT ON "salesInvoiceLine"
FOR EACH ROW
EXECUTE FUNCTION sync_sales_invoice_line_exchange_rate_on_insert();

-- One-time backfill, unposted invoices only (posted documents are immutable
-- history; their line rates stay whatever they posted at).
UPDATE "salesInvoiceLine" sil
SET "exchangeRate" = si."exchangeRate",
    "updatedBy" = COALESCE(si."updatedBy", 'system'),
    "updatedAt" = NOW()
FROM "salesInvoice" si
WHERE si."id" = sil."invoiceId"
  AND si."companyId" = sil."companyId"
  AND si."status" = 'Draft'
  AND sil."exchangeRate" IS DISTINCT FROM si."exchangeRate";

-- 2) A zero or negative exchange rate is never a valid document snapshot
--    (subsumes PR #1541). NOT VALID + VALIDATE so a huge table never takes an
--    exclusive-lock full rewrite; guarded so re-application (or PR #1541
--    landing too) is a no-op.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'quote', 'salesOrder', 'purchaseOrder', 'supplierQuote',
    'purchaseInvoice', 'salesInvoice',
    'quoteLinePrice', 'salesOrderLine', 'purchaseOrderLine',
    'supplierQuoteLinePrice', 'purchaseInvoiceLine', 'salesInvoiceLine'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_exchangeRate_positive'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK ("exchangeRate" > 0) NOT VALID',
        t, t || '_exchangeRate_positive'
      );
    END IF;
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      t, t || '_exchangeRate_positive'
    );
  END LOOP;
END $$;

-- 3) translateTrialBalance: closing/average now come from the global
--    "exchangeRate" store as target-per-source pair ratios
--    (r(target)/r(source), each side units-per-USD), so the existing
--    balance * rate multiply is correct by construction. Historical stays the
--    manual currency."historicalExchangeRate" (IAS 21 equity). No silent
--    COALESCE-to-1: an unresolvable pair raises. Forked from the newest
--    definition (20260811123614_widen-ledger-amounts.sql:247), signature and
--    attributes preserved.
CREATE OR REPLACE FUNCTION "translateTrialBalance" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_target_currency TEXT,
  p_period_end DATE,
  p_period_start DATE DEFAULT NULL
)
RETURNS TABLE (
  "accountId" TEXT,
  "localBalance" NUMERIC,
  "exchangeRate" NUMERIC,
  "translatedBalance" NUMERIC
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_source_currency TEXT;
  v_source_close NUMERIC;
  v_target_close NUMERIC;
  v_closing_rate NUMERIC;
  v_average_rate NUMERIC;
  v_historical_rate NUMERIC;
BEGIN
  -- Get the subsidiary's base currency
  SELECT "baseCurrencyCode" INTO v_source_currency
  FROM "company" WHERE "id" = p_company_id;

  -- If same currency, no translation needed
  IF v_source_currency = p_target_currency THEN
    RETURN QUERY
    SELECT
      b."accountId",
      b."balanceAtDate" AS "localBalance",
      1.0::NUMERIC AS "exchangeRate",
      b."balanceAtDate" AS "translatedBalance"
    FROM "accountTreeBalancesByCompany"(p_company_group_id, p_company_id, p_period_start, p_period_end) b
    INNER JOIN "account" a ON a."id" = b."accountId"
    WHERE a."isGroup" = false;
    RETURN;
  END IF;

  -- Closing rate: each side's latest global rate on or before period end; a
  -- period predating the store's earliest row falls back to that side's
  -- earliest rate (never to 1).
  SELECT "rate" INTO v_source_close FROM "exchangeRate"
  WHERE "currencyCode" = v_source_currency AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;
  IF v_source_close IS NULL THEN
    SELECT "rate" INTO v_source_close FROM "exchangeRate"
    WHERE "currencyCode" = v_source_currency
    ORDER BY "effectiveDate" ASC LIMIT 1;
  END IF;

  SELECT "rate" INTO v_target_close FROM "exchangeRate"
  WHERE "currencyCode" = p_target_currency AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;
  IF v_target_close IS NULL THEN
    SELECT "rate" INTO v_target_close FROM "exchangeRate"
    WHERE "currencyCode" = p_target_currency
    ORDER BY "effectiveDate" ASC LIMIT 1;
  END IF;

  IF v_source_close IS NULL OR v_target_close IS NULL THEN
    RAISE EXCEPTION 'No exchange rate available to translate % to %',
      v_source_currency, p_target_currency;
  END IF;

  v_closing_rate := v_target_close / v_source_close;

  -- Average rate: mean of the daily pair ratios over the period, where both
  -- currencies have a rate on the same date; falls back to the closing rate.
  SELECT AVG(t."rate" / s."rate") INTO v_average_rate
  FROM "exchangeRate" s
  JOIN "exchangeRate" t ON t."effectiveDate" = s."effectiveDate"
  WHERE s."currencyCode" = v_source_currency
    AND t."currencyCode" = p_target_currency
    AND s."effectiveDate" >= COALESCE(p_period_start, p_period_end - INTERVAL '1 year')
    AND s."effectiveDate" <= p_period_end;

  -- Historical rate: from currency table (manually set for equity)
  SELECT "historicalExchangeRate" INTO v_historical_rate
  FROM "currency"
  WHERE "code" = v_source_currency
    AND "companyGroupId" = p_company_group_id;

  v_average_rate := COALESCE(v_average_rate, v_closing_rate);
  v_historical_rate := COALESCE(v_historical_rate, v_closing_rate);

  RETURN QUERY
  SELECT
    b."accountId",
    b."balanceAtDate" AS "localBalance",
    CASE a."consolidatedRate"
      WHEN 'Current' THEN v_closing_rate
      WHEN 'Average' THEN v_average_rate
      WHEN 'Historical' THEN v_historical_rate
    END AS "exchangeRate",
    ROUND(b."balanceAtDate" * CASE a."consolidatedRate"
      WHEN 'Current' THEN v_closing_rate
      WHEN 'Average' THEN v_average_rate
      WHEN 'Historical' THEN v_historical_rate
    END, 4) AS "translatedBalance"
  FROM "accountTreeBalancesByCompany"(p_company_group_id, p_company_id, p_period_start, p_period_end) b
  INNER JOIN "account" a ON a."id" = b."accountId"
  WHERE a."isGroup" = false;
END;
$$;
