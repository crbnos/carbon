-- Ledger tables clamp value scale below the app's internal precision (scale 5),
-- so Postgres re-rounds every posted line AFTER the app's balance check passes —
-- a stored journal can drift out of balance by up to half a unit of the column
-- scale per line. Widen the ledger value columns to bare NUMERIC so the posting
-- functions' explicit rounding is the only rounding.
--
-- This migration must be applied BEFORE the app starts posting 5-decimal
-- amounts (the posting-function change rides in the same release).

-- journalLine.amount is referenced by the "journalEntries" and "journalLines"
-- views; Postgres refuses to retype a column a view depends on, so drop and
-- recreate them (bodies forked verbatim from their newest definitions:
-- journalEntries 20260402000000, journalLines 20260711011724).
DROP VIEW IF EXISTS "journalLines";
DROP VIEW IF EXISTS "journalEntries";

ALTER TABLE "journalLine"
  ALTER COLUMN "amount" TYPE NUMERIC,
  ALTER COLUMN "quantity" TYPE NUMERIC;

ALTER TABLE "costLedger"
  ALTER COLUMN "cost" TYPE NUMERIC,
  ALTER COLUMN "nominalCost" TYPE NUMERIC,
  ALTER COLUMN "quantity" TYPE NUMERIC,
  ALTER COLUMN "remainingQuantity" TYPE NUMERIC;

ALTER TABLE "supplierLedger"
  ALTER COLUMN "amount" TYPE NUMERIC;

ALTER TABLE "intercompanyTransaction"
  ALTER COLUMN "amount" TYPE NUMERIC;

-- itemLedger.quantity is referenced by the "itemLedgers" view and the
-- "itemStockQuantities" / "itemLedgerSnapshot" materialized views. The
-- pg_cron refresh job for the snapshot references it by name at runtime and
-- survives the drop/recreate; publication membership (supabase_realtime)
-- survives a column retype.
DROP VIEW IF EXISTS "itemLedgers";
-- itemStockQuantities is a matview here in a from-scratch apply, but migration
-- 20260812002454 (later timestamp, but already applied on any environment that
-- deployed main first — so this migration lands OUT OF ORDER there) converts it
-- to a trigger-maintained TABLE. A table does not depend on itemLedger.quantity's
-- type, so it neither blocks the ALTER below nor may be clobbered back into a
-- matview. Only drop it when it is actually still a matview.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'itemStockQuantities'
  ) THEN
    DROP MATERIALIZED VIEW "itemStockQuantities";
  END IF;
END $$;
DROP MATERIALIZED VIEW IF EXISTS "itemLedgerSnapshot";

ALTER TABLE "itemLedger"
  ALTER COLUMN "quantity" TYPE NUMERIC;

-- Recreate (verbatim from 20260713130718)
CREATE OR REPLACE VIEW "itemLedgers" WITH (security_invoker = true) AS
SELECT
  il.*,
  (il."correctionOfItemLedgerId" IS NOT NULL) AS "isCorrection",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name"                   AS "itemDescription",
  i."type"                   AS "itemType",
  l."name"                   AS "locationName",
  su."name"                  AS "storageUnitName",
  te."readableId"            AS "trackedEntityReadableId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL
      THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END                        AS "thumbnailPath"
FROM "itemLedger" il
INNER JOIN "item" i ON i."id" = il."itemId" AND i."companyId" = il."companyId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN "location" l ON l."id" = il."locationId" AND l."companyId" = il."companyId"
LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId" AND su."companyId" = il."companyId"
LEFT JOIN "trackedEntity" te ON te."id" = il."trackedEntityId" AND te."companyId" = il."companyId";

-- Recreate itemStockQuantities as a matview ONLY when it is not already present
-- as a relation. In a from-scratch apply the guarded DROP above removed the
-- matview, so it is recreated here and 20260812002454 later converts it to a
-- table. Where 20260812002454 already ran (out-of-order deploy), the table
-- exists and is left exactly as-is — its statement-level triggers and realtime
-- membership intact. Verbatim from 20260420112047.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'itemStockQuantities'
  ) THEN
    EXECUTE $mv$
      CREATE MATERIALIZED VIEW "itemStockQuantities" AS
      SELECT
        "itemId",
        "companyId",
        COALESCE("locationId", '') AS "locationId",
        SUM("quantity") FILTER (
          WHERE "trackedEntityStatus" IS NULL
             OR "trackedEntityStatus" != 'Rejected'
        ) AS "quantityOnHand"
      FROM "itemLedger"
      GROUP BY "itemId", "companyId", COALESCE("locationId", '')
    $mv$;
    EXECUTE $ix$
      CREATE UNIQUE INDEX "itemStockQuantities_itemId_companyId_locationId_idx"
        ON "itemStockQuantities" ("itemId", "companyId", "locationId")
    $ix$;
  END IF;
END $$;

-- Recreate (verbatim from 20260713235406)
CREATE MATERIALIZED VIEW "itemLedgerSnapshot" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") AS "quantity",
  SUM(CASE
    WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
    AND "createdAt" >= CURRENT_DATE - INTERVAL '30 days'
    THEN -"quantity"
    ELSE 0
  END) AS "consumed30",
  SUM(CASE
    WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
    AND "createdAt" >= CURRENT_DATE - INTERVAL '90 days'
    THEN -"quantity"
    ELSE 0
  END) AS "consumed90",
  ARRAY_AGG(DISTINCT "storageUnitId") FILTER (WHERE "storageUnitId" IS NOT NULL) AS "storageUnitIds",
  now() - INTERVAL '1 hour' AS "snapshotCutoff"
FROM "itemLedger"
WHERE "trackedEntityId" IS NULL
  AND "createdAt" < now() - INTERVAL '1 hour'
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

CREATE UNIQUE INDEX "itemLedgerSnapshot_itemId_companyId_locationId_idx"
  ON "itemLedgerSnapshot" ("itemId", "companyId", "locationId");

CREATE INDEX "itemLedgerSnapshot_companyId_locationId_idx"
  ON "itemLedgerSnapshot" ("companyId", "locationId");

-- Matviews don't support RLS; this one is only read inside SECURITY DEFINER
-- functions, so keep it out of PostgREST entirely.
REVOKE ALL ON "itemLedgerSnapshot" FROM anon, authenticated;

-- Recreate (verbatim from 20260402000000)
CREATE OR REPLACE VIEW "journalEntries"
WITH (security_invoker = true)
AS
  SELECT
    j.*,
    COALESCE(SUM(
      CASE
        WHEN a."class" IN ('Asset', 'Expense') AND jl."amount" > 0 THEN jl."amount"
        WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" < 0 THEN ABS(jl."amount")
        ELSE 0
      END
    ), 0) AS "totalDebits",
    COALESCE(SUM(
      CASE
        WHEN a."class" IN ('Asset', 'Expense') AND jl."amount" < 0 THEN ABS(jl."amount")
        WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" > 0 THEN jl."amount"
        ELSE 0
      END
    ), 0) AS "totalCredits",
    COUNT(jl."id")::integer AS "lineCount"
  FROM "journal" j
  LEFT JOIN "journalLine" jl ON jl."journalId" = j."id"
  LEFT JOIN "account" a ON a."id" = jl."accountId"
  GROUP BY j."id";

-- Recreate (verbatim from 20260711011724)
CREATE VIEW "journalLines" WITH(SECURITY_INVOKER=true) AS
SELECT
  jl.*,
  j."postingDate",
  j."journalEntryId",
  j."status",
  j."sourceType",
  j."description" AS "journalDescription"
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId"
WHERE j."status" != 'Draft';

-- The balance RPCs declare clamped RETURN types, which cast full-precision
-- sums back down on read. Redeclare with bare NUMERIC returns; bodies are
-- forked verbatim from each function's newest definition.

-- Forked from 20260315000001_per-company-balance-rpc.sql
DROP FUNCTION IF EXISTS "trialBalance"(TEXT, TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION "trialBalance" (
  p_company_group_id TEXT,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "accountClass" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "debitBalance" NUMERIC,
  "creditBalance" NUMERIC,
  "netChange" NUMERIC
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a."id" AS "accountId",
    a."number" AS "accountNumber",
    a."name" AS "accountName",
    a."class" AS "accountClass",
    a."incomeBalance",
    CASE
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" > 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC
    END AS "debitBalance",
    CASE
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" >= 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC
    END AS "creditBalance",
    b."netChange"
  FROM "account" a
  INNER JOIN "accountTreeBalancesByCompany"(p_company_group_id, p_company_id, from_date, to_date) b
    ON b."accountId" = a."id"
  WHERE a."isGroup" = false
    AND a."companyGroupId" = p_company_group_id
    AND a."active" = true
    AND (b."balanceAtDate" != 0 OR b."netChange" != 0)
  ORDER BY a."number";
END;
$$;

-- Forked from 20260315000002_exchange-rate-history.sql. The 4-decimal ROUND on
-- the translated balance is deliberate consolidation behavior and is preserved.
DROP FUNCTION IF EXISTS "translateTrialBalance"(TEXT, TEXT, TEXT, DATE, DATE);
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

  -- Closing rate: latest daily rate on or before period end
  SELECT "rate" INTO v_closing_rate
  FROM "exchangeRateHistory"
  WHERE "currencyCode" = v_source_currency
    AND "companyGroupId" = p_company_group_id
    AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;

  -- Average rate: mean of daily rates over the period
  SELECT AVG("rate") INTO v_average_rate
  FROM "exchangeRateHistory"
  WHERE "currencyCode" = v_source_currency
    AND "companyGroupId" = p_company_group_id
    AND "effectiveDate" >= COALESCE(p_period_start, p_period_end - INTERVAL '1 year')
    AND "effectiveDate" <= p_period_end;

  -- Historical rate: from currency table (manually set for equity)
  SELECT "historicalExchangeRate" INTO v_historical_rate
  FROM "currency"
  WHERE "code" = v_source_currency
    AND "companyGroupId" = p_company_group_id;

  -- Defaults: average falls back to closing, historical falls back to closing, all fall back to 1
  v_average_rate := COALESCE(v_average_rate, v_closing_rate, 1);
  v_historical_rate := COALESCE(v_historical_rate, v_closing_rate, 1);
  v_closing_rate := COALESCE(v_closing_rate, 1);

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

-- Forked from 20260403120000_intercompany-tracking.sql
DROP FUNCTION IF EXISTS "matchIntercompanyTransactions"(TEXT);
CREATE OR REPLACE FUNCTION "matchIntercompanyTransactions" (
  p_company_group_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "sourceCompanyId" TEXT,
  "targetCompanyId" TEXT,
  "amount" NUMERIC,
  "status" TEXT,
  "matchedWithId" TEXT
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Check that user belongs to at least one company in this group
  IF NOT EXISTS (
    SELECT 1
    FROM "userToCompany" utc
    INNER JOIN "company" c ON c."id" = utc."companyId"
    WHERE utc."userId" = auth.uid()::text
      AND utc."role" = 'employee'
      AND c."companyGroupId" = p_company_group_id
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to match intercompany transactions';
  END IF;

  -- Match unmatched IC transactions:
  -- Source's receivable against target's payable for the same amount and partner
  WITH matches AS (
    SELECT
      src."id" AS "sourceId",
      tgt."id" AS "targetId"
    FROM "intercompanyTransaction" src
    INNER JOIN "intercompanyTransaction" tgt
      ON src."sourceCompanyId" = tgt."targetCompanyId"
      AND src."targetCompanyId" = tgt."sourceCompanyId"
      AND src."amount" = tgt."amount"
      AND src."companyGroupId" = tgt."companyGroupId"
    WHERE src."companyGroupId" = p_company_group_id
      AND src."status" = 'Unmatched'
      AND tgt."status" = 'Unmatched'
      AND src."sourceJournalLineId" < tgt."sourceJournalLineId"
  )
  UPDATE "intercompanyTransaction" ict
  SET
    "status" = 'Matched',
    "targetJournalLineId" = CASE
      WHEN ict."id" = m."sourceId" THEN (SELECT t."sourceJournalLineId" FROM "intercompanyTransaction" t WHERE t."id" = m."targetId")
      ELSE (SELECT t."sourceJournalLineId" FROM "intercompanyTransaction" t WHERE t."id" = m."sourceId")
    END,
    "updatedAt" = NOW()
  FROM matches m
  WHERE ict."id" IN (m."sourceId", m."targetId");

  -- Return current state
  RETURN QUERY
  SELECT
    ict."id",
    ict."sourceCompanyId",
    ict."targetCompanyId",
    ict."amount",
    ict."status",
    ict."targetJournalLineId" AS "matchedWithId"
  FROM "intercompanyTransaction" ict
  WHERE ict."companyGroupId" = p_company_group_id
  ORDER BY ict."createdAt" DESC;
END;
$$;

-- Forked from 20260403120000_intercompany-tracking.sql
DROP FUNCTION IF EXISTS "getIntercompanyBalance"(TEXT);
CREATE OR REPLACE FUNCTION "getIntercompanyBalance" (
  p_company_group_id TEXT
)
RETURNS TABLE (
  "sourceCompanyId" TEXT,
  "sourceCompanyName" TEXT,
  "targetCompanyId" TEXT,
  "targetCompanyName" TEXT,
  "balance" NUMERIC
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Check that user belongs to at least one company in this group
  IF NOT EXISTS (
    SELECT 1
    FROM "userToCompany" utc
    INNER JOIN "company" c ON c."id" = utc."companyId"
    WHERE utc."userId" = auth.uid()::text
      AND utc."role" = 'employee'
      AND c."companyGroupId" = p_company_group_id
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to view intercompany balance';
  END IF;

  RETURN QUERY
  SELECT
    ict."sourceCompanyId",
    sc."name" AS "sourceCompanyName",
    ict."targetCompanyId",
    tc."name" AS "targetCompanyName",
    SUM(
      CASE
        WHEN ict."status" != 'Eliminated' THEN ict."amount"
        ELSE 0
      END
    ) AS "balance"
  FROM "intercompanyTransaction" ict
  INNER JOIN "company" sc ON sc."id" = ict."sourceCompanyId"
  INNER JOIN "company" tc ON tc."id" = ict."targetCompanyId"
  WHERE ict."companyGroupId" = p_company_group_id
  GROUP BY ict."sourceCompanyId", sc."name", ict."targetCompanyId", tc."name"
  HAVING SUM(
    CASE
      WHEN ict."status" != 'Eliminated' THEN ict."amount"
      ELSE 0
    END
  ) != 0;
END;
$$;
