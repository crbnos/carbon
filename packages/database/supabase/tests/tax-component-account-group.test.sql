-- A tax code component's accounts must belong to its company's group
-- (20261017122703_tax-component-account-group.sql).
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/tax-component-account-group.test.sql
-- All data fixtures and mutations are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE TYPE pg_temp.tax_group_fixture AS (
  group_id text,
  company_id text,
  account_id text,
  tax_code_id text
);

CREATE FUNCTION pg_temp.seed_tax_group_company(p_label text)
RETURNS pg_temp.tax_group_fixture
LANGUAGE plpgsql AS $fn$
DECLARE
  f pg_temp.tax_group_fixture;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Tax component group ' || p_label || ' ' || id(), 'system')
    RETURNING id INTO f.group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Tax component group ' || p_label || ' ' || id(), f.group_id, 'USD', 'America/New_York')
    RETURNING id INTO f.company_id;
  INSERT INTO "account" (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Tax component account ' || p_label || ' ' || id(), 'Liability', 'Other Current Liability', 'Balance Sheet', f.group_id, 'system')
    RETURNING id INTO f.account_id;
  INSERT INTO "taxCode" (name, "companyId", "createdBy")
    VALUES ('Tax code ' || p_label || ' ' || id(), f.company_id, 'system')
    RETURNING id INTO f.tax_code_id;
  RETURN f;
END;
$fn$;

DO $integrity$
DECLARE
  a pg_temp.tax_group_fixture;
  b pg_temp.tax_group_fixture;
  component_id text;
  constraint_name text;
BEGIN
  a := pg_temp.seed_tax_group_company('A');
  b := pg_temp.seed_tax_group_company('B');

  -- The company's own group's accounts, and no accounts, are accepted.
  INSERT INTO "taxCodeComponent" (
    "companyId", "taxCodeId", name, "taxPercent",
    "taxReceivedAccountId", "taxPaidAccountId", "createdBy"
  ) VALUES (
    a.company_id, a.tax_code_id, 'State', 0.05,
    a.account_id, a.account_id, 'system'
  ) RETURNING id INTO component_id;
  INSERT INTO "taxCodeComponent" (
    "companyId", "taxCodeId", name, "taxPercent", "createdBy"
  ) VALUES (a.company_id, a.tax_code_id, 'County', 0.01, 'system');

  BEGIN
    INSERT INTO "taxCodeComponent" (
      "companyId", "taxCodeId", name, "taxPercent",
      "taxReceivedAccountId", "createdBy"
    ) VALUES (
      a.company_id, a.tax_code_id, 'City', 0.01, b.account_id, 'system'
    );
    ASSERT false, 'Cross-group Tax Received account was accepted on insert';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'taxCodeComponent_account_companyGroup_check',
      'Expected the tax component account company-group guard';
  END;

  BEGIN
    UPDATE "taxCodeComponent"
      SET "taxReceivedAccountId" = b.account_id
      WHERE id = component_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group Tax Received account was accepted on update';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'taxCodeComponent_account_companyGroup_check',
      'Expected the tax component account company-group guard';
  END;

  BEGIN
    UPDATE "taxCodeComponent"
      SET "taxPaidAccountId" = b.account_id
      WHERE id = component_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group Tax Paid account was accepted on update';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'taxCodeComponent_account_companyGroup_check',
      'Expected the tax component account company-group guard';
  END;

  -- An edit that leaves the accounts alone is not re-checked.
  UPDATE "taxCodeComponent"
    SET name = 'State (renamed)'
    WHERE id = component_id AND "companyId" = a.company_id;

  RAISE NOTICE 'PASS tax code components refuse another company group''s accounts';
END;
$integrity$;

ROLLBACK;
