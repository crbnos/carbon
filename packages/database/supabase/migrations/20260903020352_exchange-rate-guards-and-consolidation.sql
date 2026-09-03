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
    -- salesInvoice."exchangeRate" is NOT NULL, but COALESCE anyway so a
    -- missing header row can never write NULL through this trigger (the CHECK
    -- below does not reject NULL — NULL satisfies a CHECK constraint).
    SELECT COALESCE("exchangeRate", 1) INTO NEW."exchangeRate"
    FROM "salesInvoice"
    WHERE "id" = NEW."invoiceId";
    NEW."exchangeRate" := COALESCE(NEW."exchangeRate", 1);
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

-- 2) A zero, negative, or NaN exchange rate is never a valid document snapshot
--    ('NaN'::numeric > 0 is TRUE in Postgres, so NaN needs its own clause; the
--    CHECK deliberately does NOT reject NULL — the nullable header columns
--    accept rate-less inserts from writers that predate stamping, and NULL is
--    handled by the resolver/stamping layer, not the constraint).
--    (subsumes PR #1541). Before validating, repair the two legacy classes the
--    constraint would otherwise trip on mid-deploy: NULL header/line rates
--    (columns added 2024-10 with no backfill; their line snapshots already
--    defaulted to 1) and rates the old 4-decimal NUMERIC clamp rounded to 0.0000
--    (widened 2026-08). The repair value is 1 for foreign-currency rows too,
--    deliberately: pre-refactor code treated these NULL/zero rates as 1
--    everywhere they were read, the rows' own line snapshots defaulted to 1,
--    and no truer rate is recoverable (the clamped-to-zero class means the
--    real rate was below 0.00005 and was never stored). Re-deriving from
--    today's market rates would REWRITE historical documents, which snapshots
--    exist to prevent. NOT VALID + VALIDATE so a huge table never takes an
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
    EXECUTE format(
      'UPDATE %I SET "exchangeRate" = 1,
        "updatedBy" = COALESCE("updatedBy", ''system''),
        "updatedAt" = NOW()
       WHERE "exchangeRate" IS NULL OR "exchangeRate" <= 0',
      t
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_exchangeRate_positive'
        AND conrelid = format('%I', t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK ("exchangeRate" > 0 AND "exchangeRate" <> ''NaN''::numeric) NOT VALID',
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
--    "exchangeRate" store as target-per-source pair ratios, so the existing
--    balance * rate multiply is correct by construction. The rate resolution
--    itself lives in ONE place — "getConsolidationRates" (re-pointed at the
--    global store in the next migration, 20260903021021) — and this function
--    delegates to it; forking the 50-line ladder into both would re-instate
--    the duplication 20260713225803 explicitly extracted away. PL/pgSQL bodies
--    are late-bound, so referencing the 5-arg signature before that migration
--    defines it is safe: nothing executes this function mid-deploy.
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

  SELECT r."closingRate", r."averageRate", r."historicalRate"
  INTO v_closing_rate, v_average_rate, v_historical_rate
  FROM "getConsolidationRates"(
    p_company_group_id, p_company_id, p_target_currency, p_period_end, p_period_start
  ) r;

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
