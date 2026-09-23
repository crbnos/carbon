-- Charge tenant integrity, lifecycle immutability, and line/header
-- serialization contract.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/ramp-charge-integrity.test.sql
-- All data fixtures and mutations are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.constraint_columns(
  p_table regclass,
  p_constraint text,
  p_referenced boolean DEFAULT false
) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(
    CASE WHEN p_referenced THEN c.confkey ELSE c.conkey END
  ) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a
    ON a.attrelid = CASE WHEN p_referenced THEN c.confrelid ELSE c.conrelid END
   AND a.attnum = k.attnum
  WHERE c.conrelid = p_table
    AND c.conname = p_constraint;
$fn$;

CREATE FUNCTION pg_temp.index_columns(p_index regclass) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT array_agg(a.attname ORDER BY k.ordinality)::text[]
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indexrelid = p_index;
$fn$;

CREATE FUNCTION pg_temp.column_default(p_table regclass, p_column text)
RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT pg_get_expr(d.adbin, d.adrelid)
  FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = p_table
    AND a.attname = p_column;
$fn$;

DO $schema$
DECLARE
  header_guard text;
  line_guard text;
BEGIN
  ASSERT pg_temp.constraint_columns('"charge"', 'charge_pkey')
    = ARRAY['id', 'companyId'],
    'charge must use the composite tenant primary key';
  ASSERT pg_temp.constraint_columns('"chargeLine"', 'chargeLine_pkey')
    = ARRAY['id', 'companyId'],
    'chargeLine must use the composite tenant primary key';
  ASSERT pg_temp.column_default('"charge"', 'id') = 'id()',
    'charge must use the canonical id() default';
  ASSERT pg_temp.column_default('"chargeLine"', 'id') = 'id()',
    'chargeLine must use the canonical id() default';

  ASSERT pg_temp.constraint_columns('"chargeLine"', 'chargeLine_chargeId_fkey')
    = ARRAY['chargeId', 'companyId'],
    'chargeLine parent FK must include companyId';
  ASSERT pg_temp.constraint_columns('"chargeLine"', 'chargeLine_chargeId_fkey', true)
    = ARRAY['id', 'companyId'],
    'chargeLine parent FK must target the composite parent key';
  ASSERT pg_temp.constraint_columns('"charge"', 'charge_supplierId_fkey')
    = ARRAY['supplierId', 'companyId'],
    'charge supplier FK must include companyId';
  ASSERT pg_temp.constraint_columns('"charge"', 'charge_supplierId_fkey', true)
    = ARRAY['id', 'companyId'],
    'charge supplier FK must target the composite supplier key';
  ASSERT pg_temp.constraint_columns('"chargeLine"', 'chargeLine_costCenterId_fkey')
    = ARRAY['costCenterId', 'companyId'],
    'chargeLine cost-center FK must include companyId';
  ASSERT pg_temp.constraint_columns('"chargeLine"', 'chargeLine_costCenterId_fkey', true)
    = ARRAY['id', 'companyId'],
    'chargeLine cost-center FK must target the composite cost-center key';

  ASSERT pg_temp.index_columns('"chargeLine_chargeId_companyId_idx"')
    = ARRAY['chargeId', 'companyId'],
    'chargeLine parent FK needs a matching index';
  ASSERT pg_temp.index_columns('"chargeLine_costCenterId_companyId_idx"')
    = ARRAY['costCenterId', 'companyId'],
    'chargeLine cost-center FK needs a matching index';
  ASSERT pg_temp.index_columns('"charge_companyId_supplierId_idx"')
    = ARRAY['companyId', 'supplierId'],
    'charge supplier FK needs a supporting index';
  ASSERT to_regclass('"charge_cardAccountId_idx"') IS NOT NULL,
    'charge card-account FK needs an index';
  ASSERT to_regclass('"charge_offsetAccountId_idx"') IS NOT NULL,
    'charge offset-account FK needs an index';
  ASSERT to_regclass('"charge_updatedBy_idx"') IS NOT NULL,
    'charge updatedBy FK needs an index';
  ASSERT to_regclass('"chargeLine_updatedBy_idx"') IS NOT NULL,
    'chargeLine updatedBy FK needs an index';
  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"charge"'::regclass
      AND conname = 'charge_lifecycle_audit_check'
      AND contype = 'c'
      AND convalidated
  ), 'charge must have a validated lifecycle audit constraint';

  SELECT pg_get_functiondef(t.tgfoid) INTO header_guard
  FROM pg_trigger t
  WHERE t.tgrelid = '"charge"'::regclass
    AND t.tgname = 'charge_draft_guard'
    AND NOT t.tgisinternal;
  ASSERT header_guard IS NOT NULL,
    'charge must have a lifecycle mutation guard';

  SELECT pg_get_functiondef(t.tgfoid) INTO line_guard
  FROM pg_trigger t
  WHERE t.tgrelid = '"chargeLine"'::regclass
    AND t.tgname = 'chargeLine_draft_guard'
    AND NOT t.tgisinternal;
  ASSERT line_guard IS NOT NULL,
    'chargeLine must have a Draft-only mutation guard';
  ASSERT line_guard ~* 'FOR UPDATE',
    'chargeLine guard must lock its parent row';

  ASSERT (
    SELECT count(*) = 3
    FROM pg_trigger
    WHERE tgrelid = '"charge"'::regclass
      AND tgname IN (
        'trg_event_async_ins_charge',
        'trg_event_async_upd_charge',
        'trg_event_async_del_charge'
      )
      AND NOT tgisinternal
  ), 'charge event-system triggers must be attached exactly once';

  RAISE NOTICE 'PASS composite keys, tenant FKs, indexes, and trigger wiring';
END;
$schema$;

CREATE TYPE pg_temp.ramp_card_fixture AS (
  group_id text,
  company_id text,
  account_id text,
  supplier_id text,
  cost_center_id text,
  journal_id text
);

CREATE FUNCTION pg_temp.seed_ramp_card_company(p_label text)
RETURNS pg_temp.ramp_card_fixture
LANGUAGE plpgsql AS $fn$
DECLARE
  f pg_temp.ramp_card_fixture;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Ramp card integrity ' || p_label || ' ' || id(), 'system')
    RETURNING id INTO f.group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Ramp card integrity ' || p_label || ' ' || id(), f.group_id, 'USD', 'America/New_York')
    RETURNING id INTO f.company_id;
  INSERT INTO "account" (name, class, "accountType", "incomeBalance", "companyGroupId", "createdBy")
    VALUES ('Ramp card account ' || p_label || ' ' || id(), 'Asset', 'Bank', 'Balance Sheet', f.group_id, 'system')
    RETURNING id INTO f.account_id;
  INSERT INTO "supplier" (name, "readableId", "companyId")
    VALUES ('Ramp card supplier ' || p_label || ' ' || id(), 'RCS-' || id(), f.company_id)
    RETURNING id INTO f.supplier_id;
  INSERT INTO "costCenter" (name, "companyId", "createdBy")
    VALUES ('Ramp card cost center ' || p_label || ' ' || id(), f.company_id, 'system')
    RETURNING id INTO f.cost_center_id;
  INSERT INTO "journal" (
    "companyId", "journalEntryId", "postingDate", status, "createdBy"
  ) VALUES (
    f.company_id, 'RAMP-CARD-' || id(), DATE '2026-09-11', 'Posted', 'system'
  ) RETURNING id INTO f.journal_id;
  RETURN f;
END;
$fn$;

DO $integrity$
DECLARE
  a pg_temp.ramp_card_fixture;
  b pg_temp.ramp_card_fixture;
  shared_header_id text := 'ramp-card-shared-' || id();
  shared_line_id text := 'ramp-line-shared-' || id();
  a_header_id text := 'ramp-card-a-' || id();
  b_header_id text := 'ramp-card-b-' || id();
  a_line_id text := 'ramp-line-a-' || id();
  constraint_name text;
BEGIN
  a := pg_temp.seed_ramp_card_company('A');
  b := pg_temp.seed_ramp_card_company('B');

  INSERT INTO "charge" (
    id, "chargeId", type, status, "cardAccountId",
    "transactionDate", "currencyCode", amount, "companyId", "createdBy"
  ) VALUES
    (shared_header_id, 'CARD-A-' || id(), 'Charge', 'Draft', a.account_id,
      DATE '2026-09-11', 'USD', 10, a.company_id, 'system'),
    (shared_header_id, 'CARD-B-' || id(), 'Charge', 'Draft', b.account_id,
      DATE '2026-09-11', 'USD', 10, b.company_id, 'system'),
    (a_header_id, 'CARD-A-' || id(), 'Charge', 'Draft', a.account_id,
      DATE '2026-09-11', 'USD', 10, a.company_id, 'system'),
    (b_header_id, 'CARD-B-' || id(), 'Charge', 'Draft', b.account_id,
      DATE '2026-09-11', 'USD', 10, b.company_id, 'system');
  ASSERT (
    SELECT count(*) = 2 FROM "charge" WHERE id = shared_header_id
  ), 'The same generated-style id must be legal in two companies';

  INSERT INTO "chargeLine" (
    id, "chargeId", "companyId", "accountId", amount, "createdBy"
  ) VALUES
    (shared_line_id, shared_header_id, a.company_id, a.account_id, 10, 'system'),
    (shared_line_id, shared_header_id, b.company_id, b.account_id, 10, 'system'),
    (a_line_id, a_header_id, a.company_id, a.account_id, 10, 'system');
  ASSERT (
    SELECT count(*) = 2 FROM "chargeLine" WHERE id = shared_line_id
  ), 'The same line id must be legal in two companies';

  BEGIN
    UPDATE "charge"
      SET "supplierId" = b.supplier_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-company supplier was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'charge_supplierId_fkey',
      'Expected the composite supplier constraint';
  END;

  BEGIN
    INSERT INTO "chargeLine" (
      "chargeId", "companyId", "accountId", amount, "createdBy"
    ) VALUES (b_header_id, a.company_id, a.account_id, 1, 'system');
    ASSERT false, 'Cross-company charge parent was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'chargeLine_chargeId_fkey',
      'Expected the composite parent constraint';
  END;

  BEGIN
    UPDATE "chargeLine"
      SET "costCenterId" = b.cost_center_id
      WHERE id = a_line_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-company cost center was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'chargeLine_costCenterId_fkey',
      'Expected the composite cost-center constraint';
  END;

  BEGIN
    UPDATE "chargeLine"
      SET "accountId" = b.account_id
      WHERE id = a_line_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group line account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'chargeLine_account_companyGroup_check',
      'Expected the line account company-group guard';
  END;

  BEGIN
    UPDATE "charge"
      SET "cardAccountId" = b.account_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group card account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'charge_account_companyGroup_check',
      'Expected the company-group account guard';
  END;

  BEGIN
    UPDATE "charge"
      SET type = 'Payment', "offsetAccountId" = b.account_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group offset account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'charge_account_companyGroup_check',
      'Expected the company-group account guard';
  END;

  RAISE NOTICE 'PASS composite keys reject cross-tenant references and account groups';
END;
$integrity$;

CREATE FUNCTION pg_temp.assert_card_lifecycle_rejected(
  p_label text,
  p_company_id text,
  p_account_id text,
  p_status "chargeStatus",
  p_posting_date date,
  p_journal_id text,
  p_posted_at timestamp with time zone,
  p_posted_by text,
  p_voided_at timestamp with time zone,
  p_voided_by text
) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  constraint_name text;
BEGIN
  BEGIN
    INSERT INTO "charge" (
      "chargeId", type, status, "cardAccountId",
      "transactionDate", "postingDate", "currencyCode", amount,
      "journalId", "postedAt", "postedBy", "voidedAt", "voidedBy",
      "companyId", "createdBy"
    ) VALUES (
      'CARD-INVALID-' || id(), 'Charge', p_status, p_account_id,
      DATE '2026-09-11', p_posting_date, 'USD', 1,
      p_journal_id, p_posted_at, p_posted_by, p_voided_at, p_voided_by,
      p_company_id, 'system'
    );
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'charge_lifecycle_audit_check',
      p_label || ' hit the wrong CHECK constraint';
    RETURN;
  END;
  RAISE EXCEPTION '% was accepted', p_label;
END;
$fn$;

DO $lifecycle$
DECLARE
  f pg_temp.ramp_card_fixture;
  header_id text := 'ramp-card-lifecycle-' || id();
  disposable_id text := 'ramp-card-disposable-' || id();
  line_id text := 'ramp-line-lifecycle-' || id();
BEGIN
  f := pg_temp.seed_ramp_card_company('lifecycle');

  -- Bypass only the ordinary lifecycle trigger inside the outer rollback so
  -- every nullable operand is exercised directly against the stored CHECK.
  EXECUTE 'ALTER TABLE "charge" DISABLE TRIGGER "charge_draft_guard"';
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Draft with journalId', f.company_id, f.account_id, 'Draft',
    DATE '2026-09-11', f.journal_id, NULL, NULL, NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Draft with postedAt', f.company_id, f.account_id, 'Draft',
    DATE '2026-09-11', NULL, now(), NULL, NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Draft with postedBy', f.company_id, f.account_id, 'Draft',
    DATE '2026-09-11', NULL, NULL, 'system', NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Draft with voidedAt', f.company_id, f.account_id, 'Draft',
    DATE '2026-09-11', NULL, NULL, NULL, now(), NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Draft with voidedBy', f.company_id, f.account_id, 'Draft',
    DATE '2026-09-11', NULL, NULL, NULL, NULL, 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Posted without postingDate', f.company_id, f.account_id, 'Posted',
    NULL, NULL, now(), 'system', NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Posted without postedAt', f.company_id, f.account_id, 'Posted',
    DATE '2026-09-11', NULL, NULL, 'system', NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Posted without postedBy', f.company_id, f.account_id, 'Posted',
    DATE '2026-09-11', NULL, now(), NULL, NULL, NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Posted with voidedAt', f.company_id, f.account_id, 'Posted',
    DATE '2026-09-11', NULL, now(), 'system', now(), NULL
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Posted with voidedBy', f.company_id, f.account_id, 'Posted',
    DATE '2026-09-11', NULL, now(), 'system', NULL, 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Voided without postingDate', f.company_id, f.account_id, 'Voided',
    NULL, NULL, now(), 'system', now(), 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Voided without postedAt', f.company_id, f.account_id, 'Voided',
    DATE '2026-09-11', NULL, NULL, 'system', now(), 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Voided without postedBy', f.company_id, f.account_id, 'Voided',
    DATE '2026-09-11', NULL, now(), NULL, now(), 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Voided without voidedAt', f.company_id, f.account_id, 'Voided',
    DATE '2026-09-11', NULL, now(), 'system', NULL, 'system'
  );
  PERFORM pg_temp.assert_card_lifecycle_rejected(
    'Voided without voidedBy', f.company_id, f.account_id, 'Voided',
    DATE '2026-09-11', NULL, now(), 'system', now(), NULL
  );
  EXECUTE 'ALTER TABLE "charge" ENABLE TRIGGER "charge_draft_guard"';

  BEGIN
    INSERT INTO "charge" (
      "chargeId", type, status, "cardAccountId",
      "transactionDate", "currencyCode", amount, "companyId", "createdBy"
    ) VALUES (
      'CARD-NONDRAFT-' || id(), 'Charge', 'Posted', f.account_id,
      DATE '2026-09-11', 'USD', 1, f.company_id, 'system'
    );
    ASSERT false, 'A charge was created outside Draft';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  INSERT INTO "charge" (
    id, "chargeId", type, status, "cardAccountId",
    "transactionDate", "postingDate", "currencyCode", amount, "companyId", "createdBy"
  ) VALUES (
    header_id, 'CARD-LIFE-' || id(), 'Charge', 'Draft', f.account_id,
    DATE '2026-09-11', DATE '2026-09-11', 'USD', 10, f.company_id, 'system'
  );
  INSERT INTO "chargeLine" (
    id, "chargeId", "companyId", "accountId", amount, "createdBy"
  ) VALUES (line_id, header_id, f.company_id, f.account_id, 10, 'system');

  UPDATE "charge"
    SET memo = 'Draft edit'
    WHERE id = header_id AND "companyId" = f.company_id;
  UPDATE "chargeLine"
    SET description = 'Draft edit'
    WHERE id = line_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "charge"
      SET status = 'Voided', "voidedAt" = now(), "voidedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Draft-to-Voided transition was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    UPDATE "charge"
      SET status = 'Posted', memo = 'content changed while posting',
          "postedAt" = now(), "postedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posting transition changed immutable content';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  UPDATE "charge"
    SET status = 'Posted', "postingDate" = DATE '2026-09-11',
        "postedAt" = now(), "postedBy" = 'system',
        "updatedAt" = now(), "updatedBy" = 'system'
    WHERE id = header_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "charge" SET memo = 'illegal'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted header content was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE "charge" SET status = 'Draft'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted header reopened directly';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE "chargeLine" SET amount = 9
      WHERE id = line_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted parent allowed a line update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    INSERT INTO "chargeLine" (
      "chargeId", "companyId", "accountId", amount, "createdBy"
    ) VALUES (header_id, f.company_id, f.account_id, 1, 'system');
    ASSERT false, 'Posted parent allowed a line insert';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM "chargeLine"
      WHERE id = line_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted parent allowed a line delete';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    UPDATE "charge"
      SET status = 'Voided', memo = 'changed while voiding',
          "voidedAt" = now(), "voidedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voiding transition changed immutable content';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  UPDATE "charge"
    SET status = 'Voided', "voidedAt" = now(), "voidedBy" = 'system',
        "updatedAt" = now(), "updatedBy" = 'system'
    WHERE id = header_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "charge" SET memo = 'illegal'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voided header content was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM "charge"
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voided header was deletable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  INSERT INTO "charge" (
    id, "chargeId", type, status, "cardAccountId",
    "transactionDate", "currencyCode", amount, "companyId", "createdBy"
  ) VALUES (
    disposable_id, 'CARD-DROP-' || id(), 'Charge', 'Draft', f.account_id,
    DATE '2026-09-11', 'USD', 1, f.company_id, 'system'
  );
  INSERT INTO "chargeLine" (
    "chargeId", "companyId", "accountId", amount, "createdBy"
  ) VALUES (disposable_id, f.company_id, f.account_id, 1, 'system');
  DELETE FROM "charge"
    WHERE id = disposable_id AND "companyId" = f.company_id;
  ASSERT NOT EXISTS (
    SELECT 1 FROM "charge"
    WHERE id = disposable_id AND "companyId" = f.company_id
  ), 'Draft header delete must remain legal';

  RAISE NOTICE 'PASS Draft edits, lifecycle transitions, and immutability';
END;
$lifecycle$;

ROLLBACK;
