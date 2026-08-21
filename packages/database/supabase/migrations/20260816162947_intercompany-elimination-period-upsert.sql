-- Fix-forward on 20260816154722: generateEliminationEntries refused to post when
-- the elimination entity had no Active accounting period, leaving a customer with
-- matched intercompany transactions and no way to eliminate them
-- ("No active accounting period for elimination entity ...").
--
-- Everywhere operational posting happens (receipts, shipments, invoices,
-- payments — see functions/shared/get-accounting-period.ts getCurrentAccountingPeriod)
-- the period is get-or-created, never required to pre-exist. Elimination now does
-- the same for the elimination entity: reuse its Active period, promote an
-- Inactive period covering today, else lazily create an Active period for the
-- current month. A Locked/Closed period is still refused, matching the
-- operational path.
--
-- Also corrects two more latent bugs in the same function, both downstream of
-- the period lookup that raised first so neither was ever reached:
--   1. v_journal_id was declared INTEGER, but journal.id has been TEXT since
--      20260402000000. RETURNING "id" INTO v_journal_id would have raised
--      "invalid input syntax for type integer". v_journal_id is now TEXT.
--   2. The journal insert omitted journalEntryId (NOT NULL, no default). It is
--      now stamped from the entity's 'journalEntry' sequence via
--      get_next_sequence, the same as every other posting path.

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
  -- journal.id is TEXT (id('je'), since 20260402000000_journal-entries.sql), not
  -- the original SERIAL. The prior function declared this INTEGER, so the RETURNING
  -- ... INTO would fail with "invalid input syntax for type integer" — latent
  -- because it sits after the period lookup that raised first.
  v_journal_id TEXT;
  v_period_id TEXT;
  v_journals_created INTEGER := 0;
  v_line_count INTEGER;
  -- period get-or-create locals
  v_today DATE;
  v_period_status "accountingPeriodStatus";
  v_close_status "periodCloseStatus";
  v_period_start DATE;
  v_period_end DATE;
  v_start_month "month";
  v_start_month_num INTEGER;
  v_year INTEGER;
  v_month INTEGER;
  v_period_number INTEGER;
  v_fiscal_year INTEGER;
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

    -- Get-or-create the elimination entity's accounting period for today, the
    -- same way operational posting does (getCurrentAccountingPeriod). "Today" is
    -- the elimination entity's business day.
    v_today := company_today(v_elim_id);

    SELECT ap."id", ap."status", ap."closeStatus"
    INTO v_period_id, v_period_status, v_close_status
    FROM "accountingPeriod" ap
    WHERE ap."companyId" = v_elim_id
      AND ap."startDate" <= v_today
      AND ap."endDate" >= v_today
    ORDER BY ap."startDate" DESC
    LIMIT 1;

    IF v_period_id IS NOT NULL THEN
      -- A Locked/Closed period cannot receive postings — mirror the operational
      -- refusal rather than silently posting into it.
      IF v_close_status = 'Closed' THEN
        RAISE EXCEPTION 'The elimination entity''s accounting period is closed. Reopen it before generating eliminations.';
      END IF;
      IF v_close_status = 'Locked' THEN
        RAISE EXCEPTION 'The elimination entity''s accounting period is locked. Unlock it before generating eliminations.';
      END IF;

      -- Promote an Inactive period covering today to Active (demoting any other).
      IF v_period_status = 'Inactive' THEN
        UPDATE "accountingPeriod"
        SET "status" = 'Inactive'
        WHERE "companyId" = v_elim_id
          AND "status" = 'Active';

        UPDATE "accountingPeriod"
        SET "status" = 'Active'
        WHERE "id" = v_period_id;
      END IF;
    ELSE
      -- No period covers today — lazily create the current month's period as the
      -- new Active period, stamping fiscalYear/periodNumber from the entity's
      -- fiscal start month (defaults to January) so it matches the app-service path.
      v_period_start := date_trunc('month', v_today)::date;
      v_period_end := (date_trunc('month', v_today) + INTERVAL '1 month - 1 day')::date;

      SELECT fys."startMonth" INTO v_start_month
      FROM "fiscalYearSettings" fys
      WHERE fys."companyId" = v_elim_id;

      v_start_month_num := COALESCE(
        array_position(enum_range(NULL::"month"), v_start_month),
        1
      );
      v_year := EXTRACT(YEAR FROM v_today)::integer;
      v_month := EXTRACT(MONTH FROM v_today)::integer;
      v_period_number := ((v_month - v_start_month_num + 12) % 12) + 1;
      v_fiscal_year := CASE
        WHEN v_start_month_num = 1 THEN v_year
        WHEN v_month >= v_start_month_num THEN v_year + 1
        ELSE v_year
      END;

      UPDATE "accountingPeriod"
      SET "status" = 'Inactive'
      WHERE "companyId" = v_elim_id
        AND "status" = 'Active';

      BEGIN
        INSERT INTO "accountingPeriod" (
          "startDate", "endDate", "companyId", "status", "closeStatus",
          "fiscalYear", "periodNumber", "createdBy"
        )
        VALUES (
          v_period_start, v_period_end, v_elim_id, 'Active', 'Open',
          v_fiscal_year, v_period_number, p_user_id
        )
        RETURNING "id" INTO v_period_id;
      EXCEPTION WHEN unique_violation THEN
        -- A concurrent caller created the same period between our lookup and
        -- insert; re-select the winner.
        SELECT ap."id" INTO v_period_id
        FROM "accountingPeriod" ap
        WHERE ap."companyId" = v_elim_id
          AND ap."startDate" <= v_today
          AND ap."endDate" >= v_today
        ORDER BY ap."startDate" DESC
        LIMIT 1;
      END;
    END IF;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve an accounting period for elimination entity %', v_elim_id;
    END IF;

    -- Create elimination journal on this elimination entity. journalEntryId is
    -- NOT NULL with no default; every posting path stamps it from the company's
    -- 'journalEntry' sequence (get_next_sequence), so eliminations do the same —
    -- the prior insert omitted it and would have failed the not-null constraint.
    INSERT INTO "journal" (
      "description", "accountingPeriodId", "companyId", "postingDate",
      "journalEntryId", "sourceType"
    )
    VALUES (
      'IC Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
      v_period_id,
      v_elim_id,
      CURRENT_DATE,
      get_next_sequence('journalEntry', v_elim_id),
      'Manual'
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
