-- Intercompany elimination — deterministic assertion harness.
--
-- Proves generateEliminationEntries across every bug class we have hit, WITHOUT
-- any manual UI data entry: it seeds an intercompany trade at the journal +
-- capture-line level (exactly what the posting edge functions write), runs the
-- elimination, and ASSERTS the consolidated result — all inside one transaction
-- that ROLLS BACK, so it touches no real data and re-runs in seconds.
--
-- Run against the local dev DB (reads existing companies/accounts by name/number
-- so it survives resets):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f packages/database/supabase/tests/intercompany-elimination.test.sql
--
-- Any failed ASSERT aborts with the scenario name. "ALL SCENARIOS PASSED" at the
-- end means the elimination engine is correct for: fixed-asset buyer (the
-- negative-Finished-Goods bug), inventory buyer fully held, partial on-hand
-- realization, transaction-dated posting (the out-of-window bug), balanced
-- journals, and regenerate idempotency.

\set ON_ERROR_STOP on
BEGIN;

-- Seed one matched intercompany trade + its capture lines, mirroring the edge
-- functions. Seller books Dr IC-Receivable / Cr Sales / Dr COGS / Cr Finished
-- Goods; buyer books Dr <capitalization> / Cr IC-Payable. Capitalization is
-- posted to Machinery & Equipment (1350) so the assertions are isolated from any
-- existing data (which nets to zero on 1130/2020/4010/5010 and never touches 1350).
CREATE FUNCTION pg_temp.seed_ic_trade(
  p_grp     text,
  p_seller  text,
  p_buyer   text,
  p_user    text,
  p_revenue numeric,
  p_cogs    numeric,
  p_cap_item text,      -- NULL = fixed asset (no on-hand tracking -> fully held)
  p_cap_qty  numeric,
  p_onhand   numeric,   -- desired buyer on-hand of p_cap_item (ignored when NULL)
  p_date     date,
  p_cap_num  text DEFAULT '1350'   -- account the buyer capitalizes into
) RETURNS void AS $fn$
DECLARE
  a_icrec text; a_icpay text; a_sales text; a_cogs text; a_fg text; a_cap text;
  j_s text; j_b text;
  l_icrec text; l_sales text; l_cogs text; l_fg text; l_icpay text; l_cap text;
  t_s text; t_b text;
  ref text := 'harness-' || id();
BEGIN
  SELECT id INTO a_icrec FROM "account" WHERE "companyGroupId"=p_grp AND "number"='1130';
  SELECT id INTO a_icpay FROM "account" WHERE "companyGroupId"=p_grp AND "number"='2020';
  SELECT id INTO a_sales FROM "account" WHERE "companyGroupId"=p_grp AND "number"='4010';
  SELECT id INTO a_cogs  FROM "account" WHERE "companyGroupId"=p_grp AND "number"='5010';
  SELECT id INTO a_fg    FROM "account" WHERE "companyGroupId"=p_grp AND "number"='1220';
  SELECT id INTO a_cap   FROM "account" WHERE "companyGroupId"=p_grp AND "number"=p_cap_num;

  -- Seller sale journal
  INSERT INTO "journal"("companyId","journalEntryId","postingDate","description","sourceType")
    VALUES (p_seller,'HS-'||ref,p_date,'Harness sale','Sales Invoice') RETURNING id INTO j_s;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_s,a_icrec, p_revenue, ref,p_seller,'Invoice','HARNESS-SALE') RETURNING id INTO l_icrec;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_s,a_sales, p_revenue, ref,p_seller,'Invoice','HARNESS-SALE') RETURNING id INTO l_sales;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_s,a_cogs,  p_cogs,    ref,p_seller,'Invoice','HARNESS-SALE') RETURNING id INTO l_cogs;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_s,a_fg,   -p_cogs,    ref,p_seller,'Invoice','HARNESS-SALE') RETURNING id INTO l_fg;

  -- Buyer purchase journal (capitalizes the goods at the transfer price)
  INSERT INTO "journal"("companyId","journalEntryId","postingDate","description","sourceType")
    VALUES (p_buyer,'HB-'||ref,p_date,'Harness purchase','Purchase Invoice') RETURNING id INTO j_b;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_b,a_cap,  p_revenue, ref,p_buyer,'Invoice','HARNESS-PURCH') RETURNING id INTO l_cap;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId")
    VALUES (j_b,a_icpay, p_revenue, ref,p_buyer,'Invoice','HARNESS-PURCH') RETURNING id INTO l_icpay;

  -- Matched intercompany transactions (both directions). targetJournalLineId is
  -- the per-trade seller<->buyer link that matchIntercompanyTransactions sets:
  -- each side points at the other's sourceJournalLineId.
  INSERT INTO "intercompanyTransaction"("companyGroupId","sourceCompanyId","targetCompanyId","sourceJournalLineId","targetJournalLineId","amount","currencyCode","status","documentType","documentId")
    VALUES (p_grp,p_seller,p_buyer,l_icrec,l_icpay,p_revenue,'USD','Matched','Invoice','HARNESS-SALE') RETURNING id INTO t_s;
  INSERT INTO "intercompanyTransaction"("companyGroupId","sourceCompanyId","targetCompanyId","sourceJournalLineId","targetJournalLineId","amount","currencyCode","status","documentType","documentId")
    VALUES (p_grp,p_buyer,p_seller,l_icpay,l_icrec,p_revenue,'USD','Matched','Invoice','HARNESS-PURCH') RETURNING id INTO t_b;

  -- Capture lines (what the edge functions record)
  INSERT INTO "intercompanyEliminationLine"("companyId","intercompanyTransactionId","role","journalLineId","accountId","amount","itemId","quantity","createdBy") VALUES
    (p_seller,t_s,'Control',l_icrec,a_icrec,p_revenue,NULL,NULL,p_user),
    (p_seller,t_s,'Revenue',l_sales,a_sales,p_revenue,NULL,NULL,p_user),
    (p_seller,t_s,'COGS',   l_cogs, a_cogs, p_cogs,   NULL,NULL,p_user),
    (p_buyer, t_b,'Control',l_icpay,a_icpay,p_revenue,NULL,NULL,p_user),
    (p_buyer, t_b,'Capitalization',l_cap,a_cap,p_revenue,p_cap_item,p_cap_qty,p_user);

  -- Buyer on-hand for realization (only when the buyer holds a tracked item).
  -- Set net on-hand to exactly p_onhand regardless of any existing ledger.
  IF p_cap_item IS NOT NULL THEN
    INSERT INTO "itemLedger"("entryType","itemId","companyId","quantity")
      VALUES ('Positive Adjmt.', p_cap_item, p_buyer,
        p_onhand - COALESCE((SELECT SUM("quantity") FROM "itemLedger" WHERE "itemId"=p_cap_item AND "companyId"=p_buyer),0));
  END IF;
END $fn$ LANGUAGE plpgsql;

-- Shared: assert every elimination journal dated p_date balances (debits=credits).
CREATE FUNCTION pg_temp.assert_balanced(p_grp text, p_date date, p_label text) RETURNS void AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT j."id",
      round(sum(CASE WHEN a."class" IN ('Asset','Expense') THEN jl."amount" ELSE -jl."amount" END),5) AS debit_minus_credit
    FROM "journal" j
    JOIN "company" c ON c."id"=j."companyId"
    JOIN "journalLine" jl ON jl."journalId"=j."id"
    JOIN "account" a ON a."id"=jl."accountId"
    WHERE c."companyGroupId"=p_grp AND c."isEliminationEntity" AND j."eliminationKind" IS NOT NULL
      AND j."postingDate"=p_date
    GROUP BY j."id"
  LOOP
    ASSERT r.debit_minus_credit = 0, p_label || ': elimination journal '||r.id||' is unbalanced ('||r.debit_minus_credit||')';
  END LOOP;
END $fn$ LANGUAGE plpgsql;

-- Consolidated (group-wide, incl. elimination entity) net for an account number,
-- optionally as-of a date.
CREATE FUNCTION pg_temp.consol(p_grp text, p_num text, p_asof date DEFAULT NULL) RETURNS numeric AS $fn$
  SELECT round(COALESCE(sum(jl."amount"),0),5)
  FROM "journalLine" jl
  JOIN "journal" j ON j."id"=jl."journalId"
  JOIN "company" c ON c."id"=jl."companyId"
  JOIN "account" a ON a."id"=jl."accountId"
  WHERE c."companyGroupId"=p_grp AND a."number"=p_num
    AND (p_asof IS NULL OR j."postingDate" <= p_asof);
$fn$ LANGUAGE sql;

DO $main$
DECLARE
  v_grp text; v_seller text; v_buyer text; v_user text; v_item text;
  v_parent text; v_elim text; v_ref text;
  d date := DATE '2026-03-15';   -- distinct from any existing data
  n int;
  -- SQLSTATE 22000 is our sentinel to unwind a scenario's data via the block's
  -- implicit savepoint. A real ASSERT failure raises P0004, which is NOT caught
  -- and therefore propagates and aborts the whole run.
BEGIN
  -- Self-provision an isolated intercompany group so the harness does not depend
  -- on any manually-built scenario (a DB reset wipes those). Reuse an existing
  -- company as the BUYER — it already has the group's shared chart of accounts,
  -- items, and an employee — and provision parent/seller/elimination siblings by
  -- copying its row. Everything rolls back with the outer transaction.
  v_ref := id();
  SELECT c."id", c."companyGroupId" INTO v_buyer, v_grp
    FROM "company" c WHERE c."isEliminationEntity" = false
    ORDER BY c."createdAt" LIMIT 1;
  SELECT utc."userId" INTO v_user FROM "userToCompany" utc
    JOIN "company" c ON c."id" = utc."companyId"
    WHERE c."companyGroupId" = v_grp AND utc."role" = 'employee' LIMIT 1;
  SELECT i."id" INTO v_item FROM "item" i WHERE i."companyId" = v_buyer LIMIT 1;

  v_parent := id(); v_seller := id(); v_elim := id();
  CREATE TEMP TABLE _co ON COMMIT DROP AS SELECT * FROM "company" WHERE "id" = v_buyer;
  UPDATE _co SET "id"=v_parent, "name"='Harness Parent '||v_ref, "parentCompanyId"=NULL, "isEliminationEntity"=false;
  INSERT INTO "company" SELECT * FROM _co;
  UPDATE _co SET "id"=v_seller, "name"='Harness Seller '||v_ref, "parentCompanyId"=v_parent;
  INSERT INTO "company" SELECT * FROM _co;
  UPDATE _co SET "id"=v_elim, "name"='Harness Elim '||v_ref, "isEliminationEntity"=true;
  INSERT INTO "company" SELECT * FROM _co;
  UPDATE "company" SET "parentCompanyId"=v_parent WHERE "id"=v_buyer;   -- buyer under the parent

  -- The elimination entity needs its own journalEntry sequence + fiscal settings
  -- (the RPC calls get_next_sequence and get-or-creates a period on it).
  -- sequence.id is a generated column, so copy explicit columns and let it regenerate.
  INSERT INTO "sequence" ("table","name","prefix","suffix","next","size","step","companyId","updatedBy")
  SELECT "table","name","prefix","suffix","next","size","step", v_elim, "updatedBy"
  FROM "sequence" WHERE "table"='journalEntry' AND "companyId"=v_buyer LIMIT 1;
  CREATE TEMP TABLE _fys ON COMMIT DROP AS
    SELECT * FROM "fiscalYearSettings" WHERE "companyId"=v_buyer LIMIT 1;
  UPDATE _fys SET "companyId"=v_elim;
  INSERT INTO "fiscalYearSettings" SELECT * FROM _fys;

  -- Scenario 1: FIXED-ASSET buyer, fully held (the negative-Finished-Goods bug).
  -- revenue 100, cost 60, margin 40; buyer capitalizes a fixed asset (no item).
  -- IC accounts + Sales + COGS eliminate to 0; the buyer's asset lands at group
  -- cost 60 (not overstated at 100, not driven negative).
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, NULL,NULL,NULL, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    ASSERT pg_temp.consol(v_grp,'1130')=0, 'S1 fixed-asset: IC Receivables not eliminated';
    ASSERT pg_temp.consol(v_grp,'2020')=0, 'S1 fixed-asset: IC Payables not eliminated';
    ASSERT pg_temp.consol(v_grp,'4010')=0, 'S1 fixed-asset: Sales not eliminated';
    ASSERT pg_temp.consol(v_grp,'5010')=0, 'S1 fixed-asset: COGS not eliminated';
    ASSERT pg_temp.consol(v_grp,'1350')=60, 'S1 fixed-asset: buyer asset not at group cost (expected 60, got '||pg_temp.consol(v_grp,'1350')||')';
    PERFORM pg_temp.assert_balanced(v_grp,d,'S1 fixed-asset');
    -- eliminationJournalId must point to the pair's IC Balance journal, not the
    -- last IC Revenue journal (loop-order-dependent).
    ASSERT (
      SELECT bool_and(j."eliminationKind" = 'IC Balance')
      FROM "intercompanyTransaction" ict
      JOIN "journal" j ON j."id" = ict."eliminationJournalId"
      WHERE ict."companyGroupId"=v_grp AND ict."status"='Eliminated'
        AND ict."documentId" IN ('HARNESS-SALE','HARNESS-PURCH')
    ), 'S1 fixed-asset: eliminationJournalId does not point to the IC Balance journal';
    RAISE NOTICE 'S1 fixed-asset buyer, fully held ....... PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  -- Scenario 2: INVENTORY buyer, fully held (on-hand >= traded qty -> fraction 1).
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, v_item,5,5, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    ASSERT pg_temp.consol(v_grp,'4010')=0, 'S2 inventory-held: Sales not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'5010')=0, 'S2 inventory-held: COGS not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'1350')=60, 'S2 inventory-held: buyer inventory not at group cost';
    PERFORM pg_temp.assert_balanced(v_grp,d,'S2 inventory-held');
    RAISE NOTICE 'S2 inventory buyer, fully held ......... PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  -- Scenario 3: INVENTORY buyer, PARTIAL realization (on-hand 2 of qty 5 -> 0.4).
  -- margin 40; defer only 40*0.4 = 16. Reversal scales by 0.4: Sales left 60,
  -- COGS left 36, asset = 100 - 16 = 84. Journal still balances.
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, v_item,5,2, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    ASSERT pg_temp.consol(v_grp,'4010')=60, 'S3 partial: Sales expected 60, got '||pg_temp.consol(v_grp,'4010');
    ASSERT pg_temp.consol(v_grp,'5010')=36, 'S3 partial: COGS expected 36, got '||pg_temp.consol(v_grp,'5010');
    ASSERT pg_temp.consol(v_grp,'1350')=84, 'S3 partial: buyer asset expected 84, got '||pg_temp.consol(v_grp,'1350');
    PERFORM pg_temp.assert_balanced(v_grp,d,'S3 partial');
    RAISE NOTICE 'S3 inventory buyer, partial realization  PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  -- Scenario 4: DATE WINDOW (the IC-payables-summing-wrong bug). The elimination
  -- must be dated to the transaction (2026-03-15), not the elimination entity's
  -- today. As-of the transaction date the balance is 0.
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, NULL,NULL,NULL, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    SELECT count(*) INTO n FROM "journal" j JOIN "company" c ON c."id"=j."companyId"
      WHERE c."companyGroupId"=v_grp AND c."isEliminationEntity" AND j."eliminationKind" IS NOT NULL AND j."postingDate"=d;
    ASSERT n >= 1, 'S4 date-window: no elimination journal dated to the transaction ('||d||')';
    ASSERT pg_temp.consol(v_grp,'2020',d)=0, 'S4 date-window: IC Payables not 0 as-of the transaction date';
    ASSERT pg_temp.consol(v_grp,'1130',d)=0, 'S4 date-window: IC Receivables not 0 as-of the transaction date';
    RAISE NOTICE 'S4 elimination dated to transaction .... PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  -- Scenario 5: REGENERATE idempotency. Generate, then regenerate (reverses +
  -- re-derives). The consolidated result must be unchanged — no double counting.
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, NULL,NULL,NULL, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    PERFORM "generateEliminationEntries"(v_grp,v_user, true);   -- regenerate
    ASSERT pg_temp.consol(v_grp,'1130')=0, 'S5 regenerate: IC Receivables drifted';
    ASSERT pg_temp.consol(v_grp,'2020')=0, 'S5 regenerate: IC Payables drifted';
    ASSERT pg_temp.consol(v_grp,'4010')=0, 'S5 regenerate: Sales drifted';
    ASSERT pg_temp.consol(v_grp,'1350')=60, 'S5 regenerate: buyer asset drifted from group cost';
    RAISE NOTICE 'S5 regenerate idempotency ............. PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  -- Scenario 6: MULTI-TRADE per pair with DIFFERENT margins and DIFFERENT
  -- capitalization accounts (the per-trade-allocation fix). Two fixed-asset
  -- trades between the same pair: A (margin 40 -> Machinery 1350) and B (margin
  -- 10 -> Fixed Asset Acquisition Cost 1310). Each asset must land at ITS OWN
  -- group cost (60 and 90). Pair-level aggregation would wrongly give 75 / 75.
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, NULL,NULL,NULL, d, '1350');
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,90, NULL,NULL,NULL, d, '1310');
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    ASSERT pg_temp.consol(v_grp,'4010')=0, 'S6 multi-trade: Sales not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'5010')=0, 'S6 multi-trade: COGS not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'1350')=60, 'S6 multi-trade: trade A asset expected 60 (per-trade), got '||pg_temp.consol(v_grp,'1350');
    ASSERT pg_temp.consol(v_grp,'1310')=90, 'S6 multi-trade: trade B asset expected 90 (per-trade), got '||pg_temp.consol(v_grp,'1310');
    PERFORM pg_temp.assert_balanced(v_grp,d,'S6 multi-trade');
    RAISE NOTICE 'S6 multi-trade, per-trade allocation ... PASS';
    RAISE SQLSTATE '22000';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;

  RAISE NOTICE '================= ALL SCENARIOS PASSED =================';
END $main$;

ROLLBACK;
