-- Extend the intragroup revenue/COGS elimination to sales-order-based sales.
--
-- 20260817122328 swept COGS only on the sales INVOICE document, so it fired only
-- for direct invoices. Real goods sales flow Sales Order -> Shipment -> Invoice
-- and post COGS at SHIPMENT, so the elimination skipped them (v_cogs = 0) and
-- consolidated income kept the intragroup gross profit. This follows the invoice
-- -> salesInvoiceLine.salesOrderId -> shipment.sourceDocumentId link to include
-- the shipment COGS and inventory-relief account. Only the two lookups in the IC
-- Revenue loop change; the rest is identical to 20260817122328.

-- 3. Elimination engine -----------------------------------------------------
CREATE OR REPLACE FUNCTION "generateEliminationEntries" (
  p_company_group_id TEXT,
  p_user_id TEXT
)
RETURNS INTEGER
LANGUAGE "plpgsql"
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_sale RECORD;
  v_lca_id TEXT;
  v_elim_id TEXT;
  v_journal_id TEXT;
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
  v_cogs_account TEXT;
  v_inventory_account TEXT;
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

    -- Get-or-create the elimination entity's accounting period for today.
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

    -- (a) IC Balance: reverse the receivable/payable control lines (unchanged
    --     behavior, now classified).
    INSERT INTO "journal" (
      "description", "accountingPeriodId", "companyId", "postingDate",
      "journalEntryId", "sourceType", "eliminationKind"
    ) VALUES (
      'IC Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
      v_period_id, v_elim_id, v_today,
      get_next_sequence('journalEntry', v_elim_id), 'Manual', 'IC Balance'
    ) RETURNING "id" INTO v_journal_id;

    WITH "controlLines" AS (
      SELECT DISTINCT jl."id", jl."accountId", jl."description", jl."amount", jl."documentType"
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
    SELECT v_journal_id, cl."accountId", 'IC Elimination: ' || COALESCE(cl."description", ''),
      -cl."amount", cl."documentType", 'ic-elim-' || v_journal_id::text, v_elim_id
    FROM "controlLines" cl;

    GET DIAGNOSTICS v_line_count = ROW_COUNT;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'No intercompany control lines to eliminate for pair % / % (missing documentId on a referenced line?)',
        v_rec."companyA", v_rec."companyB";
    END IF;

    v_journals_created := v_journals_created + 1;

    -- (b) IC Revenue: for each intragroup SALES invoice in this pair that posted
    --     a COGS line, reverse revenue + COGS and write the buyer's inventory
    --     down to group cost. Identified by document (documentId + sourceCompany),
    --     never by an IC tag on the revenue/COGS line (they carry none).
    FOR v_sale IN
      SELECT DISTINCT ict."sourceCompanyId" AS seller, ict."documentId" AS document_id
      FROM "intercompanyTransaction" ict
      WHERE ict."companyGroupId" = p_company_group_id
        AND ict."status" = 'Matched'
        AND LEAST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyA"
        AND GREATEST(ict."sourceCompanyId", ict."targetCompanyId") = v_rec."companyB"
        AND ict."documentId" IS NOT NULL
        AND ict."documentType" = 'Invoice'
    LOOP
      -- Seller's COGS account (by id, stable across renames).
      SELECT ad."costOfGoodsSoldAccount" INTO v_cogs_account
      FROM "accountDefault" ad WHERE ad."companyId" = v_sale.seller;

      -- Revenue posted on this sales document (natural-balance positive credit).
      SELECT COALESCE(SUM(jl."amount"), 0) INTO v_revenue
      FROM "journalLine" jl
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE jl."documentId" = v_sale.document_id
        AND jl."companyId" = v_sale.seller
        AND a."class" = 'Revenue';

      -- COGS for this sale. Direct invoices post COGS on the invoice; sales-order
      -- based sales post it at SHIPMENT. Sweep both: the invoice document plus any
      -- shipment whose sourceDocument is a sales order the invoice bills.
      SELECT COALESCE(SUM(jl."amount"), 0) INTO v_cogs
      FROM "journalLine" jl
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE jl."companyId" = v_sale.seller
        AND a."class" = 'Expense'
        AND (
          jl."documentId" = v_sale.document_id
          OR jl."documentId" IN (
            SELECT s."id" FROM "shipment" s
            WHERE s."companyId" = v_sale.seller
              AND s."sourceDocument" = 'Sales Order'
              AND s."sourceDocumentId" IN (
                SELECT DISTINCT sil."salesOrderId" FROM "salesInvoiceLine" sil
                WHERE sil."invoiceId" = v_sale.document_id
                  AND sil."salesOrderId" IS NOT NULL
              )
          )
        );

      -- Inventory account the seller credited when relieving inventory (Asset
      -- credit) — on the invoice OR the linked shipment. Group-shared chart, so
      -- the same account the buyer capitalized to.
      SELECT jl."accountId" INTO v_inventory_account
      FROM "journalLine" jl
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE jl."companyId" = v_sale.seller
        AND a."class" = 'Asset'
        AND jl."amount" < 0
        AND (
          jl."documentId" = v_sale.document_id
          OR jl."documentId" IN (
            SELECT s."id" FROM "shipment" s
            WHERE s."companyId" = v_sale.seller
              AND s."sourceDocument" = 'Sales Order'
              AND s."sourceDocumentId" IN (
                SELECT DISTINCT sil."salesOrderId" FROM "salesInvoiceLine" sil
                WHERE sil."invoiceId" = v_sale.document_id
                  AND sil."salesOrderId" IS NOT NULL
              )
          )
        )
      ORDER BY jl."amount" ASC
      LIMIT 1;

      -- Skip non-inventory sales (fixed assets / services have no COGS line) and
      -- anything we can't fully resolve — the balance-only elimination stands.
      CONTINUE WHEN v_revenue <= 0 OR v_cogs <= 0
        OR v_cogs_account IS NULL OR v_inventory_account IS NULL;

      v_margin := v_revenue - v_cogs;

      INSERT INTO "journal" (
        "description", "accountingPeriodId", "companyId", "postingDate",
        "journalEntryId", "sourceType", "eliminationKind"
      ) VALUES (
        'IC Revenue Elimination: ' || v_rec."companyA" || ' ↔ ' || v_rec."companyB",
        v_period_id, v_elim_id, v_today,
        get_next_sequence('journalEntry', v_elim_id), 'Manual', 'IC Revenue'
      ) RETURNING "id" INTO v_journal_id;

      -- Reverse the seller's revenue lines (Dr Revenue R).
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      )
      SELECT v_journal_id, jl."accountId",
        'IC Revenue Elimination: ' || COALESCE(jl."description", ''),
        -jl."amount", 'Invoice', 'ic-rev-' || v_journal_id::text, v_elim_id
      FROM "journalLine" jl
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE jl."documentId" = v_sale.document_id
        AND jl."companyId" = v_sale.seller
        AND a."class" = 'Revenue';

      -- Reverse every COGS (Expense-class) line on the sale documents. COGS can
      -- split across Direct + labor/overhead absorption + variances, so reverse
      -- them all rather than a single account (else the residual lands in income).
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      )
      SELECT v_journal_id, jl."accountId",
        'IC Revenue Elimination: reverse COGS',
        -jl."amount", 'Invoice', 'ic-rev-' || v_journal_id::text, v_elim_id
      FROM "journalLine" jl
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE jl."companyId" = v_sale.seller
        AND a."class" = 'Expense'
        AND (
          jl."documentId" = v_sale.document_id
          OR jl."documentId" IN (
            SELECT s."id" FROM "shipment" s
            WHERE s."companyId" = v_sale.seller
              AND s."sourceDocument" = 'Sales Order'
              AND s."sourceDocumentId" IN (
                SELECT DISTINCT sil."salesOrderId" FROM "salesInvoiceLine" sil
                WHERE sil."invoiceId" = v_sale.document_id
                  AND sil."salesOrderId" IS NOT NULL
              )
          )
        );

      -- Write the buyer's inventory down to group cost (Cr Inventory M): credit
      -- an asset = negative.
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "documentType", "journalLineReference", "companyId"
      ) VALUES (
        v_journal_id, v_inventory_account,
        'IC Revenue Elimination: unrealized profit in inventory',
        -v_margin, 'Invoice', 'ic-rev-' || v_journal_id::text, v_elim_id
      );

      v_journals_created := v_journals_created + 1;
    END LOOP;

    -- Retire every matched row of the pair (both directions)
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated', "eliminationJournalId" = v_journal_id, "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND LEAST("sourceCompanyId", "targetCompanyId") = v_rec."companyA"
      AND GREATEST("sourceCompanyId", "targetCompanyId") = v_rec."companyB";
  END LOOP;

  RETURN v_journals_created;
END;
$$;
