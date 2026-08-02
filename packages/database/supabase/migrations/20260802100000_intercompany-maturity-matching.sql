-- Intercompany Maturity — Phase 1: tolerance matching + FX differences
--
-- Extends the intercompany skeleton from 20260403120000_intercompany-tracking.sql
-- with:
--   (1) per-group matching tolerance (base-currency units) and a mirroring flag
--   (2) document-currency amount + matched-difference tracking on the IC ledger
--   (3) a dedicated Intercompany Differences control account (resolved by id)
--   (4) a three-pass matcher: exact -> FX (document-currency equality) -> tolerance
--   (5) an elimination difference plug that balances the elimination journal by
--       construction (posts the journal residual to the difference account)
--
-- Scope note: document mirroring and the netting workbench (spec workstreams 3-4)
-- are follow-up work; only the columns/flags they share with matching land here.

------------------------------------------------------------------------------
-- 1. Group settings: tolerance + mirroring flag
------------------------------------------------------------------------------

ALTER TABLE "companyGroup"
  ADD COLUMN "intercompanyMatchingTolerance" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN "intercompanyDocumentMirroring" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companyGroup"
  ADD CONSTRAINT "companyGroup_icTolerance_check"
  CHECK ("intercompanyMatchingTolerance" >= 0);

COMMENT ON COLUMN "companyGroup"."intercompanyMatchingTolerance"
  IS 'Max base-currency delta between the two sides of an IC pair that still auto-matches (pass 3). Default 1.00.';

------------------------------------------------------------------------------
-- 2. IC ledger: document-currency amount + matched-difference tracking
------------------------------------------------------------------------------

ALTER TABLE "intercompanyTransaction"
  ADD COLUMN "documentAmount" NUMERIC,       -- document-currency amount ("currencyCode" is the doc currency)
  ADD COLUMN "matchedDifference" NUMERIC,    -- base-currency delta (src.amount - tgt.amount) absorbed at elimination
  ADD COLUMN "differenceKind" TEXT
    CHECK ("differenceKind" IN ('Tolerance', 'FX'));

COMMENT ON COLUMN "intercompanyTransaction"."documentAmount"
  IS 'Document-currency amount; matched on in pass 2 when base amounts differ by FX rate. NULL on legacy rows (skipped by pass 2).';
COMMENT ON COLUMN "intercompanyTransaction"."matchedDifference"
  IS 'Base-currency delta (src.amount - tgt.amount) recorded when a pair matches via pass 2/3; NULL/0 for exact matches.';

------------------------------------------------------------------------------
-- 3. Account defaults: Intercompany Differences control account (by id)
--    (Netting clearing account column lands with the netting workstream.)
------------------------------------------------------------------------------

ALTER TABLE "accountDefault"
  ADD COLUMN "intercompanyDifferenceAccount" TEXT;

ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_intercompanyDifferenceAccount_fkey"
  FOREIGN KEY ("intercompanyDifferenceAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Seed an "Intercompany Differences" expense account (7095) per company group
-- that lacks it, parenting under the "Other Expenses" group header. Group headers
-- carry a NULL number, so resolve the parent by isGroup + name + class, never by
-- number (the 20260702192816 group-header lesson). Mirrors the
-- 20260711155312_supplier-prepayment-account.sql insert-per-group template.
INSERT INTO "account" (
  "number", "name", "isGroup", "accountType", "incomeBalance", "class",
  "consolidatedRate", "parentId", "isSystem", "companyGroupId", "createdBy"
)
SELECT
  '7095',
  'Intercompany Differences',
  false,
  'Other Expense'::"accountType",
  'Income Statement'::"glIncomeBalance",
  'Expense'::"glAccountClass",
  'Average'::"glConsolidatedRate",
  parent."id",
  false,
  cg."id",
  'system'
FROM "companyGroup" cg
JOIN "account" parent
  ON parent."companyGroupId" = cg."id"
  AND parent."isGroup" = true
  AND parent."name" = 'Other Expenses'
  AND parent."class" = 'Expense'
WHERE NOT EXISTS (
  SELECT 1 FROM "account" a
  WHERE a."companyGroupId" = cg."id"
    AND a."number" = '7095'
);

-- Resolve into accountDefault by the seeded number; authoritative by id
-- thereafter. Deliberately left NULLABLE with no fallback: a group with a
-- customized COA lacking this account keeps it unset, and generateEliminationEntries
-- then raises an explicit error rather than absorbing a difference into the wrong
-- account (spec acceptance criterion 3). Companies that don't do intercompany
-- simply never post a nonzero difference and never need it.
UPDATE "accountDefault" ad
SET "intercompanyDifferenceAccount" = a."id"
FROM "account" a
JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId"
  AND a."number" = '7095'
  AND a."isGroup" = false
  AND ad."intercompanyDifferenceAccount" IS NULL;

------------------------------------------------------------------------------
-- 4. Three-pass matcher
--    Return type changes (NUMERIC precision dropped, new columns) require a
--    DROP + CREATE rather than CREATE OR REPLACE.
------------------------------------------------------------------------------

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
  "differenceKind" TEXT,
  "matchedDifference" NUMERIC,
  "matchedWithId" TEXT
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
-- The RETURNS TABLE OUT columns (id, amount, status, ...) share names with real
-- table columns referenced unqualified in the body (e.g. companyGroup."id" in the
-- tolerance fetch, intercompanyTransaction."id" in the greedy pass). Resolve every
-- such ambiguity to the COLUMN, never the OUT variable.
#variable_conflict use_column
DECLARE
  v_tolerance NUMERIC;
  v_pair RECORD;
BEGIN
  -- Check that the user belongs to at least one company in this group
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

  SELECT COALESCE("intercompanyMatchingTolerance", 1)
  INTO v_tolerance
  FROM "companyGroup"
  WHERE "id" = p_company_group_id;

  -- Pass 1 — exact: base amounts equal. Unchanged behavior, difference 0.
  WITH matches AS (
    SELECT src."id" AS "sourceId", tgt."id" AS "targetId"
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

  -- Pass 2 — FX: document-currency amounts agree, base amounts differ. No
  -- tolerance cap (rate variance is legitimate). matchedDifference = src - tgt.
  WITH matches AS (
    SELECT src."id" AS "sourceId", tgt."id" AS "targetId"
    FROM "intercompanyTransaction" src
    INNER JOIN "intercompanyTransaction" tgt
      ON src."sourceCompanyId" = tgt."targetCompanyId"
      AND src."targetCompanyId" = tgt."sourceCompanyId"
      AND src."companyGroupId" = tgt."companyGroupId"
      AND src."currencyCode" = tgt."currencyCode"
      AND src."documentAmount" = tgt."documentAmount"
      AND src."documentAmount" IS NOT NULL
      AND tgt."documentAmount" IS NOT NULL
      AND src."amount" <> tgt."amount"          -- else pass 1 already took it
    WHERE src."companyGroupId" = p_company_group_id
      AND src."status" = 'Unmatched'
      AND tgt."status" = 'Unmatched'
      AND src."sourceJournalLineId" < tgt."sourceJournalLineId"
  )
  UPDATE "intercompanyTransaction" ict
  SET
    "status" = 'Matched',
    "differenceKind" = 'FX',
    "matchedDifference" = (SELECT s."amount" FROM "intercompanyTransaction" s WHERE s."id" = m."sourceId")
                        - (SELECT t."amount" FROM "intercompanyTransaction" t WHERE t."id" = m."targetId"),
    "targetJournalLineId" = CASE
      WHEN ict."id" = m."sourceId" THEN (SELECT t."sourceJournalLineId" FROM "intercompanyTransaction" t WHERE t."id" = m."targetId")
      ELSE (SELECT t."sourceJournalLineId" FROM "intercompanyTransaction" t WHERE t."id" = m."sourceId")
    END,
    "updatedAt" = NOW()
  FROM matches m
  WHERE ict."id" IN (m."sourceId", m."targetId");

  -- Pass 3 — tolerance: same base currency only, greedy closest-first.
  -- Candidate pairs are every unmatched cross-company pair whose base amounts
  -- differ by <= v_tolerance, ordered closest-first (deterministic tiebreak).
  -- A greedy loop claims each pair only when NEITHER side has been matched yet
  -- this run, so a row can never be double-claimed as source of one pair and
  -- target of another when near-amounts chain across three companies (a set-based
  -- two-level DISTINCT ON cannot enforce single-use on both endpoints).
  FOR v_pair IN
    SELECT
      src."id" AS "sourceId",
      tgt."id" AS "targetId",
      src."sourceJournalLineId" AS "sourceJl",
      tgt."sourceJournalLineId" AS "targetJl",
      (src."amount" - tgt."amount") AS "difference"
    FROM "intercompanyTransaction" src
    INNER JOIN "intercompanyTransaction" tgt
      ON src."sourceCompanyId" = tgt."targetCompanyId"
      AND src."targetCompanyId" = tgt."sourceCompanyId"
      AND src."companyGroupId" = tgt."companyGroupId"
    INNER JOIN "company" sc ON sc."id" = src."sourceCompanyId"
    INNER JOIN "company" tc ON tc."id" = src."targetCompanyId"
    WHERE src."companyGroupId" = p_company_group_id
      AND src."status" = 'Unmatched'
      AND tgt."status" = 'Unmatched'
      AND src."sourceJournalLineId" < tgt."sourceJournalLineId"
      AND sc."baseCurrencyCode" = tc."baseCurrencyCode"   -- comparable base amounts
      AND ABS(src."amount" - tgt."amount") <= v_tolerance
    ORDER BY ABS(src."amount" - tgt."amount") ASC, src."id", tgt."id"
  LOOP
    -- Skip if either side was already claimed earlier in this greedy pass.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM "intercompanyTransaction"
      WHERE "id" IN (v_pair."sourceId", v_pair."targetId")
        AND "status" <> 'Unmatched'
    );

    UPDATE "intercompanyTransaction"
    SET "status" = 'Matched',
        "differenceKind" = 'Tolerance',
        "matchedDifference" = v_pair."difference",
        "targetJournalLineId" = v_pair."targetJl",
        "updatedAt" = NOW()
    WHERE "id" = v_pair."sourceId";

    UPDATE "intercompanyTransaction"
    SET "status" = 'Matched',
        "differenceKind" = 'Tolerance',
        "matchedDifference" = v_pair."difference",
        "targetJournalLineId" = v_pair."sourceJl",
        "updatedAt" = NOW()
    WHERE "id" = v_pair."targetId";
  END LOOP;

  -- Return current state
  RETURN QUERY
  SELECT
    ict."id",
    ict."sourceCompanyId",
    ict."targetCompanyId",
    ict."amount",
    ict."status",
    ict."differenceKind",
    ict."matchedDifference",
    ict."targetJournalLineId" AS "matchedWithId"
  FROM "intercompanyTransaction" ict
  WHERE ict."companyGroupId" = p_company_group_id
  ORDER BY ict."createdAt" DESC;
END;
$$;

------------------------------------------------------------------------------
-- 5. Elimination difference plug
--    generateEliminationEntries reverses both matched sides into the elimination
--    entity's journal. When the two sides differ (FX/tolerance) that journal no
--    longer sums to zero. Post the residual to accountDefault.intercompanyDifferenceAccount
--    so the journal balances by construction. Exact matches leave residual 0 and
--    never touch the difference account (backward compatible).
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "generateEliminationEntries" (
  p_company_group_id TEXT,
  p_user_id TEXT
)
RETURNS INTEGER  -- returns count of journals created
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_lca_id TEXT;
  v_elim_id TEXT;
  v_journal_id TEXT;                 -- journal.id is TEXT (id('je')), not the old SERIAL
  v_journal_entry_id TEXT;           -- readable, sequence-assigned; journalEntryId is NOT NULL
  v_period_id TEXT;
  v_journals_created INTEGER := 0;
  v_residual NUMERIC;
  v_diff_account TEXT;
BEGIN
  -- Check that the user belongs to at least one company in this group
  IF NOT EXISTS (
    SELECT 1
    FROM "userToCompany" utc
    INNER JOIN "company" c ON c."id" = utc."companyId"
    WHERE utc."userId" = auth.uid()::text
      AND utc."role" = 'employee'
      AND c."companyGroupId" = p_company_group_id
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to generate elimination entries';
  END IF;

  -- Process each unordered company pair once. matchIntercompanyTransactions marks
  -- BOTH directional rows (A→B and B→A) as 'Matched', and each row already carries
  -- both sides of the pair (sourceJournalLineId + targetJournalLineId). Iterating
  -- over the raw (sourceCompanyId, targetCompanyId) tuples would reverse every
  -- physical journal line twice, in two separate elimination journals — normalize
  -- with LEAST/GREATEST so a pair is eliminated exactly once, then mark both
  -- directional rows Eliminated with the same journal below.
  FOR v_rec IN
    SELECT DISTINCT
      LEAST(ict."sourceCompanyId", ict."targetCompanyId")    AS "companyA",
      GREATEST(ict."sourceCompanyId", ict."targetCompanyId") AS "companyB"
    FROM "intercompanyTransaction" ict
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
  LOOP
    v_lca_id := "findLowestCommonParent"(v_rec."companyA", v_rec."companyB");

    SELECT c."id" INTO v_elim_id
    FROM "company" c
    WHERE c."parentCompanyId" = v_lca_id
      AND c."isEliminationEntity" = true
      AND c."companyGroupId" = p_company_group_id
    LIMIT 1;

    IF v_elim_id IS NULL THEN
      SELECT c."id" INTO v_elim_id
      FROM "company" c
      WHERE c."companyGroupId" = p_company_group_id
        AND c."isEliminationEntity" = true
      LIMIT 1;
    END IF;

    IF v_elim_id IS NULL THEN
      RAISE EXCEPTION 'No elimination entity found for company group %', p_company_group_id;
    END IF;

    -- Resolve the elimination entity's current accounting period. Mirror the
    -- get-or-create idiom the other posting RPCs use (get-accounting-period /
    -- service-job-completion-cogs): "status" = 'Active' is the current-period
    -- pointer, a separate axis from the closeStatus lifecycle. This guarantees a
    -- non-NULL period so the elimination journal is never left unperiodized; a
    -- Closed current period is rejected by the check_accounting_period_open
    -- trigger on INSERT rather than silently posting.
    SELECT "id" INTO v_period_id
    FROM "accountingPeriod"
    WHERE "companyId" = v_elim_id
      AND "startDate" <= CURRENT_DATE
      AND "endDate" >= CURRENT_DATE
      AND "status" = 'Active'
    LIMIT 1;

    IF v_period_id IS NULL THEN
      UPDATE "accountingPeriod"
      SET "status" = 'Inactive'
      WHERE "status" = 'Active' AND "companyId" = v_elim_id;

      UPDATE "accountingPeriod"
      SET "status" = 'Active'
      WHERE "companyId" = v_elim_id
        AND "startDate" <= CURRENT_DATE
        AND "endDate" >= CURRENT_DATE
      RETURNING "id" INTO v_period_id;

      IF v_period_id IS NULL THEN
        INSERT INTO "accountingPeriod" (
          "startDate", "endDate", "companyId", "status", "createdBy"
        ) VALUES (
          date_trunc('month', CURRENT_DATE)::DATE,
          (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
          v_elim_id, 'Active', 'system'
        )
        RETURNING "id" INTO v_period_id;
      END IF;
    END IF;

    -- journalEntryId is NOT NULL with no default — assign the next readable
    -- sequence for the elimination entity (the original RPC omitted it and would
    -- fail the NOT NULL constraint at runtime).
    v_journal_entry_id := get_next_sequence('journalEntry', v_elim_id);

    INSERT INTO "journal" ("journalEntryId", "description", "accountingPeriodId", "companyId", "postingDate")
    VALUES (
      v_journal_entry_id,
      'IC Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
      v_period_id,
      v_elim_id,
      CURRENT_DATE
    )
    RETURNING "id" INTO v_journal_id;

    v_journals_created := v_journals_created + 1;

    -- Reverse the source journal lines.
    -- NB: journalLine has no companyGroupId column (it is company-scoped and
    -- references group-scoped accounts by id) — the original RPC inserted a
    -- phantom "companyGroupId" here and would fail at runtime; dropped.
    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference",
      "companyId"
    )
    SELECT
      v_journal_id,
      jl."accountId",
      'IC Elimination: ' || COALESCE(jl."description", ''),
      -jl."amount",
      jl."documentType",
      'ic-elim-' || ict."id",
      v_elim_id
    FROM "intercompanyTransaction" ict
    INNER JOIN "journalLine" jl ON jl."id" = ict."sourceJournalLineId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."companyA"
      AND ict."targetCompanyId" = v_rec."companyB";

    -- Reverse the matched counterpart lines
    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference",
      "companyId"
    )
    SELECT
      v_journal_id,
      jl."accountId",
      'IC Elimination: ' || COALESCE(jl."description", ''),
      -jl."amount",
      jl."documentType",
      'ic-elim-' || ict."id",
      v_elim_id
    FROM "intercompanyTransaction" ict
    INNER JOIN "journalLine" jl ON jl."id" = ict."targetJournalLineId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."companyA"
      AND ict."targetCompanyId" = v_rec."companyB"
      AND ict."targetJournalLineId" IS NOT NULL;

    -- Difference plug: post the journal residual so it balances by construction.
    -- Covers both FX (pass 2) and tolerance (pass 3) differences; exact matches
    -- leave residual 0 and skip this entirely.
    SELECT COALESCE(SUM("amount"), 0) INTO v_residual
    FROM "journalLine"
    WHERE "journalId" = v_journal_id;

    IF v_residual <> 0 THEN
      SELECT "intercompanyDifferenceAccount" INTO v_diff_account
      FROM "accountDefault"
      WHERE "companyId" = v_elim_id;

      IF v_diff_account IS NULL THEN
        RAISE EXCEPTION 'Elimination entity % has no intercompanyDifferenceAccount configured; cannot post IC difference of %',
          v_elim_id, v_residual;
      END IF;

      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "journalLineReference", "companyId"
      )
      VALUES (
        v_journal_id,
        v_diff_account,
        'IC difference: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
        -v_residual,
        'ic-elim-diff-' || v_journal_id,
        v_elim_id
      );
    END IF;

    -- Mark BOTH directional rows (A→B and B→A) of this pair Eliminated with the
    -- single elimination journal, so neither is reprocessed.
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated',
        "eliminationJournalId" = v_journal_id,
        "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND LEAST("sourceCompanyId", "targetCompanyId") = v_rec."companyA"
      AND GREATEST("sourceCompanyId", "targetCompanyId") = v_rec."companyB";

  END LOOP;

  RETURN v_journals_created;
END;
$$;
