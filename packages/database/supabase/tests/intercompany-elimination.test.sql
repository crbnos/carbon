-- Intercompany elimination against the real capture-driven RPC.
-- Isolated fixture companies/accounts; no existing business data is read or edited.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X
--   -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/intercompany-elimination.test.sql
-- Seeded SQL capture proves elimination, not TypeScript/HTTP posting wiring.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '60s';

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
  j_s text; j_b text; seller_period text; buyer_period text;
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

  SELECT id INTO STRICT seller_period FROM "accountingPeriod" WHERE "companyId"=p_seller AND "startDate"<=p_date AND "endDate">=p_date;
  SELECT id INTO STRICT buyer_period FROM "accountingPeriod" WHERE "companyId"=p_buyer AND "startDate"<=p_date AND "endDate">=p_date;

  -- Original fixture journals are explicitly posted with valid periods/audits.
  -- Seller sale journal
  INSERT INTO "journal"("companyId","journalEntryId","postingDate","description","sourceType","status","accountingPeriodId","createdBy")
    VALUES (p_seller,'HS-'||ref,p_date,'Harness sale','Sales Invoice','Posted',seller_period,p_user) RETURNING id INTO j_s;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_s,a_icrec, p_revenue, ref,p_seller,'Invoice','HARNESS-SALE',p_user) RETURNING id INTO l_icrec;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_s,a_sales, p_revenue, ref,p_seller,'Invoice','HARNESS-SALE',p_user) RETURNING id INTO l_sales;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_s,a_cogs,  p_cogs,    ref,p_seller,'Invoice','HARNESS-SALE',p_user) RETURNING id INTO l_cogs;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_s,a_fg,   -p_cogs,    ref,p_seller,'Invoice','HARNESS-SALE',p_user) RETURNING id INTO l_fg;

  -- Buyer purchase journal (capitalizes the goods at the transfer price)
  INSERT INTO "journal"("companyId","journalEntryId","postingDate","description","sourceType","status","accountingPeriodId","createdBy")
    VALUES (p_buyer,'HB-'||ref,p_date,'Harness purchase','Purchase Invoice','Posted',buyer_period,p_user) RETURNING id INTO j_b;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_b,a_cap,  p_revenue, ref,p_buyer,'Invoice','HARNESS-PURCH',p_user) RETURNING id INTO l_cap;
  INSERT INTO "journalLine"("journalId","accountId","amount","journalLineReference","companyId","documentType","documentId","createdBy")
    VALUES (j_b,a_icpay, p_revenue, ref,p_buyer,'Invoice','HARNESS-PURCH',p_user) RETURNING id INTO l_icpay;

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
  ASSERT NOT EXISTS (
    SELECT 1 FROM journal j JOIN company c ON c.id=j."companyId"
    WHERE c."companyGroupId"=p_grp AND c."isEliminationEntity" AND j."eliminationKind" IS NOT NULL
      AND j."postingDate"=p_date AND j.status<>'Posted'
  ), p_label||': real elimination RPC must create Posted journals';
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
  WHERE c."companyGroupId"=p_grp AND a."number"=p_num AND j.status='Posted'
    AND (p_asof IS NULL OR j."postingDate" <= p_asof);
$fn$ LANGUAGE sql;

-- Multiline capture contract: both controls, both merchandise revenues, both
-- shipping revenues and both costs are retained. External tax is never captured.
CREATE FUNCTION pg_temp.seed_ic_multiline(p_grp text,p_seller text,p_buyer text,p_user text,p_date date)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE seller_j text; buyer_j text; seller_tx text; buyer_tx text; seller_control text; buyer_control text;
  seller_period text; buyer_period text; r record; line_id text; captures jsonb:='[]'; ref text:=id();
BEGIN
  SELECT id INTO STRICT seller_period FROM "accountingPeriod" WHERE "companyId"=p_seller AND "startDate"<=p_date AND "endDate">=p_date;
  SELECT id INTO STRICT buyer_period FROM "accountingPeriod" WHERE "companyId"=p_buyer AND "startDate"<=p_date AND "endDate">=p_date;
  INSERT INTO journal ("companyId","journalEntryId","postingDate","sourceType",status,"accountingPeriodId","createdBy")
    VALUES(p_seller,'HSM-'||ref,p_date,'Sales Invoice','Posted',seller_period,p_user) RETURNING id INTO seller_j;
  INSERT INTO journal ("companyId","journalEntryId","postingDate","sourceType",status,"accountingPeriodId","createdBy")
    VALUES(p_buyer,'HBM-'||ref,p_date,'Purchase Invoice','Posted',buyer_period,p_user) RETURNING id INTO buyer_j;
  FOR r IN SELECT lines.*,a.id AS account_id FROM (VALUES
    (true,'1130',71::numeric,'Control'),(true,'1130',39,'Control'),
    (true,'4010',60,'Revenue'),(true,'4010',30,'Revenue'),
    (true,'4040',4,'Revenue'),(true,'4040',6,'Revenue'),
    (true,'2110',7,NULL),(true,'2110',3,NULL),
    (true,'5010',40,'COGS'),(true,'5010',20,'COGS'),(true,'1220',-60,NULL),
    (false,'2020',71,'Control'),(false,'2020',39,'Control'),
    (false,'1350',64,'Capitalization'),(false,'1350',36,'Capitalization'),
    (false,'1410',7,NULL),(false,'1410',3,NULL)
  ) AS lines(seller,number,amount,role)
  JOIN account a ON a.number=lines.number AND a."companyGroupId"=p_grp LOOP
    INSERT INTO "journalLine" ("journalId","accountId",amount,"journalLineReference","companyId","documentType","documentId","createdBy",description)
      VALUES(CASE WHEN r.seller THEN seller_j ELSE buyer_j END,r.account_id,r.amount,'HML-'||id(),
        CASE WHEN r.seller THEN p_seller ELSE p_buyer END,'Invoice',ref,p_user,COALESCE(r.role,'External component')) RETURNING id INTO line_id;
    IF r.role='Control' THEN
      IF r.seller THEN seller_control:=COALESCE(seller_control,line_id);
      ELSE buyer_control:=COALESCE(buyer_control,line_id); END IF;
    END IF;
    IF r.role IS NOT NULL THEN
      captures:=captures||jsonb_build_array(jsonb_build_object('seller',r.seller,'role',r.role,'line_id',line_id,'account_id',r.account_id,'amount',r.amount));
    END IF;
  END LOOP;
  INSERT INTO "intercompanyTransaction" ("companyGroupId","sourceCompanyId","targetCompanyId","sourceJournalLineId","targetJournalLineId",amount,"currencyCode",status,"documentType","documentId")
    VALUES(p_grp,p_seller,p_buyer,seller_control,buyer_control,110,'USD','Matched','Invoice','HSM-'||ref) RETURNING id INTO seller_tx;
  INSERT INTO "intercompanyTransaction" ("companyGroupId","sourceCompanyId","targetCompanyId","sourceJournalLineId","targetJournalLineId",amount,"currencyCode",status,"documentType","documentId")
    VALUES(p_grp,p_buyer,p_seller,buyer_control,seller_control,110,'USD','Matched','Invoice','HBM-'||ref) RETURNING id INTO buyer_tx;
  INSERT INTO "intercompanyEliminationLine" ("companyId","intercompanyTransactionId",role,"journalLineId","accountId",amount,"createdBy")
    SELECT CASE WHEN c.seller THEN p_seller ELSE p_buyer END,CASE WHEN c.seller THEN seller_tx ELSE buyer_tx END,
      c.role::"intercompanyEliminationRole",c.line_id,c.account_id,c.amount,p_user
    FROM jsonb_to_recordset(captures) AS c(seller boolean,role text,line_id text,account_id text,amount numeric);
  ASSERT (SELECT count(*)=12 AND sum(amount) FILTER(WHERE role='Control')=220 AND sum(amount) FILTER(WHERE role='Revenue')=100
    FROM "intercompanyEliminationLine" WHERE "intercompanyTransactionId" IN (seller_tx,buyer_tx)), 'Complete multiline captures must retain all four control and four revenue rows';
  ASSERT NOT EXISTS (SELECT 1 FROM journal j JOIN "journalLine" l ON l."journalId"=j.id JOIN account a ON a.id=l."accountId"
    WHERE j.id IN (seller_j,buyer_j) GROUP BY j.id HAVING sum(CASE WHEN a.class IN ('Asset','Expense') THEN l.amount ELSE -l.amount END)<>0), 'Multiline original fixture journals must balance';
END;
$fn$;

DO $main$
DECLARE
  v_grp text; v_seller text; v_buyer text; v_user text; v_item text;
  v_parent text; v_elim text; v_ref text; fixture_company text; account_seed record;
  d date := DATE '2026-03-15';   -- distinct from any existing data
  n int;
  -- SQLSTATE P9001 is our sentinel to unwind a scenario's data via the block's
  -- implicit savepoint. A real ASSERT failure raises P0004, which is NOT caught
  -- and therefore propagates and aborts the whole run.
BEGIN
  v_ref := id(); v_user := 'system';
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('IC harness '||v_ref,v_user) RETURNING id INTO v_grp;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('IC harness parent '||v_ref,v_grp,'USD','America/New_York') RETURNING id INTO v_parent;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode","parentCompanyId",timezone)
    VALUES ('IC harness seller '||v_ref,v_grp,'USD',v_parent,'America/New_York') RETURNING id INTO v_seller;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode","parentCompanyId",timezone)
    VALUES ('IC harness buyer '||v_ref,v_grp,'USD',v_parent,'America/New_York') RETURNING id INTO v_buyer;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode","parentCompanyId","isEliminationEntity",timezone)
    VALUES ('IC harness elimination '||v_ref,v_grp,'USD',v_parent,true,'America/New_York') RETURNING id INTO v_elim;
  INSERT INTO "userToCompany" ("userId","companyId",role) VALUES (v_user,v_parent,'employee');
  INSERT INTO currency (code,"companyGroupId","decimalPlaces","createdBy") VALUES ('USD',v_grp,2,v_user);
  FOR account_seed IN SELECT * FROM (VALUES
    ('1130','IC Receivable','Asset','Accounts Receivable','Balance Sheet'),
    ('2020','IC Payable','Liability','Accounts Payable','Balance Sheet'),
    ('4010','Sales','Revenue','Income','Income Statement'),
    ('4040','Shipping Revenue','Revenue','Income','Income Statement'),
    ('5010','COGS','Expense','Cost of Goods Sold','Income Statement'),
    ('1220','Finished Goods','Asset','Inventory','Balance Sheet'),
    ('1350','Machinery','Asset','Fixed Asset','Balance Sheet'),
    ('1310','Acquisition Cost','Asset','Fixed Asset','Balance Sheet'),
    ('2110','External sales tax','Liability','Tax','Balance Sheet'),
    ('1410','External purchase tax','Asset','Other Current Asset','Balance Sheet')
  ) AS accounts(number,name,class,account_type,income_balance) LOOP
    INSERT INTO account (number,name,class,"accountType","incomeBalance","companyGroupId","createdBy")
      VALUES(account_seed.number,account_seed.name,account_seed.class::"glAccountClass",account_seed.account_type::"accountType",account_seed.income_balance::"glIncomeBalance",v_grp,v_user);
  END LOOP;
  FOREACH fixture_company IN ARRAY ARRAY[v_parent,v_seller,v_buyer,v_elim] LOOP
    INSERT INTO "accountingPeriod" ("startDate","endDate",status,"companyId","createdBy","fiscalYear","periodNumber")
      VALUES('2026-01-01','2026-12-31','Active',fixture_company,v_user,2026,1);
  END LOOP;
  INSERT INTO "fiscalYearSettings" ("companyId","updatedBy") VALUES(v_elim,v_user);
  INSERT INTO "sequence" ("table",name,prefix,"companyId","updatedBy")
    VALUES('journalEntry','IC harness journals','HJE-',v_elim,v_user) ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId",name,type,"itemTrackingType","companyId","createdBy")
    VALUES('HI-'||v_ref,'IC harness item','Part','Inventory',v_buyer,v_user) RETURNING id INTO v_item;

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
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

  -- Scenario 2: INVENTORY buyer, fully held (on-hand >= traded qty -> fraction 1).
  BEGIN
    PERFORM pg_temp.seed_ic_trade(v_grp,v_seller,v_buyer,v_user, 100,60, v_item,5,5, d);
    PERFORM "generateEliminationEntries"(v_grp,v_user);
    ASSERT pg_temp.consol(v_grp,'4010')=0, 'S2 inventory-held: Sales not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'5010')=0, 'S2 inventory-held: COGS not fully eliminated';
    ASSERT pg_temp.consol(v_grp,'1350')=60, 'S2 inventory-held: buyer inventory not at group cost';
    PERFORM pg_temp.assert_balanced(v_grp,d,'S2 inventory-held');
    RAISE NOTICE 'S2 inventory buyer, fully held ......... PASS';
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

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
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

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
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

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
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

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
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

  -- Scenario 7: multiple sales/shipping/tax/control rows from one matched trade.
  BEGIN
    PERFORM pg_temp.seed_ic_multiline(v_grp,v_seller,v_buyer,v_user,d);
    ASSERT "generateEliminationEntries"(v_grp,v_user)=2,'S7 multiline: expected one control and one revenue elimination journal';
    ASSERT pg_temp.consol(v_grp,'1130')=0 AND pg_temp.consol(v_grp,'2020')=0,'S7 multiline: every IC control must eliminate';
    ASSERT pg_temp.consol(v_grp,'4010')=0 AND pg_temp.consol(v_grp,'4040')=0,'S7 multiline: every merchandise and shipping revenue row must eliminate';
    ASSERT pg_temp.consol(v_grp,'5010')=0 AND pg_temp.consol(v_grp,'1350')=60 AND pg_temp.consol(v_grp,'1220')=-60,'S7 multiline: buyer capitalization must retain group cost';
    ASSERT pg_temp.consol(v_grp,'2110')=10 AND pg_temp.consol(v_grp,'1410')=10,'S7 multiline: external payable/recoverable tax must remain';
    PERFORM pg_temp.assert_balanced(v_grp,d,'S7 multiline');
    ASSERT NOT EXISTS(SELECT 1 FROM "journalLine" l JOIN journal j ON j.id=l."journalId" JOIN account a ON a.id=l."accountId"
      WHERE j."companyId"=v_elim AND a.number IN ('2110','1410')),'S7 multiline: elimination must not touch external tax';
    PERFORM "generateEliminationEntries"(v_grp,v_user,true);
    ASSERT pg_temp.consol(v_grp,'1130')=0 AND pg_temp.consol(v_grp,'2020')=0 AND pg_temp.consol(v_grp,'4010')=0 AND pg_temp.consol(v_grp,'4040')=0,'S7 multiline: regeneration must preserve all control/revenue elimination';
    ASSERT pg_temp.consol(v_grp,'1350')=60 AND pg_temp.consol(v_grp,'2110')=10 AND pg_temp.consol(v_grp,'1410')=10,'S7 multiline: regeneration must preserve group cost and external tax';
    PERFORM pg_temp.assert_balanced(v_grp,d,'S7 multiline regenerate');
    RAISE NOTICE 'S7 multiline taxed/shipping full captures and regeneration PASS';
    RAISE SQLSTATE 'P9001';
  EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

  RAISE NOTICE '================= ALL SCENARIOS PASSED =================';
END $main$;

ROLLBACK;
