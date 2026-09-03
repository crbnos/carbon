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
INSERT INTO "exchangeRateOverride" ("companyId", "currencyCode", "rate", "createdBy")
SELECT co."id", cu."code", cu."exchangeRate", 'system'
FROM "currency" cu
JOIN "company" co ON co."companyGroupId" = cu."companyGroupId"
WHERE cu."exchangeRate" <> 1
  AND cu."code" <> co."baseCurrencyCode"
  AND NOT EXISTS (
    SELECT 1 FROM "companyIntegration" ci
    WHERE ci."id" = 'exchange-rates-v1' AND ci."active" = true
      AND ci."companyId" IN (
        SELECT c2."id" FROM "company" c2 WHERE c2."companyGroupId" = cu."companyGroupId"
      )
  )
ON CONFLICT ("companyId", "currencyCode") DO NOTHING;

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

-- 4) exchangeRateHistory never had a writer and holds zero rows everywhere;
--    the global "exchangeRate" table replaces it. translateTrialBalance is
--    re-pointed in part 3 of this migration set.
DROP TABLE IF EXISTS "exchangeRateHistory";

-- 5) Exchange rates no longer require an integration — the daily feed runs for
--    everyone. Remove the integration's per-company rows; the definition is
--    deleted from @carbon/ee in the same change set.
DELETE FROM "companyIntegration" WHERE "id" = 'exchange-rates-v1';
