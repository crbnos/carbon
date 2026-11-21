-- A company's base currency changes only while nothing is denominated in it
-- (20261120222959_base-currency-change-before-first-transaction):
--   1. a company with no data changes, before and after accounting is set up;
--   2. a journal line with an amount, a document or a connected accounting
--      integration refuses the change, and the refusal names the reason;
--   3. a parent refuses while a company of its group holds data, and a
--      subsidiary with no data of its own may change.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/base-currency-change.test.sql
-- All fixtures are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text; company_id text; subsidiary_id text;
  cash_id text; journal_id text; customer_id text; quote_id text;
  item_id text; asset_class_id text; asset_id text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Base currency change ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Base currency change', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_id;
  INSERT INTO "companySettings" (id) VALUES (company_id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "isGroup", "companyGroupId", "createdBy")
    VALUES ('Cash', 'Asset', 'Bank', 'Balance Sheet', false, group_id, 'system')
    RETURNING id INTO cash_id;

  -- ── 1. A company with no data changes ─────────────────────────────────────
  ASSERT NOT EXISTS (SELECT 1 FROM base_currency_change_blockers(company_id)),
    'A company with no data has no blockers';
  UPDATE company SET "baseCurrencyCode" = 'CAD' WHERE id = company_id;
  ASSERT (SELECT "baseCurrencyCode" FROM company WHERE id = company_id) = 'CAD',
    'A company with no data changes its base currency';
  RAISE NOTICE 'PASS a company with no data changes its base currency';

  UPDATE "companySettings"
    SET "accountingCutoverDate" = DATE '2026-09-01',
        "accountingActivatedAt" = now(),
        "accountingActivatedBy" = 'system'
    WHERE id = company_id;
  UPDATE company SET "baseCurrencyCode" = 'USD' WHERE id = company_id;
  ASSERT (SELECT "baseCurrencyCode" FROM company WHERE id = company_id) = 'USD',
    'An activated company with an empty ledger changes its base currency';
  RAISE NOTICE 'PASS accounting set up with an empty ledger does not lock it';

  -- ── 2. Data in the base currency refuses the change ───────────────────────
  INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
    VALUES ('BASE-CHANGE-' || id(), company_id, DATE '2026-09-15', 'Provisional', 'Sales Invoice', 'system')
    RETURNING id INTO journal_id;
  INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference", "companyId")
    VALUES (journal_id, cash_id, 0, 'Zero line', id(), company_id);
  ASSERT NOT EXISTS (SELECT 1 FROM base_currency_change_blockers(company_id)),
    'A journal line of zero holds nothing';

  UPDATE "journalLine" SET amount = 10 WHERE "journalId" = journal_id;
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['ledger-has-amounts'], 'A journal line with an amount blocks';
  BEGIN
    UPDATE company SET "baseCurrencyCode" = 'CAD' WHERE id = company_id;
    RAISE EXCEPTION 'The base currency changed with a journal line';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%base currency is locked: ledger-has-amounts%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS a journal line with an amount refuses the change';
  DELETE FROM "journalLine" WHERE "journalId" = journal_id;
  DELETE FROM journal WHERE id = journal_id;

  INSERT INTO customer (name, "companyId") VALUES ('Base change customer', company_id)
    RETURNING id INTO customer_id;
  INSERT INTO quote ("quoteId", "customerId", "companyId", "createdBy")
    VALUES ('BASE-CHANGE-' || id(), customer_id, company_id, 'system')
    RETURNING id INTO quote_id;
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['has-documents'], 'A Draft quote blocks';
  DELETE FROM quote WHERE id = quote_id;
  ASSERT NOT EXISTS (SELECT 1 FROM base_currency_change_blockers(company_id)),
    'A customer alone does not block';
  RAISE NOTICE 'PASS a document blocks and a customer does not';

  INSERT INTO item ("readableId", name, type, "itemTrackingType", "companyId", "createdBy")
    VALUES ('BASE-CHANGE-' || id(), 'Base change part', 'Part', 'Inventory', company_id, 'system')
    RETURNING id INTO item_id;
  ASSERT NOT EXISTS (SELECT 1 FROM base_currency_change_blockers(company_id)),
    'An item alone does not block';
  INSERT INTO "itemLedger" ("entryType", "itemId", quantity, "companyId")
    VALUES ('Positive Adjmt.', item_id, 1, company_id);
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['has-stock-or-costs'], 'A stock movement blocks';
  DELETE FROM "itemLedger" WHERE "itemId" = item_id;
  RAISE NOTICE 'PASS an item does not block and a stock movement does';

  INSERT INTO "fixedAssetClass" (name, "assetAccountId", "accumulatedDepreciationAccountId",
      "depreciationExpenseAccountId", "writeOffAccountId", "writeDownAccountId",
      "lossOnDisposalAccountId", "gainOnDisposalAccountId", "companyId", "createdBy")
    VALUES ('Base change class', cash_id, cash_id, cash_id, cash_id, cash_id, cash_id, cash_id,
      company_id, 'system')
    RETURNING id INTO asset_class_id;
  INSERT INTO "fixedAsset" ("fixedAssetId", "fixedAssetClassId", name, "companyId", "createdBy")
    VALUES ('BASE-CHANGE-' || id(), asset_class_id, 'Base change asset', company_id, 'system')
    RETURNING id INTO asset_id;
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['has-fixed-assets'], 'A fixed asset blocks';
  DELETE FROM "fixedAsset" WHERE id = asset_id;
  DELETE FROM "fixedAssetClass" WHERE id = asset_class_id;
  RAISE NOTICE 'PASS a fixed asset refuses the change';

  INSERT INTO "externalIntegrationMapping" ("entityType", "entityId", integration, "companyId")
    VALUES ('customer', customer_id, 'quickbooks', company_id);
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['accounting-integration'], 'An accounting provider mapping blocks';
  DELETE FROM "externalIntegrationMapping"
    WHERE "companyId" = company_id AND integration = 'quickbooks';
  RAISE NOTICE 'PASS a disconnected provider with mappings refuses the change';

  INSERT INTO "companyIntegration" (id, "companyId", active, metadata)
    VALUES ('xero', company_id, true, '{}'::jsonb);
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['accounting-integration'], 'A connected accounting provider blocks';
  UPDATE "companyIntegration" SET active = false WHERE id = 'xero' AND "companyId" = company_id;
  ASSERT NOT EXISTS (SELECT 1 FROM base_currency_change_blockers(company_id)),
    'A disconnected provider with no sync history does not block';
  RAISE NOTICE 'PASS a connected accounting provider refuses the change';

  -- ── 3. A parent answers for its group ─────────────────────────────────────
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone, "parentCompanyId")
    VALUES ('Base currency change subsidiary', group_id, 'EUR', 'Europe/Berlin', company_id)
    RETURNING id INTO subsidiary_id;
  INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
    VALUES ('BASE-CHANGE-SUB-' || id(), subsidiary_id, DATE '2026-09-15', 'Provisional', 'Sales Invoice', 'system')
    RETURNING id INTO journal_id;
  INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference", "companyId")
    VALUES (journal_id, cash_id, 25, 'Subsidiary line', id(), subsidiary_id);
  ASSERT ARRAY(SELECT reason FROM base_currency_change_blockers(company_id))
    = ARRAY['group-has-data'], 'A parent whose subsidiary holds data blocks';
  RAISE NOTICE 'PASS a parent refuses while its group holds data';

  DELETE FROM "journalLine" WHERE "journalId" = journal_id;
  DELETE FROM journal WHERE id = journal_id;
  UPDATE company SET "baseCurrencyCode" = 'GBP' WHERE id = subsidiary_id;
  ASSERT (SELECT "baseCurrencyCode" FROM company WHERE id = subsidiary_id) = 'GBP',
    'A subsidiary with no data changes its base currency';
  RAISE NOTICE 'PASS a subsidiary with no data changes its base currency';
END
$proof$;

ROLLBACK;
