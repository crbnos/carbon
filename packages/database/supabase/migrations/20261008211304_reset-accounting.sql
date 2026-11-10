-- Reset the general ledger of every company and turn accounting off.
--
-- Accounting was switched on in companies that had no opening balance and
-- already held open invoices, receipts and part-finished jobs. A document
-- posted while accounting was off has no journal, and the posting paths that
-- run after it was switched on look for one: a payment against such an
-- invoice refuses with "Target is missing its original control account"
-- (post-payment-transaction.ts). No company relies on the Carbon GL yet, so
-- the ledger is cleared and accounting is switched off until it can be
-- enabled again behind a cutover gate.
--
-- What goes: every journal (and its lines and dimensions), every accounting
-- period (and its close tasks, balance snapshots and sync tie-outs), the
-- intercompany matching built on journal lines, and the provider sync
-- bookkeeping for journals. What stays: every document and its operational
-- status. A posted invoice, payment, memo, charge, reimbursement, receipt or
-- depreciation run stays posted with no journal behind it, which is exactly
-- what a document posted with accounting off already looks like. Item and
-- cost ledgers, the chart of accounts, account defaults and fixed assets are
-- untouched.
--
-- Demo-template companies are left alone, flag included: their story is
-- authored with its journals, and tier 09 of the dataset seed is the only
-- writer of a 'JE-SEED-%' journal entry, which survives both a dataset re-apply
-- and a kept template (a reverted template reloads the pre-template snapshot,
-- which has none). Local dev companies are seeded from the same datasets.
--
-- Nothing is deleted through the guards, so the posted-record immutability,
-- the closed-period lock, the charge/reimbursement draft locks and the event
-- dispatch (sync, webhooks, audit, realtime) are suspended for exactly the
-- tables this touches, and restored to the state they were found in before
-- the block ends. Foreign keys stay enforced throughout: anything this misses
-- fails the migration rather than leaving a dangling reference. It is one DO
-- block, so it commits or rolls back as a whole whether or not the runner
-- wraps the file in a transaction.

DO $$
DECLARE
  t RECORD;
BEGIN
  CREATE TEMP TABLE "_resetCompany" ON COMMIT DROP AS
  SELECT c."id"
  FROM "company" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "journal" j
    WHERE j."companyId" = c."id"
      AND j."journalEntryId" LIKE 'JE-SEED-%'
  );

  -- The tables written here: those deleted from directly, those a delete
  -- cascades into (followed transitively), and every table holding a foreign
  -- key to any of them — its SET NULL, or the explicit nulling below, is a
  -- write that fires that table's triggers too.
  CREATE TEMP TABLE "_resetTable" ON COMMIT DROP AS
  WITH RECURSIVE deleted(oid) AS (
    SELECT unnest(ARRAY[
      '"public"."journal"'::regclass,
      '"public"."accountingPeriod"'::regclass,
      '"public"."intercompanyTransaction"'::regclass,
      '"public"."intercompanyEliminationLine"'::regclass,
      '"public"."externalIntegrationMapping"'::regclass,
      '"public"."accountingSyncOperation"'::regclass
    ])::oid
    UNION
    SELECT con.conrelid
    FROM pg_constraint con
    JOIN deleted d ON con.confrelid = d.oid
    WHERE con.contype = 'f' AND con.confdeltype = 'c'
  )
  SELECT oid FROM deleted
  UNION
  SELECT con.conrelid
  FROM pg_constraint con
  JOIN deleted d ON con.confrelid = d.oid
  WHERE con.contype = 'f';

  -- Every user trigger on those tables, with its current state, so exactly
  -- these are switched back afterwards (internal FK triggers are excluded and
  -- stay on).
  CREATE TEMP TABLE "_resetTrigger" ON COMMIT DROP AS
  SELECT tg.tgrelid::regclass AS "table", tg.tgname AS "name", tg.tgenabled AS "enabled"
  FROM pg_trigger tg
  JOIN "_resetTable" rt ON rt.oid = tg.tgrelid
  WHERE NOT tg.tgisinternal
    AND tg.tgenabled <> 'D';

  FOR t IN SELECT * FROM "_resetTrigger" LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', t."table", t."name");
  END LOOP;

  -- Intercompany matching hangs off journal lines with NOT NULL columns, one
  -- of them with no foreign key. Matched across companies, so it is keyed on
  -- the journal, not on the transaction's own company.
  DELETE FROM "intercompanyEliminationLine" el
  USING "journalLine" jl, "_resetCompany" rc
  WHERE el."journalLineId" = jl."id"
    AND jl."companyId" = rc."id";

  DELETE FROM "intercompanyTransaction" it
  WHERE EXISTS (
    SELECT 1
    FROM "journalLine" jl
    JOIN "_resetCompany" rc ON rc."id" = jl."companyId"
    WHERE jl."id" IN (it."sourceJournalLineId", it."targetJournalLineId")
  )
  OR EXISTS (
    SELECT 1
    FROM "journal" j
    JOIN "_resetCompany" rc ON rc."id" = j."companyId"
    WHERE j."id" = it."eliminationJournalId"
  );

  -- The references that would refuse the delete (RESTRICT / NO ACTION).
  UPDATE "payment" SET "journalId" = NULL
  WHERE "journalId" IS NOT NULL
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  UPDATE "memo" SET "journalId" = NULL
  WHERE "journalId" IS NOT NULL
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  UPDATE "charge" SET "journalId" = NULL
  WHERE "journalId" IS NOT NULL
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  UPDATE "reimbursement" SET "journalId" = NULL
  WHERE "journalId" IS NOT NULL
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  UPDATE "revenueRecognitionSchedule" SET "accountingPeriodId" = NULL
  WHERE "accountingPeriodId" IS NOT NULL
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  -- Lines and their dimensions cascade; every other journal reference
  -- (depreciation, disposals, asset transfers, revenue recognition, rentals,
  -- contracts, reversal links) is ON DELETE SET NULL.
  DELETE FROM "journal"
  WHERE "companyId" IN (SELECT "id" FROM "_resetCompany");

  -- Close tasks, balance snapshots and sync tie-outs cascade.
  DELETE FROM "accountingPeriod"
  WHERE "companyId" IN (SELECT "id" FROM "_resetCompany");

  -- The journals no longer exist; their sync records would only point at
  -- nothing. The pushed entries in the provider are not touched.
  DELETE FROM "externalIntegrationMapping"
  WHERE "entityType" = 'journalEntry'
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  DELETE FROM "accountingSyncOperation"
  WHERE "entityType" = 'journalEntry'
    AND "companyId" IN (SELECT "id" FROM "_resetCompany");

  -- ALTER TABLE refuses a table with pending trigger events; run any
  -- deferred constraint checks now.
  SET CONSTRAINTS ALL IMMEDIATE;

  FOR t IN SELECT * FROM "_resetTrigger" LOOP
    EXECUTE format(
      'ALTER TABLE %s ENABLE %s TRIGGER %I',
      t."table",
      CASE t."enabled" WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,
      t."name"
    );
  END LOOP;

  UPDATE "companySettings" SET "accountingEnabled" = false
  WHERE "accountingEnabled"
    AND "id" IN (SELECT "id" FROM "_resetCompany");

  DROP TABLE "_resetTrigger";
  DROP TABLE "_resetTable";
  DROP TABLE "_resetCompany";
END;
$$;
