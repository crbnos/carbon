-- Card-transaction tenant integrity, lifecycle immutability, and line/header
-- serialization contract.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/ramp-card-transaction-integrity.test.sql
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
  ASSERT pg_temp.constraint_columns('"cardTransaction"', 'cardTransaction_pkey')
    = ARRAY['id', 'companyId'],
    'cardTransaction must use the composite tenant primary key';
  ASSERT pg_temp.constraint_columns('"cardTransactionLine"', 'cardTransactionLine_pkey')
    = ARRAY['id', 'companyId'],
    'cardTransactionLine must use the composite tenant primary key';
  ASSERT pg_temp.column_default('"cardTransaction"', 'id') = 'id()',
    'cardTransaction must use the canonical id() default';
  ASSERT pg_temp.column_default('"cardTransactionLine"', 'id') = 'id()',
    'cardTransactionLine must use the canonical id() default';

  ASSERT pg_temp.constraint_columns('"cardTransactionLine"', 'cardTransactionLine_cardTransactionId_fkey')
    = ARRAY['cardTransactionId', 'companyId'],
    'cardTransactionLine parent FK must include companyId';
  ASSERT pg_temp.constraint_columns('"cardTransactionLine"', 'cardTransactionLine_cardTransactionId_fkey', true)
    = ARRAY['id', 'companyId'],
    'cardTransactionLine parent FK must target the composite parent key';
  ASSERT pg_temp.constraint_columns('"cardTransaction"', 'cardTransaction_supplierId_fkey')
    = ARRAY['supplierId', 'companyId'],
    'cardTransaction supplier FK must include companyId';
  ASSERT pg_temp.constraint_columns('"cardTransaction"', 'cardTransaction_supplierId_fkey', true)
    = ARRAY['id', 'companyId'],
    'cardTransaction supplier FK must target the composite supplier key';
  ASSERT pg_temp.constraint_columns('"cardTransactionLine"', 'cardTransactionLine_costCenterId_fkey')
    = ARRAY['costCenterId', 'companyId'],
    'cardTransactionLine cost-center FK must include companyId';
  ASSERT pg_temp.constraint_columns('"cardTransactionLine"', 'cardTransactionLine_costCenterId_fkey', true)
    = ARRAY['id', 'companyId'],
    'cardTransactionLine cost-center FK must target the composite cost-center key';

  ASSERT pg_temp.index_columns('"cardTransactionLine_cardTransactionId_companyId_idx"')
    = ARRAY['cardTransactionId', 'companyId'],
    'cardTransactionLine parent FK needs a matching index';
  ASSERT pg_temp.index_columns('"cardTransactionLine_costCenterId_companyId_idx"')
    = ARRAY['costCenterId', 'companyId'],
    'cardTransactionLine cost-center FK needs a matching index';
  ASSERT pg_temp.index_columns('"cardTransaction_companyId_supplierId_idx"')
    = ARRAY['companyId', 'supplierId'],
    'cardTransaction supplier FK needs a supporting index';
  ASSERT to_regclass('"cardTransaction_cardAccountId_idx"') IS NOT NULL,
    'cardTransaction card-account FK needs an index';
  ASSERT to_regclass('"cardTransaction_offsetAccountId_idx"') IS NOT NULL,
    'cardTransaction offset-account FK needs an index';
  ASSERT to_regclass('"cardTransaction_updatedBy_idx"') IS NOT NULL,
    'cardTransaction updatedBy FK needs an index';
  ASSERT to_regclass('"cardTransactionLine_updatedBy_idx"') IS NOT NULL,
    'cardTransactionLine updatedBy FK needs an index';

  SELECT pg_get_functiondef(t.tgfoid) INTO header_guard
  FROM pg_trigger t
  WHERE t.tgrelid = '"cardTransaction"'::regclass
    AND t.tgname = 'cardTransaction_draft_guard'
    AND NOT t.tgisinternal;
  ASSERT header_guard IS NOT NULL,
    'cardTransaction must have a lifecycle mutation guard';

  SELECT pg_get_functiondef(t.tgfoid) INTO line_guard
  FROM pg_trigger t
  WHERE t.tgrelid = '"cardTransactionLine"'::regclass
    AND t.tgname = 'cardTransactionLine_draft_guard'
    AND NOT t.tgisinternal;
  ASSERT line_guard IS NOT NULL,
    'cardTransactionLine must have a Draft-only mutation guard';
  ASSERT line_guard ~* 'FOR UPDATE',
    'cardTransactionLine guard must lock its parent row';

  ASSERT (
    SELECT count(*) = 3
    FROM pg_trigger
    WHERE tgrelid = '"cardTransaction"'::regclass
      AND tgname IN (
        'trg_event_async_ins_cardTransaction',
        'trg_event_async_upd_cardTransaction',
        'trg_event_async_del_cardTransaction'
      )
      AND NOT tgisinternal
  ), 'cardTransaction event-system triggers must be attached exactly once';

  RAISE NOTICE 'PASS composite keys, tenant FKs, indexes, and trigger wiring';
END;
$schema$;

CREATE TYPE pg_temp.ramp_card_fixture AS (
  group_id text,
  company_id text,
  account_id text,
  supplier_id text,
  cost_center_id text
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

  INSERT INTO "cardTransaction" (
    id, "cardTransactionId", type, status, "cardAccountId",
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
    SELECT count(*) = 2 FROM "cardTransaction" WHERE id = shared_header_id
  ), 'The same generated-style id must be legal in two companies';

  INSERT INTO "cardTransactionLine" (
    id, "cardTransactionId", "companyId", "accountId", amount, "createdBy"
  ) VALUES
    (shared_line_id, shared_header_id, a.company_id, a.account_id, 10, 'system'),
    (shared_line_id, shared_header_id, b.company_id, b.account_id, 10, 'system'),
    (a_line_id, a_header_id, a.company_id, a.account_id, 10, 'system');
  ASSERT (
    SELECT count(*) = 2 FROM "cardTransactionLine" WHERE id = shared_line_id
  ), 'The same line id must be legal in two companies';

  BEGIN
    UPDATE "cardTransaction"
      SET "supplierId" = b.supplier_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-company supplier was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransaction_supplierId_fkey',
      'Expected the composite supplier constraint';
  END;

  BEGIN
    INSERT INTO "cardTransactionLine" (
      "cardTransactionId", "companyId", "accountId", amount, "createdBy"
    ) VALUES (b_header_id, a.company_id, a.account_id, 1, 'system');
    ASSERT false, 'Cross-company card-transaction parent was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransactionLine_cardTransactionId_fkey',
      'Expected the composite parent constraint';
  END;

  BEGIN
    UPDATE "cardTransactionLine"
      SET "costCenterId" = b.cost_center_id
      WHERE id = a_line_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-company cost center was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransactionLine_costCenterId_fkey',
      'Expected the composite cost-center constraint';
  END;

  BEGIN
    UPDATE "cardTransactionLine"
      SET "accountId" = b.account_id
      WHERE id = a_line_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group line account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransactionLine_account_companyGroup_check',
      'Expected the line account company-group guard';
  END;

  BEGIN
    UPDATE "cardTransaction"
      SET "cardAccountId" = b.account_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group card account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransaction_account_companyGroup_check',
      'Expected the company-group account guard';
  END;

  BEGIN
    UPDATE "cardTransaction"
      SET type = 'Payment', "offsetAccountId" = b.account_id
      WHERE id = a_header_id AND "companyId" = a.company_id;
    ASSERT false, 'Cross-group offset account was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'cardTransaction_account_companyGroup_check',
      'Expected the company-group account guard';
  END;

  RAISE NOTICE 'PASS composite keys reject cross-tenant references and account groups';
END;
$integrity$;

DO $lifecycle$
DECLARE
  f pg_temp.ramp_card_fixture;
  header_id text := 'ramp-card-lifecycle-' || id();
  disposable_id text := 'ramp-card-disposable-' || id();
  line_id text := 'ramp-line-lifecycle-' || id();
BEGIN
  f := pg_temp.seed_ramp_card_company('lifecycle');

  BEGIN
    INSERT INTO "cardTransaction" (
      "cardTransactionId", type, status, "cardAccountId",
      "transactionDate", "currencyCode", amount, "companyId", "createdBy"
    ) VALUES (
      'CARD-NONDRAFT-' || id(), 'Charge', 'Posted', f.account_id,
      DATE '2026-09-11', 'USD', 1, f.company_id, 'system'
    );
    ASSERT false, 'A card transaction was created outside Draft';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  INSERT INTO "cardTransaction" (
    id, "cardTransactionId", type, status, "cardAccountId",
    "transactionDate", "currencyCode", amount, "companyId", "createdBy"
  ) VALUES (
    header_id, 'CARD-LIFE-' || id(), 'Charge', 'Draft', f.account_id,
    DATE '2026-09-11', 'USD', 10, f.company_id, 'system'
  );
  INSERT INTO "cardTransactionLine" (
    id, "cardTransactionId", "companyId", "accountId", amount, "createdBy"
  ) VALUES (line_id, header_id, f.company_id, f.account_id, 10, 'system');

  UPDATE "cardTransaction"
    SET memo = 'Draft edit'
    WHERE id = header_id AND "companyId" = f.company_id;
  UPDATE "cardTransactionLine"
    SET description = 'Draft edit'
    WHERE id = line_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "cardTransaction"
      SET status = 'Voided', "voidedAt" = now(), "voidedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Draft-to-Voided transition was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    UPDATE "cardTransaction"
      SET status = 'Posted', memo = 'content changed while posting',
          "postedAt" = now(), "postedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posting transition changed immutable content';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  UPDATE "cardTransaction"
    SET status = 'Posted', "postingDate" = DATE '2026-09-11',
        "postedAt" = now(), "postedBy" = 'system',
        "updatedAt" = now(), "updatedBy" = 'system'
    WHERE id = header_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "cardTransaction" SET memo = 'illegal'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted header content was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE "cardTransaction" SET status = 'Draft'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted header reopened directly';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE "cardTransactionLine" SET amount = 9
      WHERE id = line_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted parent allowed a line update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    INSERT INTO "cardTransactionLine" (
      "cardTransactionId", "companyId", "accountId", amount, "createdBy"
    ) VALUES (header_id, f.company_id, f.account_id, 1, 'system');
    ASSERT false, 'Posted parent allowed a line insert';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM "cardTransactionLine"
      WHERE id = line_id AND "companyId" = f.company_id;
    ASSERT false, 'Posted parent allowed a line delete';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    UPDATE "cardTransaction"
      SET status = 'Voided', memo = 'changed while voiding',
          "voidedAt" = now(), "voidedBy" = 'system'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voiding transition changed immutable content';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  UPDATE "cardTransaction"
    SET status = 'Voided', "voidedAt" = now(), "voidedBy" = 'system',
        "updatedAt" = now(), "updatedBy" = 'system'
    WHERE id = header_id AND "companyId" = f.company_id;

  BEGIN
    UPDATE "cardTransaction" SET memo = 'illegal'
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voided header content was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM "cardTransaction"
      WHERE id = header_id AND "companyId" = f.company_id;
    ASSERT false, 'Voided header was deletable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  INSERT INTO "cardTransaction" (
    id, "cardTransactionId", type, status, "cardAccountId",
    "transactionDate", "currencyCode", amount, "companyId", "createdBy"
  ) VALUES (
    disposable_id, 'CARD-DROP-' || id(), 'Charge', 'Draft', f.account_id,
    DATE '2026-09-11', 'USD', 1, f.company_id, 'system'
  );
  INSERT INTO "cardTransactionLine" (
    "cardTransactionId", "companyId", "accountId", amount, "createdBy"
  ) VALUES (disposable_id, f.company_id, f.account_id, 1, 'system');
  DELETE FROM "cardTransaction"
    WHERE id = disposable_id AND "companyId" = f.company_id;
  ASSERT NOT EXISTS (
    SELECT 1 FROM "cardTransaction"
    WHERE id = disposable_id AND "companyId" = f.company_id
  ), 'Draft header delete must remain legal';

  RAISE NOTICE 'PASS Draft edits, lifecycle transitions, and immutability';
END;
$lifecycle$;

ROLLBACK;
