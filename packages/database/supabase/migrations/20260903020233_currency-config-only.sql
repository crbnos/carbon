-- Currency & exchange rate refactor, part 2 of 3: migrate hand-set rates to
-- per-company overrides, drop the group-scoped rate column (currency becomes
-- config-only), drop the never-written exchangeRateHistory table, and delete
-- the exchange-rates integration rows.
-- Spec: .ai/specs/2026-09-02-currency-exchange-rate-refactor.md

-- 1) Preserve user intent: groups WITHOUT an active exchange-rates integration
--    have rates that were hand-edited (the feed never wrote them). Copy each
--    non-default (<> 1), non-base rate to a per-company override so every
--    member company resolves the same value it resolves today. Feed-derived
--    rates (integration-active groups) must NOT become standing pins.
-- Guarded on the column still existing: a retry of this file over committed
-- partial state (the deploy runner's failure mode) lands after the DROP below,
-- and this SELECT must not be the statement that wedges the deploy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'currency' AND column_name = 'exchangeRate'
  ) THEN
    INSERT INTO "exchangeRateOverride" ("companyId", "currencyCode", "rate", "createdBy")
    SELECT co."id", cu."code", cu."exchangeRate", 'system'
    FROM "currency" cu
    JOIN "company" co ON co."companyGroupId" = cu."companyGroupId"
    WHERE cu."exchangeRate" <> 1
      AND cu."code" <> co."baseCurrencyCode"
      -- Any exchange-rates-v1 row EVER (active or not): the group's rates are
      -- feed-derived, and pinning a stale market value as a manual override
      -- would silently freeze it against future market updates. Only groups
      -- the feed never touched carry hand-edited intent worth preserving.
      AND NOT EXISTS (
        SELECT 1 FROM "companyIntegration" ci
        WHERE ci."id" = 'exchange-rates-v1'
          AND ci."companyId" IN (
            SELECT c2."id" FROM "company" c2 WHERE c2."companyGroupId" = cu."companyGroupId"
          )
      )
    ON CONFLICT ("companyId", "currencyCode") DO NOTHING;
  END IF;
END $$;

-- 2) The "currencies" view selects c.*, so it must be dropped before the column
--    can go. Recreated below from the newest definition (20260228023426) minus
--    the rate.
DROP VIEW IF EXISTS "currencies";

-- 3) currency becomes pure per-group configuration (decimalPlaces, active,
--    historicalExchangeRate for IAS-21 consolidation, tags, customFields).
ALTER TABLE "currency" DROP COLUMN IF EXISTS "exchangeRate";

CREATE OR REPLACE VIEW "currencies" WITH(SECURITY_INVOKER=true) AS
  SELECT c.*, cc."name"
  FROM "currency" c
  INNER JOIN "currencyCode" cc
    ON cc."code" = c."code";

-- 4) exchangeRateHistory never had an application writer; the global
--    "exchangeRate" table replaces it. The table was API-reachable though, so
--    refuse (rather than discard) if any deployment turns out to hold rows —
--    an operator must preserve them before this migration can proceed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'exchangeRateHistory'
  ) THEN
    IF EXISTS (SELECT 1 FROM "exchangeRateHistory" LIMIT 1) THEN
      RAISE EXCEPTION
        'exchangeRateHistory contains rows; export/preserve them before applying this migration';
    END IF;
    DROP TABLE "exchangeRateHistory";
  END IF;
END $$;

-- 5) Exchange rates no longer require an integration — the daily feed runs for
--    everyone. Remove the integration's per-company rows; the definition is
--    deleted from @carbon/ee in the same change set.
DELETE FROM "companyIntegration" WHERE "id" = 'exchange-rates-v1';
