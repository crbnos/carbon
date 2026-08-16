-- Hardening pass on the intercompany functions, fixing review findings on
-- 20260816150312 (fix-forward, since that migration is already applied).
--
-- generateEliminationEntries:
--   * Normalize each company pair with LEAST/GREATEST instead of
--     sourceCompanyId < targetCompanyId. Matching updates both reciprocal rows,
--     but nothing enforces that invariant; a lone reverse-direction Matched row
--     was silently excluded and never eliminated. The pair predicate now catches
--     every matched row regardless of direction.
--   * Reverse each matched row's OWN intercompany control line (both legs are
--     covered because both directions are processed), deduplicated by journal
--     line id, instead of also walking targetJournalLineId — that removes the
--     duplicate-reversal risk.
--   * Refuse to post an elimination journal with no active accounting period
--     (nullable journal.accountingPeriodId would otherwise leave it unlinked).
--   * Refuse to mark a pair Eliminated when no control lines were reversed (e.g.
--     a referenced line with a null documentId), rather than recording an empty
--     journal and retiring the transaction.
--
-- matchIntercompanyTransactions:
--   * Also require equal currencyCode, so two same-number amounts in different
--     currencies do not match.

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
  -- Source's receivable against target's payable for the same amount, currency,
  -- and partner.
  WITH matches AS (
    SELECT
      src."id" AS "sourceId",
      tgt."id" AS "targetId"
    FROM "intercompanyTransaction" src
    INNER JOIN "intercompanyTransaction" tgt
      ON src."sourceCompanyId" = tgt."targetCompanyId"
      AND src."targetCompanyId" = tgt."sourceCompanyId"
      AND src."amount" = tgt."amount"
      AND src."currencyCode" = tgt."currencyCode"
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
  v_journal_id INTEGER;
  v_period_id TEXT;
  v_journals_created INTEGER := 0;
  v_line_count INTEGER;
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
    RAISE EXCEPTION 'Insufficient permissions to generate elimination entries';
  END IF;

  -- One elimination journal per UNORDERED company pair. LEAST/GREATEST make the
  -- pair direction-independent, so a matched row in either (or only one)
  -- direction is processed exactly once.
  FOR v_rec IN
    SELECT DISTINCT
      LEAST(ict."sourceCompanyId", ict."targetCompanyId") AS "companyA",
      GREATEST(ict."sourceCompanyId", ict."targetCompanyId") AS "companyB"
    FROM "intercompanyTransaction" ict
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
  LOOP
    -- Find the lowest common parent (symmetric in its arguments)
    v_lca_id := "findLowestCommonParent"(v_rec."companyA", v_rec."companyB");

    -- Find the elimination entity for this LCA
    SELECT c."id" INTO v_elim_id
    FROM "company" c
    WHERE c."parentCompanyId" = v_lca_id
      AND c."isEliminationEntity" = true
      AND c."companyGroupId" = p_company_group_id
    LIMIT 1;

    -- If no elimination entity at the LCA level, fall back to any in the group
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

    -- Get active accounting period for elimination entity; refuse to post an
    -- unlinked journal if there isn't one.
    SELECT "id" INTO v_period_id
    FROM "accountingPeriod"
    WHERE "companyId" = v_elim_id
      AND "status" = 'Active'
    LIMIT 1;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'No active accounting period for elimination entity %', v_elim_id;
    END IF;

    -- Create elimination journal on this elimination entity
    INSERT INTO "journal" ("description", "accountingPeriodId", "companyId", "postingDate")
    VALUES (
      'IC Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
      v_period_id,
      v_elim_id,
      CURRENT_DATE
    )
    RETURNING "id" INTO v_journal_id;

    -- Reverse every intercompany control line for this pair. Each matched row
    -- references its own control line; from that line's account + document we
    -- sweep every line the same invoice posted to that control account (so
    -- multi-line invoices clear in full). DISTINCT dedupes journal line ids so a
    -- line is never reversed twice.
    WITH "controlLines" AS (
      SELECT DISTINCT
        jl."id",
        jl."accountId",
        jl."description",
        jl."amount",
        jl."documentType"
      FROM "intercompanyTransaction" ict
      INNER JOIN "journalLine" ref ON ref."id" = ict."sourceJournalLineId"
      INNER JOIN "journalLine" jl
        ON jl."documentId" = ref."documentId"
        AND jl."accountId" = ref."accountId"
        AND jl."companyId" = ict."sourceCompanyId"
      WHERE ict."companyGroupId" = p_company_group_id
        AND ict."status" = 'Matched'
        AND LEAST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyA"
        AND GREATEST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyB"
        AND ref."documentId" IS NOT NULL
    )
    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference", "companyId"
    )
    SELECT
      v_journal_id,
      cl."accountId",
      'IC Elimination: ' || COALESCE(cl."description", ''),
      -cl."amount",
      cl."documentType",
      'ic-elim-' || v_journal_id::text,
      v_elim_id
    FROM "controlLines" cl;

    GET DIAGNOSTICS v_line_count = ROW_COUNT;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'No intercompany control lines to eliminate for pair % / % (missing documentId on a referenced line?)',
        v_rec."companyA", v_rec."companyB";
    END IF;

    -- Retire every matched row of the pair (both directions)
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated',
        "eliminationJournalId" = v_journal_id,
        "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND LEAST("sourceCompanyId", "targetCompanyId") = v_rec."companyA"
      AND GREATEST("sourceCompanyId", "targetCompanyId") = v_rec."companyB";

    v_journals_created := v_journals_created + 1;
  END LOOP;

  RETURN v_journals_created;
END;
$$;
