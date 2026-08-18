-- Intercompany elimination engine: structured capture, not GL reconstruction.
--
-- The elimination no longer reverse-engineers each intragroup trade from the GL
-- at consolidation time (sweeping journal lines by account class and walking the
-- invoice -> sales order -> shipment document graph). That reconstruction was
-- open-endedly fragile: COGS at shipment, COGS split across accounts, and a buyer
-- capitalizing a FIXED ASSET instead of inventory all broke a heuristic (the last
-- produced negative consolidated Finished Goods).
--
-- Instead, each side of an intragroup trade records role-classified references to
-- the journal lines the elimination will act on WHEN IT POSTS (where the edge
-- function knows each line's role exactly) into "intercompanyEliminationLine".
-- The elimination is then a pure read over those records:
--
--   * journal.eliminationKind — classifies each elimination journal by the layer
--     it removes (SAP posting-level analog): 'IC Balance' (the AR/AP wash) or
--     'IC Revenue' (the intragroup P&L + unrealized-profit writedown).
--
--   * IC Balance: reverse every captured 'Control' line (the reciprocal IC
--     Receivable / IC Payable), netting the intercompany balance to zero.
--
--   * IC Revenue: for each matched pair with an intragroup sale, reverse the
--     seller's captured 'Revenue' and 'COGS' lines and write the BUYER's captured
--     'Capitalization' account (inventory OR fixed asset — whatever the buyer
--     actually debited) down to group cost by the margin M = Revenue - COGS. For a
--     sale at transfer price R, seller group cost C, margin M = R - C:
--         Dr  Sales revenue        R    (reverse the seller's revenue)
--         Cr  Cost of goods sold   C    (reverse the seller's COGS)
--         Cr  Buyer capitalization M    (remove the unrealized margin from the
--                                        asset the buyer holds it in)
--     Balances by construction; net income effect = 0 for goods the group still
--     holds. Writing the BUYER's account (not the seller's inventory relief) is
--     what makes a fixed-asset buyer correct and fixes the negative-FG bug.
--
--   * On-hand realization: the writedown is scaled by the buyer's on-hand fraction
--     of the traded item (fixed assets: fraction 1 until disposed). Revenue and
--     COGS reversal are scaled by the same weighted fraction so the journal stays
--     balanced at any realization level; re-running in a later period after the
--     buyer sells externally reduces the deferred profit proportionally.
--
--   * p_regenerate: reverse existing eliminations (reversing entries, never
--     deletes — the immutability rule) and flip the pair back to Matched, then
--     regenerate from current capture + on-hand. Idempotent re-runs after a fix.
--
-- Tracking spec: .ai/specs/2026-08-17-intercompany-elimination-engine.md

-- 1. Classifiers ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eliminationKind') THEN
    CREATE TYPE "eliminationKind" AS ENUM ('IC Balance', 'IC Revenue');
  END IF;
END $$;

ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "eliminationKind" "eliminationKind";
COMMENT ON COLUMN "journal"."eliminationKind" IS
  'Classifies an elimination journal by the intercompany layer it removes (SAP posting-level analog); NULL for ordinary journals';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intercompanyEliminationRole') THEN
    CREATE TYPE "intercompanyEliminationRole" AS ENUM (
      'Control',        -- IC Receivable / IC Payable (the balance elimination)
      'Revenue',        -- seller intragroup revenue
      'COGS',           -- seller cost of the goods sold
      'Capitalization'  -- the asset the buyer capitalized the profit into (inventory OR fixed asset)
    );
  END IF;
END $$;

-- 2. Widen intercompanyTransaction.amount to bare NUMERIC (numeric-precision
--    convention; grounded gap — was a fixed-precision numeric column).
ALTER TABLE "intercompanyTransaction" ALTER COLUMN "amount" TYPE NUMERIC;

-- 3. Capture table ----------------------------------------------------------
-- Role-classified references to the actual posted journal lines, written by the
-- posting edge functions on the intercompany path. Child of intercompanyTransaction
-- (single-column PK), scoped to the company that POSTED the line (seller or buyer).
CREATE TABLE IF NOT EXISTS "intercompanyEliminationLine" (
  "id" TEXT NOT NULL DEFAULT id('icel'),
  "companyId" TEXT NOT NULL,
  "intercompanyTransactionId" TEXT NOT NULL,
  "role" "intercompanyEliminationRole" NOT NULL,
  "journalLineId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "itemId" TEXT,
  "quantity" NUMERIC,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("intercompanyTransactionId") REFERENCES "intercompanyTransaction"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "intercompanyEliminationLine_companyId_idx"
  ON "intercompanyEliminationLine" ("companyId");
CREATE INDEX IF NOT EXISTS "intercompanyEliminationLine_intercompanyTransactionId_idx"
  ON "intercompanyEliminationLine" ("intercompanyTransactionId");
CREATE INDEX IF NOT EXISTS "intercompanyEliminationLine_createdBy_idx"
  ON "intercompanyEliminationLine" ("createdBy");

ALTER TABLE "public"."intercompanyEliminationLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."intercompanyEliminationLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."intercompanyEliminationLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."intercompanyEliminationLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."intercompanyEliminationLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 4. Elimination engine (capture-driven) ------------------------------------
-- Drop the prior 2-arg version (20260817012947) before recreating: adding the
-- p_regenerate DEFAULT parameter makes CREATE OR REPLACE build a SIBLING rather
-- than replace it, and a 2-arg call would then be ambiguous against the new
-- overload's default. Drop first so exactly one function remains.
DROP FUNCTION IF EXISTS "generateEliminationEntries"(TEXT, TEXT);

CREATE OR REPLACE FUNCTION "generateEliminationEntries" (
  p_company_group_id TEXT,
  p_user_id TEXT,
  p_regenerate BOOLEAN DEFAULT false
)
RETURNS INTEGER
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_cap RECORD;
  v_reg RECORD;
  v_sale RECORD;
  v_buyer_ict TEXT;
  v_lca_id TEXT;
  v_elim_id TEXT;
  v_journal_id TEXT;
  v_balance_journal_id TEXT;
  v_rev_journal_id TEXT;
  v_period_id TEXT;
  v_journals_created INTEGER := 0;
  v_line_count INTEGER;
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
  -- revenue elimination locals
  v_revenue NUMERIC;
  v_cogs NUMERIC;
  v_margin NUMERIC;
  v_cap_total NUMERIC;
  v_cap_realized NUMERIC;
  v_fraction NUMERIC;
  v_onhand NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "userToCompany" utc
    INNER JOIN "company" c ON c."id" = utc."companyId"
    WHERE utc."userId" = p_user_id
      AND utc."role" = 'employee'
      AND c."companyGroupId" = p_company_group_id
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to generate elimination entries';
  END IF;

  -- Serialize per company group: two concurrent runs would both read the same
  -- 'Matched' rows (not locked until the flip at the end) and double-post every
  -- elimination journal. A transaction-scoped advisory lock makes the second
  -- caller wait for the first to commit, after which it finds no Matched rows.
  PERFORM pg_advisory_xact_lock(hashtext(p_company_group_id));

  -- Regenerate: reverse every existing elimination journal on the group's
  -- elimination entities that has not already been reversed (post reversing
  -- entries — never delete, the immutability rule), then flip the pairs back to
  -- Matched so the pass below regenerates them from current capture + on-hand.
  IF p_regenerate THEN
    FOR v_reg IN
      SELECT j."id", j."accountingPeriodId", j."companyId", j."eliminationKind", j."postingDate"
      FROM "journal" j
      INNER JOIN "company" c ON c."id" = j."companyId"
      LEFT JOIN "accountingPeriod" ap ON ap."id" = j."accountingPeriodId"
      WHERE c."companyGroupId" = p_company_group_id
        AND c."isEliminationEntity" = true
        AND j."eliminationKind" IS NOT NULL
        AND j."description" NOT LIKE 'Reversal:%'
        AND (ap."closeStatus" IS NULL OR ap."closeStatus" = 'Open')
        AND NOT EXISTS (
          SELECT 1 FROM "journal" r WHERE r."description" = 'Reversal: ' || j."id"
        )
    LOOP
      -- Reverse into the same period AND date as the original so the two net in
      -- the same reporting window (the regenerated entry re-dates to the current
      -- transactions below).
      INSERT INTO "journal" (
        "description", "accountingPeriodId", "companyId", "postingDate",
        "journalEntryId", "sourceType", "eliminationKind"
      ) VALUES (
        'Reversal: ' || v_reg."id",
        v_reg."accountingPeriodId", v_reg."companyId", v_reg."postingDate",
        get_next_sequence('journalEntry', v_reg."companyId"), 'Manual', v_reg."eliminationKind"
      ) RETURNING "id" INTO v_rev_journal_id;

      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      )
      SELECT v_rev_journal_id, jl."accountId",
        'Reversal: ' || COALESCE(jl."description", ''),
        -jl."amount", jl."documentType", 'ic-elim-rev-' || v_rev_journal_id::text, jl."companyId"
      FROM "journalLine" jl
      WHERE jl."journalId" = v_reg."id";

      v_journals_created := v_journals_created + 1;
    END LOOP;

    UPDATE "intercompanyTransaction"
    SET "status" = 'Matched', "eliminationJournalId" = NULL, "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Eliminated';
  END IF;

  FOR v_rec IN
    SELECT DISTINCT
      LEAST(ict."sourceCompanyId", ict."targetCompanyId") AS "companyA",
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

    -- Date the elimination to the latest posting date among the transactions it
    -- eliminates — NOT the synthetic elimination entity's "today". The
    -- elimination entity has no location, so company_today() falls back to UTC
    -- and can sit a day ahead of the operating companies (or roll into the next
    -- month) at a day boundary. That would post the adjustment outside the
    -- reporting window the transactions fall in, so an as-of balance sheet shows
    -- the intercompany balance un-eliminated even though the drill-down (all
    -- time) nets to zero. Anchor to the transactions' own business date.
    SELECT MAX(j."postingDate") INTO v_today
    FROM "intercompanyEliminationLine" iel
    INNER JOIN "intercompanyTransaction" ict ON ict."id" = iel."intercompanyTransactionId"
    INNER JOIN "journalLine" jl ON jl."id" = iel."journalLineId"
    INNER JOIN "journal" j ON j."id" = jl."journalId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND LEAST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyA"
      AND GREATEST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyB"
      AND iel."role" = 'Control';

    IF v_today IS NULL THEN
      v_today := company_today(v_elim_id);
    END IF;

    SELECT ap."id", ap."status", ap."closeStatus"
    INTO v_period_id, v_period_status, v_close_status
    FROM "accountingPeriod" ap
    WHERE ap."companyId" = v_elim_id
      AND ap."startDate" <= v_today
      AND ap."endDate" >= v_today
    ORDER BY ap."startDate" DESC
    LIMIT 1;

    IF v_period_id IS NOT NULL THEN
      IF v_close_status = 'Closed' THEN
        RAISE EXCEPTION 'The elimination entity''s accounting period is closed. Reopen it before generating eliminations.';
      END IF;
      IF v_close_status = 'Locked' THEN
        RAISE EXCEPTION 'The elimination entity''s accounting period is locked. Unlock it before generating eliminations.';
      END IF;
      IF v_period_status = 'Inactive' THEN
        UPDATE "accountingPeriod" SET "status" = 'Inactive'
        WHERE "companyId" = v_elim_id AND "status" = 'Active';
        UPDATE "accountingPeriod" SET "status" = 'Active' WHERE "id" = v_period_id;
      END IF;
    ELSE
      v_period_start := date_trunc('month', v_today)::date;
      v_period_end := (date_trunc('month', v_today) + INTERVAL '1 month - 1 day')::date;
      SELECT fys."startMonth" INTO v_start_month
      FROM "fiscalYearSettings" fys WHERE fys."companyId" = v_elim_id;
      v_start_month_num := COALESCE(array_position(enum_range(NULL::"month"), v_start_month), 1);
      v_year := EXTRACT(YEAR FROM v_today)::integer;
      v_month := EXTRACT(MONTH FROM v_today)::integer;
      v_period_number := ((v_month - v_start_month_num + 12) % 12) + 1;
      v_fiscal_year := CASE
        WHEN v_start_month_num = 1 THEN v_year
        WHEN v_month >= v_start_month_num THEN v_year + 1
        ELSE v_year END;
      UPDATE "accountingPeriod" SET "status" = 'Inactive'
      WHERE "companyId" = v_elim_id AND "status" = 'Active';
      BEGIN
        INSERT INTO "accountingPeriod" (
          "startDate", "endDate", "companyId", "status", "closeStatus",
          "fiscalYear", "periodNumber", "createdBy"
        ) VALUES (
          v_period_start, v_period_end, v_elim_id, 'Active', 'Open',
          v_fiscal_year, v_period_number, p_user_id
        ) RETURNING "id" INTO v_period_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT ap."id" INTO v_period_id FROM "accountingPeriod" ap
        WHERE ap."companyId" = v_elim_id AND ap."startDate" <= v_today AND ap."endDate" >= v_today
        ORDER BY ap."startDate" DESC LIMIT 1;
      END;
    END IF;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve an accounting period for elimination entity %', v_elim_id;
    END IF;

    -- (a) IC Balance: reverse every captured Control line (the reciprocal IC
    --     Receivable / IC Payable) across both sides of the matched pair.
    INSERT INTO "journal" (
      "description", "accountingPeriodId", "companyId", "postingDate",
      "journalEntryId", "sourceType", "eliminationKind"
    ) VALUES (
      'IC Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
      v_period_id, v_elim_id, v_today,
      get_next_sequence('journalEntry', v_elim_id), 'Manual', 'IC Balance'
    ) RETURNING "id" INTO v_journal_id;
    v_balance_journal_id := v_journal_id;   -- canonical elimination journal for the pair

    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference", "companyId"
    )
    SELECT v_journal_id, iel."accountId",
      'IC Elimination: ' || COALESCE(jl."description", ''),
      -iel."amount", jl."documentType", 'ic-elim-' || v_journal_id::text, v_elim_id
    FROM "intercompanyEliminationLine" iel
    INNER JOIN "intercompanyTransaction" ict ON ict."id" = iel."intercompanyTransactionId"
    INNER JOIN "journalLine" jl ON jl."id" = iel."journalLineId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND LEAST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyA"
      AND GREATEST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyB"
      AND iel."role" = 'Control';

    GET DIAGNOSTICS v_line_count = ROW_COUNT;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'No intercompany control lines to eliminate for pair % / % (capture missing — was the trade posted through the capture path?)',
        v_rec."companyA", v_rec."companyB";
    END IF;

    v_journals_created := v_journals_created + 1;

    -- (b) IC Revenue: eliminate PER TRADE (per matched seller<->buyer document),
    --     not aggregated across the pair — so each buyer capitalization is written
    --     down by ITS OWN trade's margin even when the pair has several trades with
    --     different margins hitting different capitalization accounts. Matching set
    --     each side's targetJournalLineId to the other's sourceJournalLineId, which
    --     is the per-trade link.
    FOR v_sale IN
      SELECT DISTINCT s_ict."id" AS seller_ict, s_ict."targetJournalLineId" AS buyer_link
      FROM "intercompanyTransaction" s_ict
      INNER JOIN "intercompanyEliminationLine" rev
        ON rev."intercompanyTransactionId" = s_ict."id" AND rev."role" = 'Revenue'
      WHERE s_ict."companyGroupId" = p_company_group_id
        AND s_ict."status" = 'Matched'
        AND LEAST(s_ict."sourceCompanyId", s_ict."targetCompanyId") = v_rec."companyA"
        AND GREATEST(s_ict."sourceCompanyId", s_ict."targetCompanyId") = v_rec."companyB"
    LOOP
      -- The matched buyer transaction carries this trade's Capitalization capture.
      v_buyer_ict := NULL;
      IF v_sale.buyer_link IS NOT NULL THEN
        SELECT b."id" INTO v_buyer_ict
        FROM "intercompanyTransaction" b
        WHERE b."companyGroupId" = p_company_group_id
          AND b."sourceJournalLineId" = v_sale.buyer_link
        LIMIT 1;
      END IF;

      SELECT COALESCE(SUM(iel."amount"), 0) INTO v_revenue
      FROM "intercompanyEliminationLine" iel
      WHERE iel."intercompanyTransactionId" = v_sale.seller_ict AND iel."role" = 'Revenue';

      SELECT COALESCE(SUM(iel."amount"), 0) INTO v_cogs
      FROM "intercompanyEliminationLine" iel
      WHERE iel."intercompanyTransactionId" = v_sale.seller_ict AND iel."role" = 'COGS';

      -- Capitalized value + realized-weighted portion still on hand, for THIS
      -- trade's buyer transaction. Fixed-asset / untracked lines count as fully
      -- held (fraction 1); inventory lines use the buyer's current on-hand.
      v_cap_total := 0;
      v_cap_realized := 0;
      IF v_buyer_ict IS NOT NULL THEN
        FOR v_cap IN
          SELECT iel."amount", iel."itemId", iel."quantity", iel."companyId" AS buyer
          FROM "intercompanyEliminationLine" iel
          WHERE iel."intercompanyTransactionId" = v_buyer_ict AND iel."role" = 'Capitalization'
        LOOP
          v_cap_total := v_cap_total + v_cap."amount";
          IF v_cap."itemId" IS NULL OR v_cap."quantity" IS NULL OR v_cap."quantity" <= 0 THEN
            v_cap_realized := v_cap_realized + v_cap."amount";
          ELSE
            SELECT COALESCE(SUM(il."quantity"), 0) INTO v_onhand
            FROM "itemLedger" il
            WHERE il."itemId" = v_cap."itemId" AND il."companyId" = v_cap."buyer";
            v_cap_realized := v_cap_realized
              + v_cap."amount" * (LEAST(GREATEST(v_onhand, 0), v_cap."quantity") / v_cap."quantity");
          END IF;
        END LOOP;
      END IF;

      -- Only eliminate a trade we can fully resolve (positive margin + a captured
      -- buyer capitalization still partly on hand). Otherwise the IC Balance
      -- elimination stands alone; never guess a writedown target.
      CONTINUE WHEN NOT (v_revenue > 0 AND v_cap_total > 0 AND v_cap_realized > 0);

      v_fraction := v_cap_realized / v_cap_total;   -- (0, 1]
      v_margin := v_revenue - v_cogs;

      INSERT INTO "journal" (
        "description", "accountingPeriodId", "companyId", "postingDate",
        "journalEntryId", "sourceType", "eliminationKind"
      ) VALUES (
        'IC Revenue Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
        v_period_id, v_elim_id, v_today,
        get_next_sequence('journalEntry', v_elim_id), 'Manual', 'IC Revenue'
      ) RETURNING "id" INTO v_journal_id;

      -- Reverse this trade's revenue (Dr Revenue), scaled by the on-hand fraction
      -- so the entry balances against a partial writedown.
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      )
      SELECT v_journal_id, iel."accountId",
        'IC Revenue Elimination: ' || COALESCE(jl."description", ''),
        -iel."amount" * v_fraction, jl."documentType", 'ic-rev-' || v_journal_id::text, v_elim_id
      FROM "intercompanyEliminationLine" iel
      INNER JOIN "journalLine" jl ON jl."id" = iel."journalLineId"
      WHERE iel."intercompanyTransactionId" = v_sale.seller_ict AND iel."role" = 'Revenue';

      -- Reverse this trade's COGS (Cr COGS), same scaling.
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      )
      SELECT v_journal_id, iel."accountId",
        'IC Revenue Elimination: reverse COGS',
        -iel."amount" * v_fraction, jl."documentType", 'ic-rev-' || v_journal_id::text, v_elim_id
      FROM "intercompanyEliminationLine" iel
      INNER JOIN "journalLine" jl ON jl."id" = iel."journalLineId"
      WHERE iel."intercompanyTransactionId" = v_sale.seller_ict AND iel."role" = 'COGS';

      -- Write THIS trade's buyer capitalization down by ITS own unrealized margin,
      -- split across the buyer's capitalization lines by captured value x on-hand
      -- (total = margin x weighted fraction, so the journal balances).
      FOR v_cap IN
        SELECT iel."accountId", iel."amount", iel."itemId", iel."quantity", iel."companyId" AS buyer,
               jl."description" AS jl_desc, jl."documentType" AS jl_doctype
        FROM "intercompanyEliminationLine" iel
        INNER JOIN "journalLine" jl ON jl."id" = iel."journalLineId"
        WHERE iel."intercompanyTransactionId" = v_buyer_ict AND iel."role" = 'Capitalization'
      LOOP
        IF v_cap."itemId" IS NULL OR v_cap."quantity" IS NULL OR v_cap."quantity" <= 0 THEN
          v_onhand := NULL;   -- fixed asset / untracked → fraction 1
        ELSE
          SELECT COALESCE(SUM(il."quantity"), 0) INTO v_onhand
          FROM "itemLedger" il
          WHERE il."itemId" = v_cap."itemId" AND il."companyId" = v_cap."buyer";
        END IF;

        INSERT INTO "journalLine" (
          "journalId", "accountId", "description", "amount",
          "documentType", "journalLineReference", "companyId"
        ) VALUES (
          v_journal_id, v_cap."accountId",
          'IC Revenue Elimination: unrealized profit in ' || COALESCE(v_cap."jl_desc", 'buyer capitalization'),
          -(v_margin
            * (v_cap."amount" / v_cap_total)
            * CASE
                WHEN v_onhand IS NULL THEN 1
                ELSE LEAST(GREATEST(v_onhand, 0), v_cap."quantity") / v_cap."quantity"
              END),
          v_cap."jl_doctype", 'ic-rev-' || v_journal_id::text, v_elim_id
        );
      END LOOP;

      v_journals_created := v_journals_created + 1;
    END LOOP;

    -- Retire every matched row of the pair (both directions). Point
    -- eliminationJournalId at the pair's IC Balance journal (the canonical
    -- reversal of the control lines) — NOT the last IC Revenue journal, which
    -- v_journal_id now holds and which is loop-order-dependent.
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated', "eliminationJournalId" = v_balance_journal_id, "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND LEAST("sourceCompanyId", "targetCompanyId") = v_rec."companyA"
      AND GREATEST("sourceCompanyId", "targetCompanyId") = v_rec."companyB";
  END LOOP;

  RETURN v_journals_created;
END;
$$;
