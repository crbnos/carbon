-- Shipping-account migration and settlement-funding constraints.
-- Run from the repository root against the existing local development database:
--   pnpm exec tsx .context/accounting/run-local-check.ts psql -X \
--     -v ON_ERROR_STOP=1 \
--     -f packages/database/supabase/tests/accounting-shipping-backfill.test.sql
--
-- Before migration this fails at the first missing-schema assertion. After
-- migration it exercises the ACTUAL migration backfill, loaded from its unique
-- CLI-generated file; no copied implementation or embedded COMMIT is executed.
-- All fixtures use new IDs and the outer transaction always rolls back. A failed
-- assertion terminates psql, which also rolls back the open transaction.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $contract$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'accountDefault' AND column_name = 'salesShippingRevenueAccount'
  ), 'Schema contract: accountDefault.salesShippingRevenueAccount is missing';
  ASSERT (
    SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'invoiceSettlement' AND column_name IN ('sourcePaymentId', 'sourceAmount')
  ), 'Schema contract: invoiceSettlement funding columns are missing';
  ASSERT (
    SELECT is_generated = 'NEVER' FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoiceSettlement'
      AND column_name = 'fxGainLossAmount'
  ), 'Schema contract: fxGainLossAmount must be a server-written snapshot';
END;
$contract$;

CREATE TEMP TABLE accounting_backfill_sql (body text NOT NULL) ON COMMIT DROP;
-- Python runs locally through psql, reads only a repository file, and emits one
-- CSV field so newlines/quotes survive unchanged. The boundaries deliberately
-- exclude all schema DDL and the migration's outer BEGIN/COMMIT.
\copy accounting_backfill_sql FROM PROGRAM 'python3 -c "from pathlib import Path; import csv,sys; paths=list(Path(\"packages/database/supabase/migrations\").glob(\"*_accounting_posting_corrections.sql\")); assert len(paths)==1, \"Expected exactly one accounting posting migration\"; sql=paths[0].read_text(); start=sql.index(\"-- Serialize chart/default resolution\"); end=sql.index(\"COMMENT ON COLUMN\",start); csv.writer(sys.stdout).writerow([sql[start:end]])"' WITH (FORMAT csv)

CREATE FUNCTION pg_temp.run_shipping_backfill() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE body text;
BEGIN
  SELECT s.body INTO STRICT body FROM accounting_backfill_sql s;
  -- A real migration commit drops this temporary resolution table. Removing
  -- only that scratch table models a fresh retry inside our rollback harness.
  DROP TABLE IF EXISTS pg_temp.accounting_shipping_resolution;
  EXECUTE body;
END;
$fn$;

CREATE TYPE pg_temp.shipping_fixture AS (
  group_id text, company_ids text[], parent_id text, sales_id text
);

CREATE FUNCTION pg_temp.seed_shipping_chart(p_companies integer DEFAULT 1)
RETURNS pg_temp.shipping_fixture LANGUAGE plpgsql AS $fn$
DECLARE
  f pg_temp.shipping_fixture;
  defaults_json jsonb;
BEGIN
  ASSERT p_companies > 0, 'Fixture needs a company';
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Shipping harness ' || id(), 'system') RETURNING id INTO f.group_id;
  WITH inserted AS (
    INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode")
    SELECT id(), 'Shipping harness company ' || id(), f.group_id, 'USD'
    FROM generate_series(1, p_companies)
    RETURNING id
  ) SELECT array_agg(id ORDER BY id) INTO f.company_ids FROM inserted;

  INSERT INTO "account" (name, class, "accountType", "incomeBalance", "consolidatedRate",
    "isGroup", "companyGroupId", "createdBy")
  VALUES ('Revenue', 'Revenue', 'Income', 'Income Statement', 'Average', true,
    f.group_id, 'system') RETURNING id INTO f.parent_id;
  INSERT INTO "account" (number, name, class, "accountType", "incomeBalance", "consolidatedRate",
    "parentId", "companyGroupId", "createdBy")
  VALUES ('4010', 'Sales', 'Revenue', 'Income', 'Income Statement', 'Average',
    f.parent_id, f.group_id, 'system') RETURNING id INTO f.sales_id;

  -- Unrelated mandatory defaults only need a valid fixture-owned FK; none is
  -- posted by these schema/backfill tests. Derive the mandatory columns from the
  -- current schema so adding an unrelated default does not require fake seed data.
  SELECT jsonb_object_agg(attname, to_jsonb(f.sales_id)) INTO defaults_json
  FROM pg_attribute WHERE attrelid = '"accountDefault"'::regclass
    AND attnum > 0 AND NOT attisdropped AND attnotnull AND attname <> 'companyId';
  INSERT INTO "accountDefault"
  SELECT (jsonb_populate_record(NULL::"accountDefault",
    defaults_json || jsonb_build_object('companyId', company_id))).*
  FROM unnest(f.company_ids) AS company_id;
  RETURN f;
END;
$fn$;

CREATE FUNCTION pg_temp.add_revenue_leaf(f pg_temp.shipping_fixture, p_name text, p_number text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE account_id text;
BEGIN
  INSERT INTO "account" (number, name, class, "accountType", "incomeBalance", "consolidatedRate",
    "parentId", "companyGroupId", "createdBy")
  VALUES (p_number, p_name, 'Revenue', 'Income', 'Income Statement', 'Average',
    f.parent_id, f.group_id, 'system') RETURNING id INTO account_id;
  RETURN account_id;
END;
$fn$;

CREATE FUNCTION pg_temp.expect_backfill_failure(p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE actual_message text;
BEGIN
  BEGIN
    PERFORM pg_temp.run_shipping_backfill();
    ASSERT false, 'Expected migration refusal: ' || p_message;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
    ASSERT position(p_message IN actual_message) > 0,
      'Wrong migration refusal: ' || actual_message;
  END;
END;
$fn$;

-- Preserve complete existing records, not just counts. Even while all writes
-- roll back, the harness refuses to use or modify real company/account defaults.
CREATE TEMP TABLE accounting_original_accounts ON COMMIT DROP AS
SELECT id, to_jsonb(a) AS body FROM "account" a;
CREATE TEMP TABLE accounting_original_defaults ON COMMIT DROP AS
SELECT "companyId", to_jsonb(ad) AS body FROM "accountDefault" ad;

DO $backfill_cases$
DECLARE
  f pg_temp.shipping_fixture;
  good pg_temp.shipping_fixture;
  shipping_id text;
  custom_id text;
  second_parent text;
  before_accounts jsonb;
  before_defaults jsonb;
BEGIN
  -- A custom SQLSTATE unwinds each successful scenario's fixtures. Assertion
  -- errors use P0004 and are never caught as successful test execution.
  BEGIN
    f := pg_temp.seed_shipping_chart(2);
    PERFORM pg_temp.run_shipping_backfill();
    SELECT "salesShippingRevenueAccount" INTO shipping_id FROM "accountDefault"
      WHERE "companyId" = f.company_ids[1];
    ASSERT shipping_id IS NOT NULL AND shipping_id <> f.sales_id, 'Fresh chart: separate shipping account';
    ASSERT (SELECT number = '4040' AND name = 'Shipping Revenue' AND class = 'Revenue'
      AND "accountType" = 'Income' AND "incomeBalance" = 'Income Statement'
      AND "consolidatedRate" = 'Average' AND NOT "isGroup" AND active
      AND "parentId" = f.parent_id AND "companyGroupId" = f.group_id
      FROM "account" WHERE id = shipping_id), 'Fresh chart: complete revenue leaf under Revenue';
    ASSERT (SELECT count(*) = 1 FROM "account" WHERE "companyGroupId" = f.group_id
      AND name = 'Shipping Revenue'), 'Shared chart: exactly one shipping leaf';
    ASSERT (SELECT bool_and("salesShippingRevenueAccount" = shipping_id)
      FROM "accountDefault" WHERE "companyId" = ANY(f.company_ids)), 'Shared chart: same default for both companies';
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO before_accounts FROM "account" a WHERE "companyGroupId" = f.group_id;
    SELECT jsonb_agg(to_jsonb(ad) ORDER BY "companyId") INTO before_defaults FROM "accountDefault" ad WHERE "companyId" = ANY(f.company_ids);
    PERFORM pg_temp.run_shipping_backfill();
    ASSERT (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM "account" a WHERE "companyGroupId" = f.group_id) = before_accounts,
      'Rerun must preserve all account records';
    ASSERT (SELECT jsonb_agg(to_jsonb(ad) ORDER BY "companyId") FROM "accountDefault" ad WHERE "companyId" = ANY(f.company_ids)) = before_defaults,
      'Rerun must preserve defaults including timestamps';
    RAISE NOTICE 'PASS fresh/shared chart and exact rerun preservation';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart(2);
    shipping_id := pg_temp.add_revenue_leaf(f, 'Shipping Revenue', '4897');
    custom_id := pg_temp.add_revenue_leaf(f, 'Customer Freight Recovery', '4801');
    UPDATE "accountDefault" SET "salesShippingRevenueAccount" = custom_id WHERE "companyId" = f.company_ids[1];
    PERFORM pg_temp.run_shipping_backfill();
    ASSERT (SELECT "salesShippingRevenueAccount" = custom_id FROM "accountDefault" WHERE "companyId" = f.company_ids[1]),
      'Populated custom shipping default must be preserved';
    ASSERT (SELECT "salesShippingRevenueAccount" = shipping_id FROM "accountDefault" WHERE "companyId" = f.company_ids[2]),
      'Reuse existing custom-number Shipping Revenue leaf';
    ASSERT (SELECT number = '4897' FROM "account" WHERE id = shipping_id), 'Reuse must not renumber shipping';
    ASSERT (SELECT count(*) = 1 FROM "account" WHERE "companyGroupId" = f.group_id AND name = 'Shipping Revenue'),
      'Reuse must not duplicate shipping';
    RAISE NOTICE 'PASS custom default and custom-number leaf preservation';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    custom_id := pg_temp.add_revenue_leaf(f, 'Existing account at 4040', '4040');
    PERFORM pg_temp.run_shipping_backfill();
    ASSERT (SELECT number = '4050' FROM "account" WHERE "companyGroupId" = f.group_id AND name = 'Shipping Revenue'),
      'Occupied 4040: use next free account number';
    ASSERT (SELECT number = '4040' AND name = 'Existing account at 4040' FROM "account" WHERE id = custom_id),
      'Occupied 4040: preserve its owner';
    RAISE NOTICE 'PASS account-number collision';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    INSERT INTO "account" (number, name, class, "accountType", "incomeBalance", "consolidatedRate",
      "parentId", "companyGroupId", "createdBy")
    SELECT n::text, 'Occupied ' || n, 'Revenue', 'Income', 'Income Statement', 'Average',
      f.parent_id, f.group_id, 'system' FROM generate_series(4040, 4990, 10) AS n;
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue parent/account/number for groups: ' || f.group_id);
    ASSERT NOT EXISTS (SELECT 1 FROM "account" WHERE "companyGroupId" = f.group_id AND name = 'Shipping Revenue'),
      'Exhausted range: do not insert an unnumbered shipping account';
    RAISE NOTICE 'PASS exhausted number range rejected with group identity';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    UPDATE "account" SET name = 'Operating Revenue' WHERE id = f.parent_id;
    PERFORM pg_temp.run_shipping_backfill();
    ASSERT (SELECT "parentId" = f.parent_id FROM "account" WHERE "companyGroupId" = f.group_id AND name = 'Shipping Revenue'),
      'Renamed Revenue group: use the unique compatible sales parent';
    RAISE NOTICE 'PASS renamed parent resolution';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    UPDATE "account" SET name = 'Operating Revenue' WHERE id = f.parent_id;
    UPDATE "account" SET "parentId" = NULL WHERE id = f.sales_id;
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    RAISE NOTICE 'PASS missing compatible parent rejected';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart(2);
    UPDATE "account" SET name = 'Revenue A' WHERE id = f.parent_id;
    INSERT INTO "account" (name, class, "accountType", "incomeBalance", "isGroup", "companyGroupId", "createdBy")
      VALUES ('Revenue B', 'Revenue', 'Income', 'Income Statement', true, f.group_id, 'system') RETURNING id INTO second_parent;
    custom_id := pg_temp.add_revenue_leaf(f, 'Other Sales', '4020');
    UPDATE "account" SET "parentId" = second_parent WHERE id = custom_id;
    UPDATE "accountDefault" SET "salesAccount" = custom_id WHERE "companyId" = f.company_ids[2];
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    ASSERT NOT EXISTS (SELECT 1 FROM "account" WHERE "companyGroupId" = f.group_id AND name = 'Shipping Revenue'),
      'Ambiguous parents: no orphaned/guessed shipping account';
    RAISE NOTICE 'PASS ambiguous sales parents rejected';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    good := pg_temp.seed_shipping_chart();
    f := pg_temp.seed_shipping_chart();
    UPDATE "account" SET class = 'Expense' WHERE id = f.parent_id;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO before_accounts FROM "account" a
      WHERE "companyGroupId" IN (good.group_id, f.group_id);
    SELECT jsonb_agg(to_jsonb(ad) ORDER BY "companyId") INTO before_defaults FROM "accountDefault" ad
      WHERE "companyId" = ANY(good.company_ids || f.company_ids);
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    ASSERT (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM "account" a
      WHERE "companyGroupId" IN (good.group_id, f.group_id)) = before_accounts,
      'One incompatible group must roll back all account changes';
    ASSERT (SELECT jsonb_agg(to_jsonb(ad) ORDER BY "companyId") FROM "accountDefault" ad
      WHERE "companyId" = ANY(good.company_ids || f.company_ids)) = before_defaults,
      'One incompatible group must roll back all default changes';
    RAISE NOTICE 'PASS incompatible canonical parent and multi-group atomic failure';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    INSERT INTO "account" (name, class, "accountType", "incomeBalance", "isGroup", "companyGroupId", "createdBy")
      VALUES ('Shipping Revenue', 'Revenue', 'Income', 'Income Statement', true, f.group_id, 'system');
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    RAISE NOTICE 'PASS conflicting Shipping Revenue group rejected';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    shipping_id := pg_temp.add_revenue_leaf(f, 'Shipping Revenue', '4897');
    UPDATE "account" SET "parentId" = NULL WHERE id = shipping_id;
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    RAISE NOTICE 'PASS existing incompatible shipping leaf rejected';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    UPDATE "account" SET name = 'Shipping Revenue' WHERE id = f.sales_id;
    PERFORM pg_temp.expect_backfill_failure('Cannot resolve Shipping Revenue');
    RAISE NOTICE 'PASS shipping candidate cannot equal the sales default';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    UPDATE "accountDefault" SET "salesShippingRevenueAccount" = f.sales_id WHERE "companyId" = f.company_ids[1];
    PERFORM pg_temp.expect_backfill_failure('Invalid shipping defaults');
    RAISE NOTICE 'PASS populated shipping default cannot equal sales';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  BEGIN
    f := pg_temp.seed_shipping_chart();
    good := pg_temp.seed_shipping_chart();
    custom_id := pg_temp.add_revenue_leaf(good, 'Other group freight', '4801');
    UPDATE "accountDefault" SET "salesShippingRevenueAccount" = custom_id WHERE "companyId" = f.company_ids[1];
    PERFORM pg_temp.expect_backfill_failure('Invalid shipping defaults for companies: ' || f.company_ids[1]);
    RAISE NOTICE 'PASS cross-group shipping default rejected with company identity';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  ASSERT NOT EXISTS (SELECT 1 FROM accounting_original_accounts original
    LEFT JOIN "account" a ON a.id = original.id WHERE to_jsonb(a) IS DISTINCT FROM original.body),
    'Harness must not alter any original accounts';
  ASSERT NOT EXISTS (SELECT 1 FROM accounting_original_defaults original
    LEFT JOIN "accountDefault" ad ON ad."companyId" = original."companyId" WHERE to_jsonb(ad) IS DISTINCT FROM original.body),
    'Harness must not alter any original defaults';
END;
$backfill_cases$;

DO $settlement_cases$
DECLARE
  f pg_temp.shipping_fixture;
  other pg_temp.shipping_fixture;
  customer_id text;
  other_customer_id text;
  owner_id text;
  source_id text;
  other_source_id text;
  target_id text;
  memo_source_id text;
  settlement_id text;
  invalid_amount numeric;
  constraint_name text;
BEGIN
  f := pg_temp.seed_shipping_chart();
  other := pg_temp.seed_shipping_chart();
  INSERT INTO "customer" (name, "companyId", "createdBy")
    VALUES ('Settlement customer', f.company_ids[1], 'system') RETURNING id INTO customer_id;
  INSERT INTO "customer" (name, "companyId", "createdBy")
    VALUES ('Other company customer', other.company_ids[1], 'system') RETURNING id INTO other_customer_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy")
    VALUES ('APPLY', 'Receipt', DATE '2026-09-07', 'USD', 0.01, f.sales_id, customer_id, f.company_ids[1], 'system') RETURNING id INTO owner_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy")
    VALUES ('SOURCE', 'Receipt', DATE '2026-09-06', 'USD', 0.01, f.sales_id, customer_id, f.company_ids[1], 'system') RETURNING id INTO source_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy")
    VALUES ('OTHER-SOURCE', 'Receipt', DATE '2026-09-06', 'USD', 0.01, other.sales_id, other_customer_id, other.company_ids[1], 'system') RETURNING id INTO other_source_id;
  INSERT INTO "memo" ("memoId", direction, "memoDate", "currencyCode", amount, "customerId", "companyId", "createdBy")
    VALUES ('TARGET', 'Debit', DATE '2026-09-07', 'USD', 0.01, customer_id, f.company_ids[1], 'system') RETURNING id INTO target_id;
  INSERT INTO "memo" ("memoId", direction, "memoDate", "currencyCode", amount, "customerId", "companyId", "createdBy")
    VALUES ('MEMO-SOURCE', 'Credit', DATE '2026-09-07', 'USD', 0.01, customer_id, f.company_ids[1], 'system') RETURNING id INTO memo_source_id;

  -- This is the terminal 0.01 document-currency application at rate 16000:
  -- internal base principal rounds to zero, but source principal must survive.
  INSERT INTO "invoiceSettlement" ("paymentId", "sourcePaymentId", "targetMemoId", "appliedAmount", "sourceAmount",
    "sourceExchangeRate", "targetExchangeRate", "appliedDate", "companyId", "createdBy", "fxGainLossAmount")
  VALUES (owner_id, source_id, target_id, 0, 0.01, 16000, 16000, DATE '2026-09-07', f.company_ids[1], 'system', 0)
  RETURNING id INTO settlement_id;
  ASSERT (SELECT "appliedAmount" = 0 AND "sourceAmount" = 0.01 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Source-only minor-unit allocation must survive base rounding';
  UPDATE "invoiceSettlement" SET "fxGainLossAmount" = -0.00001 WHERE id = settlement_id;
  ASSERT (SELECT "fxGainLossAmount" = -0.00001 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Signed FX snapshot must be writable';
  RAISE NOTICE 'PASS source-only minor-unit allocation and writable FX snapshot';

  BEGIN
    UPDATE "invoiceSettlement" SET "sourcePaymentId" = other_source_id WHERE id = settlement_id;
    ASSERT false, 'Cross-company source payment must be refused';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_companyId_fkey', 'Expected same-company funding FK';
  END;
  BEGIN
    UPDATE "invoiceSettlement" SET "sourcePaymentId" = owner_id WHERE id = settlement_id;
    ASSERT false, 'A payment must not fund itself as prior credit';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_check', 'Expected self-funding constraint';
  END;
  BEGIN
    UPDATE "invoiceSettlement" SET "paymentId" = NULL, "memoId" = memo_source_id WHERE id = settlement_id;
    ASSERT false, 'Memo-owned allocation must not name a source payment';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_check', 'Expected payment-only funding constraint';
  END;
  BEGIN
    DELETE FROM "payment" WHERE id = source_id AND "companyId" = f.company_ids[1];
    ASSERT false, 'Referenced funding payment must be retained';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_companyId_fkey', 'Expected funding-source delete protection';
  END;
  RAISE NOTICE 'PASS same-company FK, self-funding, payment owner, and source deletion guards';

  FOREACH invalid_amount IN ARRAY ARRAY[-0.01::numeric, 'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric] LOOP
    BEGIN
      -- Positive appliedAmount isolates sourceAmount validation from the
      -- zero-components check, proving exactly the constraint under test.
      UPDATE "invoiceSettlement" SET "appliedAmount" = 1, "sourceAmount" = invalid_amount WHERE id = settlement_id;
      ASSERT false, 'Invalid source amount accepted: ' || invalid_amount;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      ASSERT constraint_name = 'invoiceSettlement_sourceAmount_check', 'Expected source-amount constraint for ' || invalid_amount;
    END;
  END LOOP;
  BEGIN
    UPDATE "invoiceSettlement" SET "sourceAmount" = 0 WHERE id = settlement_id;
    ASSERT false, 'An entirely empty allocation must still be refused';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_anyComponent_check', 'Expected empty-allocation constraint';
  END;
  UPDATE "invoiceSettlement" SET "sourcePaymentId" = NULL WHERE id = settlement_id;
  ASSERT (SELECT "sourcePaymentId" IS NULL AND "sourceAmount" = 0.01 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Current cash may supply a source-only minor-unit allocation';
  RAISE NOTICE 'PASS finite/nonnegative source amounts, empty allocation refusal, and current-cash source';
  RAISE NOTICE 'ALL SHIPPING BACKFILL AND SETTLEMENT SCHEMA SCENARIOS PASSED';
END;
$settlement_cases$;

ROLLBACK;
