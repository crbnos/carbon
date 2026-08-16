-- Authoritative redefinition of generateEliminationEntries. Fixes three defects
-- (supersedes 20260816143722):
--
-- 1. companyGroupId write — the function wrote a non-existent journalLine
--    "companyGroupId" column, which failed at elimination time. Dropped.
--
-- 2. Reciprocal double-count — a matched pair has TWO rows (A->B seller, B->A
--    buyer), so the per-ordered-pair loop ran twice and reversed both legs twice.
--    Now iterates each UNORDERED pair once (sourceCompanyId < targetCompanyId) and
--    marks BOTH directions Eliminated.
--
-- 3. Multi-line — the reversal copied the single referenced journal line, so a
--    multi-line IC invoice under-eliminated (only the first line cleared). Now it
--    reverses EVERY journal line in the IC control account for the transaction's
--    document (matched by the referenced line's accountId + documentId + company),
--    which clears the actual GL balance exactly regardless of line count and needs
--    no stored-total arithmetic (no rounding dust). This relies on both edge
--    functions pointing sourceJournalLineId/targetJournalLineId at the IC control
--    line (IC Receivables on the seller, IC Payables on the buyer), not at line 0.

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
  v_journals_by_elim RECORD;
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

  -- Process each matched IC transaction pair ONCE, routing to the correct
  -- elimination entity. Restrict to sourceCompanyId < targetCompanyId so each
  -- unordered pair yields a single representative; the reciprocal (B->A) rows are
  -- picked up below via targetJournalLineId and marked Eliminated together.
  FOR v_rec IN
    SELECT DISTINCT
      ict."sourceCompanyId",
      ict."targetCompanyId"
    FROM "intercompanyTransaction" ict
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" < ict."targetCompanyId"
  LOOP
    -- Find the lowest common parent
    v_lca_id := "findLowestCommonParent"(v_rec."sourceCompanyId", v_rec."targetCompanyId");

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

    -- Get active accounting period for elimination entity
    SELECT "id" INTO v_period_id
    FROM "accountingPeriod"
    WHERE "companyId" = v_elim_id
      AND "status" = 'Active'
    LIMIT 1;

    -- Create elimination journal on this elimination entity
    INSERT INTO "journal" ("description", "accountingPeriodId", "companyId", "postingDate")
    VALUES (
      'IC Elimination: ' || v_rec."sourceCompanyId" || ' ↔ ' || v_rec."targetCompanyId",
      v_period_id,
      v_elim_id,
      CURRENT_DATE
    )
    RETURNING "id" INTO v_journal_id;

    v_journals_created := v_journals_created + 1;

    -- Reverse the seller-side IC control lines. Reverse EVERY line posted to that
    -- control account for the source document (multi-line), identified by the
    -- referenced line's accountId + documentId + company, not just the one line.
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
    INNER JOIN "journalLine" ref ON ref."id" = ict."sourceJournalLineId"
    INNER JOIN "journalLine" jl
      ON jl."documentId" = ref."documentId"
      AND jl."accountId" = ref."accountId"
      AND jl."companyId" = ict."sourceCompanyId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId";

    -- Reverse the buyer-side IC control lines (the reciprocal B->A leg, reached
    -- through targetJournalLineId), same document-scoped multi-line reversal.
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
    INNER JOIN "journalLine" ref ON ref."id" = ict."targetJournalLineId"
    INNER JOIN "journalLine" jl
      ON jl."documentId" = ref."documentId"
      AND jl."accountId" = ref."accountId"
      AND jl."companyId" = ict."targetCompanyId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId"
      AND ict."targetJournalLineId" IS NOT NULL;

    -- Update BOTH directions of this pair to Eliminated
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated',
        "eliminationJournalId" = v_journal_id,
        "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND (
        ("sourceCompanyId" = v_rec."sourceCompanyId" AND "targetCompanyId" = v_rec."targetCompanyId")
        OR ("sourceCompanyId" = v_rec."targetCompanyId" AND "targetCompanyId" = v_rec."sourceCompanyId")
      );

  END LOOP;

  RETURN v_journals_created;
END;
$$;
