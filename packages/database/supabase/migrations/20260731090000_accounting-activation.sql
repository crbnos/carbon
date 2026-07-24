-- Accounting Cutover & Activation (#1057)
-- Spec: .ai/specs/2026-07-04-accounting-cutover-activation.md
--
-- Adds the one-way per-company activation event machinery:
--   * a new 'Opening Balance' journal source type,
--   * activation stamp columns on `company`,
--   * config-lock triggers that freeze baseCurrencyCode + fiscal start month
--     once accounting is activated,
--   * a grandfather backfill for companies already live on the accountingEnabled
--     flag (Design Decision 12).
-- Additive + idempotent. The accountingEnabled flag is retired in a separate PR.

-- 1. New journal source type. Added in its own statement wave; the enum value is
--    not used until the activation service ships (established ADD VALUE pattern).
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Opening Balance';

-- 2. Activation stamp on company (legacy single-column PK table; additive only).
ALTER TABLE "company"
  ADD COLUMN IF NOT EXISTS "accountingActivatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "accountingActivatedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "accountingCutoverDate" DATE;

-- 3. Config locks: baseCurrencyCode + fiscal start month freeze once activated.
--    SECURITY DEFINER so service-role writers are equally bound; the activation
--    columns are themselves one-way and immutable once set.
CREATE OR REPLACE FUNCTION check_accounting_config_locked() RETURNS TRIGGER
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'company' THEN
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND NEW."baseCurrencyCode" IS DISTINCT FROM OLD."baseCurrencyCode" THEN
      RAISE EXCEPTION 'baseCurrencyCode is locked: accounting was activated %', OLD."accountingActivatedAt";
    END IF;
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND (NEW."accountingActivatedAt" IS DISTINCT FROM OLD."accountingActivatedAt"
         OR NEW."accountingActivatedBy" IS DISTINCT FROM OLD."accountingActivatedBy"
         OR NEW."accountingCutoverDate" IS DISTINCT FROM OLD."accountingCutoverDate") THEN
      RAISE EXCEPTION 'accounting activation is one-way and immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'fiscalYearSettings' THEN
    IF EXISTS (SELECT 1 FROM "company" c WHERE c."id" = NEW."companyId"
               AND c."accountingActivatedAt" IS NOT NULL)
       AND NEW."startMonth" IS DISTINCT FROM OLD."startMonth" THEN
      RAISE EXCEPTION 'fiscal year settings are locked: accounting is activated';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "company_accounting_config_locked" ON "company";
CREATE TRIGGER "company_accounting_config_locked"
  BEFORE UPDATE ON "company" FOR EACH ROW EXECUTE FUNCTION check_accounting_config_locked();

DROP TRIGGER IF EXISTS "fiscalYearSettings_accounting_config_locked" ON "fiscalYearSettings";
CREATE TRIGGER "fiscalYearSettings_accounting_config_locked"
  BEFORE UPDATE ON "fiscalYearSettings" FOR EACH ROW EXECUTE FUNCTION check_accounting_config_locked();

-- 4. Grandfather backfill (Design Decision 12): companies already running on the
--    accountingEnabled flag never had a cutover. Stamp them from their earliest
--    posted-journal period start so the locks apply from now forward, without
--    fabricating a synthetic opening journal on top of real history.
--    Idempotent: only rows with a NULL activation stamp are touched.
UPDATE "company" c SET
  "accountingActivatedAt" = NOW(),
  "accountingActivatedBy" = 'system',
  "accountingCutoverDate" = sub."cutover"
FROM (
  SELECT j."companyId", MIN(ap."startDate") AS "cutover"
  FROM "journal" j JOIN "accountingPeriod" ap ON ap."id" = j."accountingPeriodId"
  WHERE j."status" = 'Posted' GROUP BY j."companyId"
) sub
WHERE sub."companyId" = c."id" AND c."accountingActivatedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "companySettings" s
              WHERE s."id" = c."id" AND s."accountingEnabled" = true);
