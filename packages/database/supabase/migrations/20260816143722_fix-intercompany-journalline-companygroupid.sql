-- The intercompany manual-transaction service (createIntercompanyTransaction) and
-- this elimination RPC both wrote a "companyGroupId" value into "journalLine",
-- but "journalLine" has no such column (it lives on "account", never on the ledger
-- line). PostgREST rejected the manual insert ("Failed to create IC Transaction"),
-- and this function would have failed identically at elimination time. Nothing
-- reads journalLine.companyGroupId — every line is already scoped by companyId and
-- the group is derivable via company.companyGroupId — so the fix is to drop the
-- stray writes. This redefinition removes "companyGroupId" from both
-- INSERT INTO "journalLine" statements; everything else is unchanged from
-- 20260403120000_intercompany-tracking.sql.

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

  -- Process each matched IC transaction pair, routing to the correct elimination entity
  -- Group matched transactions by their lowest common parent's elimination entity
  FOR v_rec IN
    SELECT DISTINCT
      ict."sourceCompanyId",
      ict."targetCompanyId"
    FROM "intercompanyTransaction" ict
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
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

    -- Generate reversing entries from source journal lines
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
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId";

    -- Also reverse the matched counterpart entries
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
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId"
      AND ict."targetJournalLineId" IS NOT NULL;

    -- Update these IC transactions to Eliminated
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated',
        "eliminationJournalId" = v_journal_id,
        "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND "sourceCompanyId" = v_rec."sourceCompanyId"
      AND "targetCompanyId" = v_rec."targetCompanyId";

  END LOOP;

  RETURN v_journals_created;
END;
$$;
