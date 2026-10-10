-- The accounting cutover guards (20261009145057_accounting-cutover-guards,
-- 20261009145218_journal-cutover-statuses-rls):
--   1. a set cutover stays one-way unless the session sets app.dataset_apply,
--      and an API role never gets that bypass;
--   2. a user cannot create a Provisional or Superseded journal, move a
--      journal into either status, or add a line to such a journal;
--   3. a Posted charge with no journal accepts only a journal written for it.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/accounting-cutover-guards.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_id text; company_id text;
  user_id text := gen_random_uuid()::text;
  cash_id text; draft_id text; provisional_id text; other_id text;
  charge_id text := 'cutover-guard-charge-' || id();
  moved int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Cutover guards ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Cutover guards', group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_id;
  INSERT INTO "companySettings" (id) VALUES (company_id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO account (name, class, "accountType", "incomeBalance", "isGroup", "companyGroupId", "createdBy")
    VALUES ('Cash', 'Asset', 'Bank', 'Balance Sheet', false, group_id, 'system')
    RETURNING id INTO cash_id;

  -- ── 1. The cutover is one-way outside a dataset apply ─────────────────────
  UPDATE "companySettings"
    SET "accountingCutoverDate" = DATE '2026-09-01',
        "accountingActivatedAt" = now(),
        "accountingActivatedBy" = 'system'
    WHERE id = company_id;

  BEGIN
    UPDATE "companySettings" SET "accountingCutoverDate" = DATE '2025-11-01'
      WHERE id = company_id;
    RAISE EXCEPTION 'A set cutover changed without app.dataset_apply';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%one-way%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS a set cutover refuses a change';

  PERFORM set_config('app.dataset_apply', 'true', true);
  UPDATE "companySettings" SET "accountingCutoverDate" = DATE '2025-11-01'
    WHERE id = company_id;
  ASSERT (SELECT "accountingCutoverDate" FROM "companySettings" WHERE id = company_id)
    = DATE '2025-11-01', 'A dataset apply re-dates the cutover';
  RAISE NOTICE 'PASS a dataset apply re-dates the cutover';

  -- The bypass covers the cutover columns only: the base currency stays locked.
  BEGIN
    UPDATE company SET "baseCurrencyCode" = 'EUR' WHERE id = company_id;
    RAISE EXCEPTION 'The base currency changed after the enable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%base currency is locked%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS a dataset apply leaves the base currency locked';

  -- An API role never gets the bypass, even with the setting on.
  INSERT INTO "user" (id, email) VALUES (user_id, user_id || '@cutover-guards.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role)
    VALUES (user_id, company_id, 'employee');
  INSERT INTO "userPermission" (id, permissions)
    VALUES (user_id, jsonb_build_object(
      'settings_view', jsonb_build_array(company_id),
      'settings_update', jsonb_build_array(company_id),
      'accounting_view', jsonb_build_array(company_id),
      'accounting_create', jsonb_build_array(company_id),
      'accounting_update', jsonb_build_array(company_id),
      'accounting_delete', jsonb_build_array(company_id)));
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE "companySettings" SET "accountingCutoverDate" = DATE '2026-01-01'
      WHERE id = company_id;
    RAISE EXCEPTION 'An API role used the dataset bypass';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%one-way%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('app.dataset_apply', '', true);
  RAISE NOTICE 'PASS an API role never gets the dataset bypass';

  -- ── 2. Users never write the cutover statuses ─────────────────────────────
  INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
    VALUES ('GUARD-DRAFT-' || id(), company_id, DATE '2026-09-15', 'Draft', 'Manual', 'system')
    RETURNING id INTO draft_id;
  INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
    VALUES ('GUARD-PROV-' || id(), company_id, DATE '2026-09-15', 'Provisional', 'Sales Invoice', 'system')
    RETURNING id INTO provisional_id;
  INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference", "companyId")
    VALUES (provisional_id, cash_id, 10, 'Provisional line', id(), company_id);

  SET LOCAL ROLE authenticated;

  UPDATE journal SET description = 'edited' WHERE id = draft_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 1, 'A Draft journal stays editable';

  BEGIN
    INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
      VALUES ('GUARD-USER-PROV-' || id(), company_id, DATE '2026-09-15', 'Provisional', 'Manual', user_id);
    RAISE EXCEPTION 'A user created a Provisional journal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS a user cannot create a Provisional journal';

  -- The SELECT policy admits every status, so the refusal is the UPDATE
  -- policy's WITH CHECK.
  BEGIN
    UPDATE journal SET status = 'Provisional' WHERE id = draft_id;
    RAISE EXCEPTION 'A user moved a Draft journal to Provisional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE journal SET status = 'Superseded' WHERE id = draft_id;
    RAISE EXCEPTION 'A user moved a Draft journal to Superseded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS a user cannot move a journal into Provisional or Superseded';

  UPDATE journal SET description = 'promoted' WHERE id = provisional_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 0, 'A user updated a Provisional journal';
  UPDATE "journalLine" SET amount = 999 WHERE "journalId" = provisional_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 0, 'A user updated a line of a Provisional journal';
  DELETE FROM "journalLine" WHERE "journalId" = provisional_id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  ASSERT moved = 0, 'A user deleted a line of a Provisional journal';
  BEGIN
    INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference", "companyId")
      VALUES (provisional_id, cash_id, 5, 'Injected', id(), company_id);
    RAISE EXCEPTION 'A user added a line to a Provisional journal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference", "companyId")
    VALUES (draft_id, cash_id, 5, 'Draft line', id(), company_id);
  RAISE NOTICE 'PASS a Provisional journal and its lines are closed to users';

  RESET ROLE;

  -- ── 3. A legacy charge takes only its own journal ─────────────────────────
  INSERT INTO charge (id, "chargeId", type, status, "cardAccountId",
    "transactionDate", "currencyCode", amount, "companyId", "createdBy")
    VALUES (charge_id, 'GUARD-CHG-' || id(), 'Charge', 'Draft', cash_id,
      DATE '2026-09-15', 'USD', 10, company_id, 'system');
  UPDATE charge SET status = 'Posted', "postingDate" = DATE '2026-09-15',
      "postedAt" = now(), "postedBy" = 'system'
    WHERE id = charge_id AND "companyId" = company_id;

  -- A journal with no line for this charge.
  BEGIN
    UPDATE charge SET "journalId" = provisional_id
      WHERE id = charge_id AND "companyId" = company_id;
    RAISE EXCEPTION 'A Posted charge took a journal written for another document';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%journal written for it%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS a Posted charge refuses a journal of another document';

  INSERT INTO journal ("journalEntryId", "companyId", "postingDate", status, "sourceType", "createdBy")
    VALUES ('GUARD-CHG-JNL-' || id(), company_id, DATE '2026-09-15', 'Provisional', 'Charge', 'system')
    RETURNING id INTO other_id;
  INSERT INTO "journalLine" ("journalId", "accountId", amount, description, "journalLineReference",
      "documentType", "documentId", "companyId")
    VALUES (other_id, cash_id, 10, 'Charge', id(), 'Charge', charge_id, company_id);
  UPDATE charge SET "journalId" = other_id
    WHERE id = charge_id AND "companyId" = company_id;
  ASSERT (SELECT "journalId" FROM charge WHERE id = charge_id AND "companyId" = company_id)
    = other_id, 'A Posted charge takes the journal written for it';
  RAISE NOTICE 'PASS a Posted charge takes the journal written for it';
END
$proof$;

ROLLBACK;
