-- Currency & exchange rate refactor, part 1 of 3: the global market-rate store,
-- per-company overrides, and the resolver functions.
-- Spec: .ai/specs/2026-09-02-currency-exchange-rate-refactor.md

-- Global market-rate store. Deliberately NOT tenant-scoped: market data, same class
-- as "currencyCode". rate = units of "currencyCode" per 1 USD.
CREATE TABLE IF NOT EXISTS "exchangeRate" (
    "id" TEXT NOT NULL DEFAULT id('xrate'),
    "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
    "effectiveDate" DATE NOT NULL,
    -- 'NaN'::numeric > 0 is TRUE in Postgres, so the positivity check alone
    -- would admit NaN written through PostgREST; NaN = NaN is also TRUE here,
    -- which is what makes the inequality reliable.
    "rate" NUMERIC NOT NULL CHECK ("rate" > 0 AND "rate" <> 'NaN'::numeric),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "exchangeRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchangeRate_code_date_key" UNIQUE ("currencyCode", "effectiveDate")
);

CREATE INDEX IF NOT EXISTS "exchangeRate_code_date_idx" ON "exchangeRate" ("currencyCode", "effectiveDate" DESC);

ALTER TABLE "exchangeRate" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."exchangeRate";
CREATE POLICY "SELECT" ON "public"."exchangeRate"
FOR SELECT TO authenticated USING (true);
-- writes: service role only (no INSERT/UPDATE/DELETE policies)

-- Per-company user overrides. rate = units of "currencyCode" per 1 unit of the
-- company's OWN base currency. Standing pin: always beats the market rate;
-- deleting the row restores the market rate.
CREATE TABLE IF NOT EXISTS "exchangeRateOverride" (
    "id" TEXT NOT NULL DEFAULT id('xrovr'),
    "companyId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code") ON DELETE CASCADE ON UPDATE CASCADE,
    "rate" NUMERIC NOT NULL CHECK ("rate" > 0 AND "rate" <> 'NaN'::numeric),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "exchangeRateOverride_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "exchangeRateOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exchangeRateOverride_company_code_key" UNIQUE ("companyId", "currencyCode")
);

CREATE INDEX IF NOT EXISTS "exchangeRateOverride_companyId_idx" ON "exchangeRateOverride" ("companyId");
CREATE INDEX IF NOT EXISTS "exchangeRateOverride_currencyCode_idx" ON "exchangeRateOverride" ("currencyCode");
CREATE INDEX IF NOT EXISTS "exchangeRateOverride_createdBy_idx" ON "exchangeRateOverride" ("createdBy");
CREATE INDEX IF NOT EXISTS "exchangeRateOverride_updatedBy_idx" ON "exchangeRateOverride" ("updatedBy");

ALTER TABLE "exchangeRateOverride" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."exchangeRateOverride";
CREATE POLICY "SELECT" ON "public"."exchangeRateOverride"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."exchangeRateOverride";
CREATE POLICY "INSERT" ON "public"."exchangeRateOverride"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."exchangeRateOverride";
CREATE POLICY "UPDATE" ON "public"."exchangeRateOverride"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."exchangeRateOverride";
CREATE POLICY "DELETE" ON "public"."exchangeRateOverride"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

-- Bootstrap snapshot (approximate, 2026-09). Superseded by the daily feed job.
-- Rates are units of currency per 1 USD. Obsolete codes (VEF, ZMK) carry their
-- successor's rate times the redenomination factor.
INSERT INTO "exchangeRate" ("currencyCode", "effectiveDate", "rate")
VALUES
  ('USD', '2026-09-01', 1),
  ('EUR', '2026-09-01', 0.92),
  ('GBP', '2026-09-01', 0.79),
  ('JPY', '2026-09-01', 155),
  ('CHF', '2026-09-01', 0.88),
  ('CAD', '2026-09-01', 1.36),
  ('AUD', '2026-09-01', 1.52),
  ('NZD', '2026-09-01', 1.64),
  ('CNY', '2026-09-01', 7.2),
  ('HKD', '2026-09-01', 7.8),
  ('TWD', '2026-09-01', 32),
  ('KRW', '2026-09-01', 1350),
  ('SGD', '2026-09-01', 1.34),
  ('INR', '2026-09-01', 84),
  ('IDR', '2026-09-01', 15800),
  ('MYR', '2026-09-01', 4.6),
  ('PHP', '2026-09-01', 57),
  ('THB', '2026-09-01', 35),
  ('VND', '2026-09-01', 25000),
  ('BRL', '2026-09-01', 5.5),
  ('MXN', '2026-09-01', 18.5),
  ('ARS', '2026-09-01', 1000),
  ('CLP', '2026-09-01', 950),
  ('COP', '2026-09-01', 4100),
  ('PEN', '2026-09-01', 3.8),
  ('UYU', '2026-09-01', 40),
  ('BOB', '2026-09-01', 6.9),
  ('PYG', '2026-09-01', 7500),
  ('VEF', '2026-09-01', 4000000),
  ('ZAR', '2026-09-01', 18),
  ('EGP', '2026-09-01', 48),
  ('NGN', '2026-09-01', 1550),
  ('KES', '2026-09-01', 130),
  ('GHS', '2026-09-01', 15),
  ('MAD', '2026-09-01', 10),
  ('TND', '2026-09-01', 3.1),
  ('DZD', '2026-09-01', 135),
  ('LYD', '2026-09-01', 4.9),
  ('ETB', '2026-09-01', 120),
  ('TZS', '2026-09-01', 2600),
  ('UGX', '2026-09-01', 3700),
  ('XOF', '2026-09-01', 600),
  ('XAF', '2026-09-01', 600),
  ('MUR', '2026-09-01', 46),
  ('BWP', '2026-09-01', 13.5),
  ('ZMK', '2026-09-01', 26000),
  ('MZN', '2026-09-01', 64),
  ('SEK', '2026-09-01', 10.5),
  ('NOK', '2026-09-01', 10.7),
  ('DKK', '2026-09-01', 6.9),
  ('ISK', '2026-09-01', 138),
  ('PLN', '2026-09-01', 4.0),
  ('CZK', '2026-09-01', 23),
  ('HUF', '2026-09-01', 360),
  ('RON', '2026-09-01', 4.6),
  ('BGN', '2026-09-01', 1.8),
  ('RSD', '2026-09-01', 108),
  ('ALL', '2026-09-01', 93),
  ('MKD', '2026-09-01', 57),
  ('BAM', '2026-09-01', 1.8),
  ('MDL', '2026-09-01', 18),
  ('UAH', '2026-09-01', 41),
  ('BYN', '2026-09-01', 3.3),
  ('RUB', '2026-09-01', 95),
  ('TRY', '2026-09-01', 34),
  ('GEL', '2026-09-01', 2.7),
  ('AMD', '2026-09-01', 390),
  ('AZN', '2026-09-01', 1.7),
  ('KZT', '2026-09-01', 480),
  ('UZS', '2026-09-01', 12700),
  ('AED', '2026-09-01', 3.67),
  ('SAR', '2026-09-01', 3.75),
  ('QAR', '2026-09-01', 3.64),
  ('KWD', '2026-09-01', 0.31),
  ('BHD', '2026-09-01', 0.376),
  ('OMR', '2026-09-01', 0.385),
  ('JOD', '2026-09-01', 0.709),
  ('ILS', '2026-09-01', 3.7),
  ('LBP', '2026-09-01', 89500),
  ('IQD', '2026-09-01', 1310),
  ('IRR', '2026-09-01', 42000),
  ('AFN', '2026-09-01', 70),
  ('PKR', '2026-09-01', 278),
  ('BDT', '2026-09-01', 120),
  ('LKR', '2026-09-01', 300),
  ('NPR', '2026-09-01', 134),
  ('MMK', '2026-09-01', 2100),
  ('KHR', '2026-09-01', 4100),
  ('BND', '2026-09-01', 1.34),
  ('TOP', '2026-09-01', 2.35),
  ('JMD', '2026-09-01', 156),
  ('TTD', '2026-09-01', 6.8),
  ('BZD', '2026-09-01', 2),
  ('DOP', '2026-09-01', 60),
  ('GTQ', '2026-09-01', 7.75),
  ('HNL', '2026-09-01', 24.7),
  ('NIO', '2026-09-01', 36.8),
  ('CRC', '2026-09-01', 520),
  ('PAB', '2026-09-01', 1),
  ('CVE', '2026-09-01', 101),
  ('GNF', '2026-09-01', 8600),
  ('NAD', '2026-09-01', 18),
  ('RWF', '2026-09-01', 1350),
  ('BIF', '2026-09-01', 2900),
  ('DJF', '2026-09-01', 178),
  ('ERN', '2026-09-01', 15),
  ('SOS', '2026-09-01', 570),
  ('SDG', '2026-09-01', 600),
  ('CDF', '2026-09-01', 2800),
  ('KMF', '2026-09-01', 452),
  ('MGA', '2026-09-01', 4500),
  ('YER', '2026-09-01', 250),
  ('SYP', '2026-09-01', 13000),
  ('HRK', '2026-09-01', 6.9),
  ('MOP', '2026-09-01', 8.03),
  ('LTL', '2026-09-01', 3.18),
  ('LVL', '2026-09-01', 0.65),
  ('ZWL', '2026-09-01', 6100)
ON CONFLICT ("currencyCode", "effectiveDate") DO NOTHING;

-- SECURITY INVOKER on purpose: the override read runs under the caller's RLS,
-- so tenant authorization stays with the policies rather than an in-function
-- check a DEFINER would need. Contract: callers are the company's own
-- employees or the service role; a caller who can see the company row but not
-- its overrides (no employee role there) gets the market ratio — sanctioned
-- callers never hit that split, and no cross-tenant data is derivable (a
-- company outside the caller's group resolves to 'Company % not found').
-- Resolver: "units of p_currency_code per 1 unit of THIS company's base currency".
-- base -> 1 by definition; override wins; else the ratio of the two USD-anchored
-- market rates; a missing rate is an ERROR, never 1. Deliberate asymmetry with
-- the consolidation functions: STAMPING a document refuses when no rate exists
-- on/before the date (a wrong snapshot is permanent), while consolidation
-- REPORTING ("getConsolidationRates") falls back to the store's earliest row
-- for periods predating it (a report can be re-run; refusing history helps no one).
CREATE OR REPLACE FUNCTION get_exchange_rate(
  p_company_id TEXT,
  p_currency_code TEXT,
  p_as_of DATE DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base TEXT;
  v_override NUMERIC;
  v_code_rate NUMERIC;
  v_base_rate NUMERIC;
  v_as_of DATE := COALESCE(p_as_of, CURRENT_DATE);
BEGIN
  SELECT "baseCurrencyCode" INTO v_base FROM "company" WHERE "id" = p_company_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Company % not found', p_company_id;
  END IF;
  IF p_currency_code = v_base THEN
    RETURN 1;
  END IF;

  SELECT "rate" INTO v_override FROM "exchangeRateOverride"
   WHERE "companyId" = p_company_id AND "currencyCode" = p_currency_code;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT "rate" INTO v_code_rate FROM "exchangeRate"
   WHERE "currencyCode" = p_currency_code AND "effectiveDate" <= v_as_of
   ORDER BY "effectiveDate" DESC LIMIT 1;
  SELECT "rate" INTO v_base_rate FROM "exchangeRate"
   WHERE "currencyCode" = v_base AND "effectiveDate" <= v_as_of
   ORDER BY "effectiveDate" DESC LIMIT 1;

  IF v_code_rate IS NULL OR v_base_rate IS NULL THEN
    RAISE EXCEPTION 'No exchange rate available for % (base %). Set a rate manually in Accounting -> Exchange Rates.',
      p_currency_code, v_base;
  END IF;

  RETURN v_code_rate / v_base_rate;
END;
$$;

-- List resolver for the admin page: every active currency config row of the
-- company's group, resolved for THIS company, with provenance. Reports a code
-- with no resolution as source 'missing' rather than raising.
CREATE OR REPLACE FUNCTION get_exchange_rates(
  p_company_id TEXT
) RETURNS TABLE (
  "currencyCode" TEXT,
  "decimalPlaces" INTEGER,
  "active" BOOLEAN,
  "rate" NUMERIC,
  "source" TEXT,
  "rateUpdatedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base TEXT;
  v_group TEXT;
  v_base_rate NUMERIC;
BEGIN
  SELECT c."baseCurrencyCode", c."companyGroupId" INTO v_base, v_group
  FROM "company" c WHERE c."id" = p_company_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Company % not found', p_company_id;
  END IF;

  SELECT xr."rate" INTO v_base_rate FROM "exchangeRate" xr
   WHERE xr."currencyCode" = v_base AND xr."effectiveDate" <= CURRENT_DATE
   ORDER BY xr."effectiveDate" DESC LIMIT 1;

  RETURN QUERY
  SELECT
    cu."code",
    cu."decimalPlaces",
    cu."active",
    CASE
      WHEN cu."code" = v_base THEN 1::NUMERIC
      WHEN ovr."rate" IS NOT NULL THEN ovr."rate"
      WHEN mkt."rate" IS NOT NULL AND v_base_rate IS NOT NULL THEN mkt."rate" / v_base_rate
      ELSE NULL::NUMERIC
    END AS "rate",
    CASE
      WHEN cu."code" = v_base THEN 'base'
      WHEN ovr."rate" IS NOT NULL THEN 'override'
      WHEN mkt."rate" IS NOT NULL AND v_base_rate IS NOT NULL THEN 'market'
      ELSE 'missing'
    END AS "source",
    CASE
      WHEN cu."code" = v_base THEN NULL::TIMESTAMPTZ
      WHEN ovr."rate" IS NOT NULL THEN COALESCE(ovr."updatedAt", ovr."createdAt")
      ELSE COALESCE(mkt."updatedAt", mkt."createdAt")
    END AS "rateUpdatedAt"
  FROM "currency" cu
  LEFT JOIN "exchangeRateOverride" ovr
    ON ovr."companyId" = p_company_id AND ovr."currencyCode" = cu."code"
  LEFT JOIN LATERAL (
    SELECT xr."rate", xr."createdAt", xr."updatedAt"
    FROM "exchangeRate" xr
    WHERE xr."currencyCode" = cu."code" AND xr."effectiveDate" <= CURRENT_DATE
    ORDER BY xr."effectiveDate" DESC LIMIT 1
  ) mkt ON true
  WHERE cu."companyGroupId" = v_group
  ORDER BY cu."code";
END;
$$;

GRANT EXECUTE ON FUNCTION get_exchange_rate(TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_exchange_rates(TEXT) TO authenticated;
