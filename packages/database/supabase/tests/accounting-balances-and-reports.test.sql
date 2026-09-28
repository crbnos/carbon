-- AR/AP balances, source funding and reporting contracts against the real views/RPCs.
-- Run from the repository root via scripts/run-local-accounting-check.ts psql.
-- Every fixture owns its company/group/parties/accounts. No fixture touches real
-- documents; transaction rollback and event suppression cover all scenarios.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '60s';
CREATE TEMP SEQUENCE report_case_count;

CREATE TYPE pg_temp.report_fixture AS (
  group_id text, company_id text, customer_id text, supplier_id text,
  supplier_interaction_id text, ar_account text, ap_account text, bank_account text,
  reason_account text, period_id text
);

CREATE FUNCTION pg_temp.seed_report_company() RETURNS pg_temp.report_fixture
LANGUAGE plpgsql AS $fn$
DECLARE f pg_temp.report_fixture; defaults_json jsonb;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Reporting harness '||id(),'system') RETURNING id INTO f.group_id;
  INSERT INTO "company" (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Reporting harness '||id(),f.group_id,'USD','America/New_York') RETURNING id INTO f.company_id;
  INSERT INTO "currency" (code,"companyGroupId","decimalPlaces","createdBy")
    VALUES ('USD',f.group_id,2,'system'),('EUR',f.group_id,2,'system');
  INSERT INTO "customer" (name,"readableId","companyId") VALUES ('Harness customer','HC-'||id(),f.company_id) RETURNING id INTO f.customer_id;
  INSERT INTO "supplier" (name,"readableId","companyId") VALUES ('Harness supplier','HS-'||id(),f.company_id) RETURNING id INTO f.supplier_id;
  INSERT INTO "supplierInteraction" ("companyId","supplierId") VALUES (f.company_id,f.supplier_id) RETURNING id INTO f.supplier_interaction_id;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Harness AR','Asset','Accounts Receivable','Balance Sheet',f.group_id,'system') RETURNING id INTO f.ar_account;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Harness AP','Liability','Accounts Payable','Balance Sheet',f.group_id,'system') RETURNING id INTO f.ap_account;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Harness bank','Asset','Bank','Balance Sheet',f.group_id,'system') RETURNING id INTO f.bank_account;
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Harness reason','Expense','Expense','Income Statement',f.group_id,'system') RETURNING id INTO f.reason_account;
  SELECT jsonb_object_agg(attname,to_jsonb(f.reason_account)) INTO defaults_json
    FROM pg_attribute WHERE attrelid='"accountDefault"'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull AND attname<>'companyId';
  INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",defaults_json||jsonb_build_object(
    'companyId',f.company_id,'receivablesAccount',f.ar_account,'payablesAccount',f.ap_account,'bankCashAccount',f.bank_account))).*;
  INSERT INTO "accountingPeriod" ("startDate","endDate",status,"companyId","createdBy","fiscalYear","periodNumber")
    VALUES ('2026-01-01','2026-12-31','Active',f.company_id,'system',2026,1) RETURNING id INTO f.period_id;
  RETURN f;
END;
$fn$;

CREATE FUNCTION pg_temp.book_control(f pg_temp.report_fixture,is_ar boolean,amount_base numeric,at_date date,invoice_id text DEFAULT NULL,
  source_type text DEFAULT NULL,source_id text DEFAULT NULL,control_suffix text DEFAULT '')
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE j text;
BEGIN
  INSERT INTO journal ("companyId","journalEntryId","postingDate","accountingPeriodId",status,"sourceType","createdBy")
    VALUES (f.company_id,'HJ-'||id(),at_date,f.period_id,'Draft',COALESCE(source_type,CASE WHEN invoice_id IS NULL THEN 'Payment' WHEN is_ar THEN 'Sales Invoice' ELSE 'Purchase Invoice' END)::"journalEntrySourceType",'system') RETURNING id INTO j;
  INSERT INTO "journalLine" ("journalId","accountId",amount,"journalLineReference","companyId","documentType","documentId",description) VALUES
    (j,CASE WHEN is_ar THEN f.ar_account ELSE f.ap_account END,round(amount_base,5),'control-'||id(),f.company_id,
      CASE WHEN invoice_id IS NOT NULL THEN 'Invoice' WHEN source_type='Payment' THEN 'Payment' WHEN source_type IN ('Credit Memo','Debit Memo') THEN 'Memo' END::"journalLineDocumentType",
      COALESCE(invoice_id,source_id),(CASE WHEN is_ar THEN 'Accounts Receivable' ELSE 'Accounts Payable' END)||control_suffix),
    (j,f.bank_account,round(CASE WHEN is_ar THEN -amount_base ELSE amount_base END,5),'offset-'||id(),f.company_id,NULL,NULL,NULL);
  UPDATE journal SET status='Posted' WHERE id=j AND "companyId"=f.company_id;
  RETURN j;
END;
$fn$;

CREATE FUNCTION pg_temp.replace_control_default(f pg_temp.report_fixture,is_ar boolean)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE new_account text;
BEGIN
  INSERT INTO "account" (name,class,"accountType","incomeBalance","companyGroupId","createdBy")
    VALUES ('Replacement control',CASE WHEN is_ar THEN 'Asset' ELSE 'Liability' END::"glAccountClass",
      CASE WHEN is_ar THEN 'Accounts Receivable' ELSE 'Accounts Payable' END::"accountType",'Balance Sheet',f.group_id,'system') RETURNING id INTO new_account;
  IF is_ar THEN UPDATE "accountDefault" SET "receivablesAccount"=new_account WHERE "companyId"=f.company_id;
  ELSE UPDATE "accountDefault" SET "payablesAccount"=new_account WHERE "companyId"=f.company_id; END IF;
  RETURN new_account;
END;
$fn$;

CREATE FUNCTION pg_temp.seed_invoice(f pg_temp.report_fixture,is_ar boolean,amount_base numeric,rate numeric,
  at_date date DEFAULT '2026-01-01',due_date date DEFAULT '2026-01-31',document_status text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE doc text;
BEGIN
  IF is_ar THEN
    INSERT INTO "salesInvoice" ("invoiceId","customerId","currencyCode","exchangeRate","companyId","createdBy","postingDate","dateIssued","dateDue",status)
      VALUES ('HI-'||id(),f.customer_id,'EUR',rate,f.company_id,'system',at_date,at_date,due_date,COALESCE(document_status,'Submitted')::"salesInvoiceStatus") RETURNING id INTO doc;
    INSERT INTO "salesInvoiceLine" ("invoiceId","invoiceLineType","unitOfMeasureCode","companyId","createdBy",quantity,"unitPrice","exchangeRate")
      VALUES (doc,'Service','EA',f.company_id,'system',1,amount_base,rate);
  ELSE
    INSERT INTO "purchaseInvoice" ("invoiceId","supplierId","supplierInteractionId","currencyCode","exchangeRate","companyId","createdBy","postingDate","dateIssued","dateDue",status)
      VALUES ('HI-'||id(),f.supplier_id,f.supplier_interaction_id,'EUR',rate,f.company_id,'system',at_date,at_date,due_date,COALESCE(document_status,'Open')::"purchaseInvoiceStatus") RETURNING id INTO doc;
    INSERT INTO "purchaseInvoiceLine" ("invoiceId","invoiceLineType","companyId","createdBy",quantity,"supplierUnitPrice","exchangeRate","accountId")
      VALUES (doc,'G/L Account',f.company_id,'system',1,amount_base*rate,rate,f.reason_account);
  END IF;
  RETURN doc;
END;
$fn$;

CREATE FUNCTION pg_temp.seed_payment(f pg_temp.report_fixture,is_ar boolean,amount_document numeric,rate numeric,at_date date,status_text text DEFAULT 'Posted')
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE p text;
BEGIN
  INSERT INTO payment ("paymentId","paymentType","customerId","supplierId","paymentDate","postingDate","currencyCode","exchangeRate","totalAmount","bankAccount","companyId","createdBy",status)
    VALUES ('HP-'||id(),CASE WHEN is_ar THEN 'Receipt' ELSE 'Disbursement' END::"paymentType",CASE WHEN is_ar THEN f.customer_id END,CASE WHEN NOT is_ar THEN f.supplier_id END,at_date,at_date,'EUR',rate,amount_document,f.bank_account,f.company_id,'system',status_text::"paymentStatus") RETURNING id INTO p;
  RETURN p;
END;
$fn$;

-- payment_party_check permits exactly one party and deliberately decouples the
-- direction from it: a Receipt whose party is a SUPPLIER is an AP refund, and a
-- Disbursement whose party is a CUSTOMER is an AR refund. Same paymentType as
-- seed_payment, opposite party -- so this cash belongs to the OTHER subledger.
CREATE FUNCTION pg_temp.seed_crossparty_payment(f pg_temp.report_fixture,is_ar boolean,amount_document numeric,rate numeric,at_date date,status_text text DEFAULT 'Posted')
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE p text;
BEGIN
  INSERT INTO payment ("paymentId","paymentType","customerId","supplierId","paymentDate","postingDate","currencyCode","exchangeRate","totalAmount","bankAccount","companyId","createdBy",status)
    VALUES ('HX-'||id(),CASE WHEN is_ar THEN 'Receipt' ELSE 'Disbursement' END::"paymentType",CASE WHEN NOT is_ar THEN f.customer_id END,CASE WHEN is_ar THEN f.supplier_id END,at_date,at_date,'EUR',rate,amount_document,f.bank_account,f.company_id,'system',status_text::"paymentStatus") RETURNING id INTO p;
  RETURN p;
END;
$fn$;

CREATE FUNCTION pg_temp.seed_memo(f pg_temp.report_fixture,is_ar boolean,amount_document numeric,rate numeric,at_date date,credit_to_invoice boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE m text;
BEGIN
  INSERT INTO memo ("memoId",direction,"customerId","supplierId","memoDate","postingDate","currencyCode","exchangeRate",amount,"reasonAccount","companyId","createdBy",status)
    VALUES ('HM-'||id(),CASE WHEN is_ar=credit_to_invoice THEN 'Credit' ELSE 'Debit' END::"memoDirection",CASE WHEN is_ar THEN f.customer_id END,CASE WHEN NOT is_ar THEN f.supplier_id END,at_date,at_date,'EUR',rate,amount_document,f.reason_account,f.company_id,'system','Posted') RETURNING id INTO m;
  RETURN m;
END;
$fn$;

CREATE FUNCTION pg_temp.apply_cash(f pg_temp.report_fixture,is_ar boolean,payment_id text,invoice_id text,amount_document numeric,applied_base numeric,source_rate numeric,target_rate numeric,at_date date,source_id text DEFAULT NULL,discount_base numeric DEFAULT 0,writeoff_base numeric DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE s text;
BEGIN
  INSERT INTO "invoiceSettlement" ("paymentId","sourcePaymentId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","discountAmount","writeOffAmount","appliedDate","companyId","createdBy")
    VALUES (payment_id,source_id,CASE WHEN is_ar THEN invoice_id END,CASE WHEN NOT is_ar THEN invoice_id END,amount_document,applied_base,source_rate,target_rate,
      round(CASE WHEN is_ar THEN amount_document/source_rate-applied_base ELSE applied_base-amount_document/source_rate END,5),discount_base,writeoff_base,at_date,f.company_id,'system') RETURNING id INTO s;
  RETURN s;
END;
$fn$;

CREATE FUNCTION pg_temp.assert_reports(f pg_temp.report_fixture,is_ar boolean,at_date date,expected_items numeric,expected_unapplied numeric,expected_gl numeric,label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE open_sum numeric; aging_sum numeric; gl_row record; detail_rows jsonb; tolerance constant numeric := .00001;
BEGIN
  IF is_ar THEN
    SELECT COALESCE(sum("openInBase"),0) INTO open_sum FROM get_ar_open_by_customer(f.company_id,at_date);
    SELECT COALESCE(sum(total),0) INTO aging_sum FROM get_ar_aging(f.company_id,at_date);
    SELECT * INTO STRICT gl_row FROM get_ar_tie_out(f.company_id,at_date);
  ELSE
    SELECT COALESCE(sum("openInBase"),0) INTO open_sum FROM get_ap_open_by_supplier(f.company_id,at_date);
    SELECT COALESCE(sum(total),0) INTO aging_sum FROM get_ap_aging(f.company_id,at_date);
    SELECT * INTO STRICT gl_row FROM get_ap_tie_out(f.company_id,at_date);
  END IF;
  ASSERT abs(open_sum-expected_items)<tolerance, label||': open items '||open_sum||' expected '||expected_items;
  ASSERT abs(aging_sum-(expected_items+expected_unapplied))<tolerance,label||': aging total '||aging_sum;
  ASSERT abs(gl_row."subledgerBalance"-(expected_items+expected_unapplied))<tolerance,label||': subledger '||gl_row."subledgerBalance";
  ASSERT abs(gl_row."glBalance"-expected_gl)<tolerance,label||': control GL '||gl_row."glBalance";
  ASSERT abs(gl_row.variance)<tolerance,label||': tie-out variance '||gl_row.variance;
  PERFORM nextval('pg_temp.report_case_count');
  RAISE NOTICE 'PASS % %',CASE WHEN is_ar THEN 'AR' ELSE 'AP' END,label;
END;
$fn$;

CREATE FUNCTION pg_temp.assert_invoice(f pg_temp.report_fixture,is_ar boolean,doc text,expected_document numeric,expected_status text,label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE row_value record;
BEGIN
  IF is_ar THEN SELECT status,balance,"exchangeRate" INTO STRICT row_value FROM "salesInvoices" WHERE id=doc AND "companyId"=f.company_id;
  ELSE SELECT status,balance,"exchangeRate" INTO STRICT row_value FROM "purchaseInvoices" WHERE id=doc AND "companyId"=f.company_id; END IF;
  ASSERT row_value.balance*row_value."exchangeRate"=expected_document,label||': document remainder '||(row_value.balance*row_value."exchangeRate");
  ASSERT row_value.status=expected_status,label||': status '||row_value.status;
END;
$fn$;

-- Refund cash belongs to its party's subledger, with the opposite cash sign.
-- Its target memo uses exact document principal independently of carrying base.
DO $refund_cases$
DECLARE f pg_temp.report_fixture; is_ar boolean; m text; p text; application text; j text; actual numeric; phase text;
BEGIN
  FOREACH is_ar IN ARRAY ARRAY[true,false] LOOP
    BEGIN
      f:=pg_temp.seed_report_company();
      p:=pg_temp.seed_crossparty_payment(f,NOT is_ar,55,1.1,'2026-02-01');
      PERFORM pg_temp.book_control(f,is_ar,50,'2026-02-01',NULL,'Payment',p);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-01',0,50,50,'unallocated refund');
      PERFORM pg_temp.assert_reports(f,NOT is_ar,'2026-02-01',0,0,0,'refund excluded from other party subledger');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-31',0,0,0,'future refund excluded');
      UPDATE payment SET status='Voided' WHERE id=p AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,-50,'2026-02-02',NULL,'Payment',p);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-02',0,0,0,'voided unallocated refund');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      m:=pg_temp.seed_memo(f,is_ar,55.01,1.1,'2026-02-01');
      PERFORM pg_temp.book_control(f,is_ar,-50.00909,'2026-02-01',NULL,CASE WHEN is_ar THEN 'Credit Memo' ELSE 'Debit Memo' END,m);
      p:=pg_temp.seed_crossparty_payment(f,NOT is_ar,55.01,1.25,'2026-02-02','Draft');
      INSERT INTO "invoiceSettlement" ("paymentId","targetMemoId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","appliedDate","companyId","createdBy")
        VALUES (p,m,27.50,25,1.25,1.1,CASE WHEN is_ar THEN 3 ELSE -3 END,'2026-02-02',f.company_id,'system') RETURNING id INTO application;
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-02',-50.00909,0,-50.00909,'draft memo refund excluded');
      UPDATE payment SET status='Posted' WHERE id=p AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,25,'2026-02-02',NULL,'Payment',p);
      -- Only 27.50/1.25=22 of cash is applied; the remaining 22.008 is an unallocated refund.
      PERFORM pg_temp.book_control(f,is_ar,22.008,'2026-02-02',NULL,'Payment',p,' (on-account credit)');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-02',-25.00909,22.008,-3.00109,'partial FX memo refund');
      IF is_ar THEN SELECT "openInCurrency" INTO actual FROM get_ar_open_by_customer(f.company_id,'2026-02-02') WHERE "documentId"=m;
      ELSE SELECT "openInCurrency" INTO actual FROM get_ap_open_by_supplier(f.company_id,'2026-02-02') WHERE "documentId"=m; END IF;
      ASSERT actual=-27.51,'Partial refund must preserve exact memo principal';
      UPDATE "invoiceSettlement" SET "sourceAmount"=55.01,"appliedAmount"=50.00909,
        "fxGainLossAmount"=CASE WHEN is_ar THEN 6.00109 ELSE -6.00109 END WHERE id=application AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,3.00109,'2026-02-03',NULL,'Payment',p);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-03',0,0,0,'full FX memo refund');
      IF is_ar THEN SELECT count(*) INTO actual FROM get_ar_open_by_customer(f.company_id,'2026-02-03') WHERE "documentId"=m;
      ELSE SELECT count(*) INTO actual FROM get_ap_open_by_supplier(f.company_id,'2026-02-03') WHERE "documentId"=m; END IF;
      ASSERT actual=0,'Fully refunded memo must have no reconstructed fractional principal';
      UPDATE "invoiceSettlement" SET "sourceAmount"=NULL,"appliedAmount"=25 WHERE id=application AND "companyId"=f.company_id;
      IF is_ar THEN SELECT count(*) INTO actual FROM get_ar_open_by_customer(f.company_id,'2026-02-03') WHERE "documentId"=m;
      ELSE SELECT count(*) INTO actual FROM get_ap_open_by_supplier(f.company_id,'2026-02-03') WHERE "documentId"=m; END IF;
      ASSERT actual=0,'Unknown target memo principal must fail closed';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
  END LOOP;
END;
$refund_cases$;

DO $cases$
DECLARE f pg_temp.report_fixture; other_fixture pg_temp.report_fixture; is_ar boolean; doc text; p1 text; p2 text; m text; s text; row_value record; open_sum numeric; n integer; excluded_status text; new_account text;
BEGIN
  FOREACH is_ar IN ARRAY ARRAY[true,false] LOOP
    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,1.25);
      m:=pg_temp.seed_memo(f,is_ar,55,1.25,'2026-01-02');
      INSERT INTO "invoiceSettlement" ("memoId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","appliedDate","companyId","createdBy")
        VALUES(m,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,NULL,20,1.25,1.25,'2026-01-03',f.company_id,'system');
      IF is_ar THEN SELECT count(*) INTO n FROM get_ar_open_by_customer(f.company_id,'2026-01-03') WHERE "documentId"=m;
      ELSE SELECT count(*) INTO n FROM get_ap_open_by_supplier(f.company_id,'2026-01-03') WHERE "documentId"=m; END IF;
      ASSERT n=0,'Memo with unknown consumed principal must not present a fabricated open balance';
      -- Before that application takes effect the original memo remains valid.
      IF is_ar THEN SELECT count(*) INTO n FROM get_ar_open_by_customer(f.company_id,'2026-01-02') WHERE "documentId"=m;
      ELSE SELECT count(*) INTO n FROM get_ap_open_by_supplier(f.company_id,'2026-01-02') WHERE "documentId"=m; END IF;
      ASSERT n=1,'Future invalid application must not hide the historical memo';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,90,1);
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01',doc);
      PERFORM pg_temp.book_control(f,is_ar,-10,'2026-01-01',doc);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',90,0,90,'signed original controls retain net carrying');
      p1:=pg_temp.seed_payment(f,is_ar,90,1,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,90,90,1,1,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-90,'2026-01-02',NULL,'Payment',p1);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'mixed-sign invoice fully clears without FX');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    -- Each subtransaction unwinds fixture state. SQLSTATE P9001 is our explicit
    -- successful cleanup; ASSERT uses P0004 and is never caught as success.
    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8);
      -- Multiple original rows must discover the old account only once.
      PERFORM pg_temp.book_control(f,is_ar,60,'2026-01-01',doc);
      PERFORM pg_temp.book_control(f,is_ar,40,'2026-01-01',doc);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100,0,100,'current and historical account overlap counts once');
      new_account:=pg_temp.replace_control_default(f,is_ar);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100,0,100,'changed default retains original invoice control');
      p1:=pg_temp.seed_payment(f,is_ar,80,.8,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,80,100,.8,.8,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-02',NULL,'Payment',p1);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'historical control relief clears after default change');
      -- Misleading descriptions in an unrelated journal cannot discover an
      -- account; neither may a supported posting belonging to another company.
      other_fixture:=f;
      IF is_ar THEN other_fixture.ar_account:=f.reason_account;
      ELSE other_fixture.ap_account:=f.reason_account; END IF;
      PERFORM pg_temp.book_control(other_fixture,is_ar,7,'2026-01-01',NULL,'Manual');
      other_fixture:=pg_temp.seed_report_company();
      p2:=pg_temp.seed_payment(other_fixture,is_ar,80,.8,'2026-01-01');
      IF is_ar THEN other_fixture.ar_account:=f.reason_account;
      ELSE other_fixture.ap_account:=f.reason_account; END IF;
      PERFORM pg_temp.book_control(other_fixture,is_ar,-100,'2026-01-01',NULL,'Payment',p2,' (on-account credit)');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'historical control discovery excludes unrelated journals and companies');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      p1:=pg_temp.seed_payment(f,is_ar,80,.8,'2026-01-01');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-01',NULL,'Payment',p1,' (on-account credit)');
      new_account:=pg_temp.replace_control_default(f,is_ar);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',0,-100,-100,'changed default retains original unapplied payment control');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      m:=pg_temp.seed_memo(f,is_ar,80,.8,'2026-01-01');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-01',NULL,CASE WHEN is_ar THEN 'Credit Memo' ELSE 'Debit Memo' END,m);
      new_account:=pg_temp.replace_control_default(f,is_ar);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',-100,0,-100,'changed default retains original memo control');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,1.25,'2026-01-01','2026-01-01');
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01',doc);
      m:=pg_temp.seed_memo(f,is_ar,55,1.25,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-44,'2026-01-02',NULL,CASE WHEN is_ar THEN 'Credit Memo' ELSE 'Debit Memo' END,m);
      INSERT INTO "invoiceSettlement" ("memoId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","appliedDate","companyId","createdBy")
        VALUES(m,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,55,44,1.25,1.25,0,'2026-02-05',f.company_id,'system');
      -- Aggregate open balances remain56 on both dates, so inspect both
      -- documents and different aging buckets to prove the application cutoff.
      IF is_ar THEN SELECT "openInBase" INTO STRICT row_value FROM get_ar_open_by_customer(f.company_id,'2026-02-01') WHERE "documentId"=doc;
      ELSE SELECT "openInBase" INTO STRICT row_value FROM get_ap_open_by_supplier(f.company_id,'2026-02-01') WHERE "documentId"=doc; END IF;
      ASSERT row_value."openInBase"=100,'Future direct memo application reduced the historical invoice';
      IF is_ar THEN SELECT "openInBase" INTO STRICT row_value FROM get_ar_open_by_customer(f.company_id,'2026-02-01') WHERE "documentId"=m;
      ELSE SELECT "openInBase" INTO STRICT row_value FROM get_ap_open_by_supplier(f.company_id,'2026-02-01') WHERE "documentId"=m; END IF;
      ASSERT row_value."openInBase"=-44,'Future direct memo application consumed the historical memo';
      IF is_ar THEN SELECT * INTO STRICT row_value FROM get_ar_aging(f.company_id,'2026-02-01');
      ELSE SELECT * INTO STRICT row_value FROM get_ap_aging(f.company_id,'2026-02-01'); END IF;
      ASSERT row_value.bucket1=-44 AND row_value.bucket2=100,'Future direct memo application changed historical aging buckets';
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-01',56,0,56,'direct memo application excluded before appliedDate');
      IF is_ar THEN SELECT "openInBase" INTO STRICT row_value FROM get_ar_open_by_customer(f.company_id,'2026-02-05') WHERE "documentId"=doc;
        SELECT count(*) INTO n FROM get_ar_open_by_customer(f.company_id,'2026-02-05') WHERE "documentId"=m;
      ELSE SELECT "openInBase" INTO STRICT row_value FROM get_ap_open_by_supplier(f.company_id,'2026-02-05') WHERE "documentId"=doc;
        SELECT count(*) INTO n FROM get_ap_open_by_supplier(f.company_id,'2026-02-05') WHERE "documentId"=m; END IF;
      ASSERT row_value."openInBase"=56 AND n=0,'Direct memo application must become effective on appliedDate';
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-02-05',56,0,56,'direct memo application included on appliedDate');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8);
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100,0,100,'unpaid base100/document80');
      p1:=pg_temp.seed_payment(f,is_ar,40,.8,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,40,50,.8,.8,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-50,'2026-01-02');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,40,'Partially Paid','partial cash');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',50,0,50,'partial cash');
      p2:=pg_temp.seed_payment(f,is_ar,40,.8,'2026-01-03');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,40,50,.8,.8,'2026-01-03');
      PERFORM pg_temp.book_control(f,is_ar,-50,'2026-01-03');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,0,'Paid','full cash');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',0,0,0,'full cash');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',50,0,50,'full today remains partial at cutoff');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,200,1.25);
      PERFORM pg_temp.book_control(f,is_ar,200,'2026-01-01');
      p1:=pg_temp.seed_payment(f,is_ar,110,1.1,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-02');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',200,-100,100,'prior source fully unapplied');
      p2:=pg_temp.seed_payment(f,is_ar,55,1.25,'2026-01-03','Draft');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,55,44,1.25,1.25,'2026-01-03');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,55,44,1.1,1.25,'2026-01-03',p1);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',200,-100,100,'draft consumer does not reserve prior source');
      UPDATE payment SET status='Posted' WHERE id=p2 AND "companyId"=f.company_id;
      -- Current cash releases44 base; prior cash releases50 against target44,
      -- transferring6 between control balances and realized FX.
      PERFORM pg_temp.book_control(f,is_ar,-38,'2026-01-03');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,140,'Partially Paid','two source snapshots');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',112,-50,62,'current and prior funding each counted once');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',200,-100,100,'cutoff before source consumption');
      UPDATE payment SET status='Voided' WHERE id=p2 AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,38,'2026-01-03');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',200,-100,100,'voided consumer restores source and target');
      UPDATE payment SET status='Voided' WHERE id=p1 AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-02');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',200,0,200,'voided source contributes no credit');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,1.25);
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01');
      m:=pg_temp.seed_memo(f,is_ar,55,1.25,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-44,'2026-01-02');
      p1:=pg_temp.seed_payment(f,is_ar,0,1.25,'2026-01-03','Draft');
      INSERT INTO "invoiceSettlement" ("memoId","appliedViaPaymentId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","appliedDate","companyId","createdBy")
        VALUES(m,p1,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,55,44,1.25,1.25,0,'2026-01-03',f.company_id,'system');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',56,0,56,'staged memo stays open and invoice stays unpaid');
      UPDATE payment SET status='Posted' WHERE id=p1 AND "companyId"=f.company_id;
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',56,0,56,'effective memo application consumes source once');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',56,0,56,'memo application cutoff');
      UPDATE payment SET status='Voided' WHERE id=p1 AND "companyId"=f.company_id;
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',56,0,56,'voided memo consumer restores source');
      UPDATE memo SET status='Voided' WHERE id=m AND "companyId"=f.company_id;
      PERFORM pg_temp.book_control(f,is_ar,44,'2026-01-02');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',100,0,100,'voided memo source disappears');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8);
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01');
      p1:=pg_temp.seed_payment(f,is_ar,60,.8,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,60,75,.8,.8,'2026-01-02',NULL,10,15);
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-02');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,0,'Paid','cash plus noncash relief');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'discount and writeoff convert to document only once');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      m:=pg_temp.seed_memo(f,is_ar,55,1.1,'2026-01-01',false);
      PERFORM pg_temp.book_control(f,is_ar,50,'2026-01-01');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',50,0,50,'increasing memo has positive base balance');
      p1:=pg_temp.seed_payment(f,is_ar,55,1.1,'2026-01-02');
      INSERT INTO "invoiceSettlement" ("paymentId","targetMemoId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","appliedDate","companyId","createdBy")
        VALUES(p1,m,55,50,1.1,1.1,'2026-01-02',f.company_id,'system');
      PERFORM pg_temp.book_control(f,is_ar,-50,'2026-01-02');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'cash-to-memo target relief retains denomination');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,.010000625,16000);
      PERFORM pg_temp.book_control(f,is_ar,.01,'2026-01-01');
      p1:=pg_temp.seed_payment(f,is_ar,160,16000,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,160,.01,16000,16000,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-.01,'2026-01-02');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,.01,'Partially Paid','positive foreign minor unit below ledger scale');
      IF is_ar THEN SELECT "openInCurrency","openInBase" INTO STRICT row_value FROM get_ar_open_by_customer(f.company_id,'2026-01-02') WHERE "documentId"=doc;
      ELSE SELECT "openInCurrency","openInBase" INTO STRICT row_value FROM get_ap_open_by_supplier(f.company_id,'2026-01-02') WHERE "documentId"=doc; END IF;
      ASSERT row_value."openInCurrency"=.01 AND row_value."openInBase"=0,'Large rate must preserve document eligibility without inventing carrying base';
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',0,0,0,'large-rate report retains payable minor unit');
      p2:=pg_temp.seed_payment(f,is_ar,.01,16000,'2026-01-03');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,.01,0,16000,16000,'2026-01-03');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,0,'Paid','source-only terminal settlement');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',0,0,0,'large-rate final source principal closes document');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8,'2026-01-01','2026-01-31','Paid');
      IF is_ar THEN UPDATE "salesInvoice" SET "datePaid"='2026-01-05' WHERE id=doc AND "companyId"=f.company_id;
      ELSE UPDATE "purchaseInvoice" SET "datePaid"='2026-01-05' WHERE id=doc AND "companyId"=f.company_id; END IF;
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-05');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,0,'Paid','legacy Paid guard');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-04',100,0,100,'legacy Paid still open before datePaid');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-05',0,0,0,'legacy Paid excluded at datePaid');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100.004,.8);
      PERFORM pg_temp.book_control(f,is_ar,100.004,'2026-01-01');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100.004,0,100.004,'fractional original base survives document rounding');
      p1:=pg_temp.seed_payment(f,is_ar,79.99,.8,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,79.99,99.9875,.8,.8,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-99.9875,'2026-01-02');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',.0165,0,.0165,'partial balance retains carrying residual');
      p2:=pg_temp.seed_payment(f,is_ar,.01,.8,'2026-01-03');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,.01,.0165,.8,.8,'2026-01-03');
      PERFORM pg_temp.book_control(f,is_ar,-.0165,'2026-01-03');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,0,'Paid','final carrying release');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',0,0,0,'final source FX releases exact carrying');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100.002,.8);
      -- Recorded controls, including multiple postings, outrank view-derived
      -- carrying because their individual component rounding is already booked.
      PERFORM pg_temp.book_control(f,is_ar,60.002,'2026-01-01',doc);
      PERFORM pg_temp.book_control(f,is_ar,40.002,'2026-01-01',doc);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100.004,0,100.004,'recorded original control rows are authoritative');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,2,3);
      PERFORM pg_temp.book_control(f,is_ar,2,'2026-01-01');
      p1:=pg_temp.seed_payment(f,is_ar,3,3,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-1,'2026-01-02');
      p2:=pg_temp.seed_payment(f,is_ar,0,3,'2026-01-03');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,1,.33333,3,3,'2026-01-03',p1);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',1.66667,-.66667,1,'prior source preserves rounded carrying residual');
      IF is_ar THEN SELECT unapplied INTO open_sum FROM get_ar_aging(f.company_id,'2026-01-03');
      ELSE SELECT unapplied INTO open_sum FROM get_ap_aging(f.company_id,'2026-01-03'); END IF;
      ASSERT open_sum=-.66667,'Prior source carrying must subtract recorded release, not reconvert remaining document principal';
      p2:=pg_temp.seed_payment(f,is_ar,0,3,'2026-01-04');
      PERFORM pg_temp.apply_cash(f,is_ar,p2,doc,2,.66667,3,3,'2026-01-04',p1);
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-04',1,0,1,'terminal prior source releases exact remaining carrying');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,2,3);
      PERFORM pg_temp.book_control(f,is_ar,2,'2026-01-01');
      m:=pg_temp.seed_memo(f,is_ar,3,3,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-1,'2026-01-02');
      p1:=pg_temp.seed_payment(f,is_ar,0,3,'2026-01-03');
      INSERT INTO "invoiceSettlement" ("memoId","appliedViaPaymentId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","appliedDate","companyId","createdBy")
        VALUES(m,p1,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,1,.33333,3,3,0,'2026-01-03',f.company_id,'system');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-03',1,0,1,'memo source preserves rounded carrying residual');
      IF is_ar THEN SELECT "openInBase" INTO open_sum FROM get_ar_open_by_customer(f.company_id,'2026-01-03') WHERE "documentId"=m;
      ELSE SELECT "openInBase" INTO open_sum FROM get_ap_open_by_supplier(f.company_id,'2026-01-03') WHERE "documentId"=m; END IF;
      ASSERT open_sum=-.66667,'Memo source carrying must subtract recorded release, not reconvert remaining document principal';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      -- Configured zero-decimal documents still retain fractional carrying.
      UPDATE currency SET "decimalPlaces"=0 WHERE code='EUR' AND "companyGroupId"=f.group_id;
      doc:=pg_temp.seed_invoice(f,is_ar,100.5,.8);
      PERFORM pg_temp.book_control(f,is_ar,100.5,'2026-01-01');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',100.5,0,100.5,'zero-decimal document preserves original base');
      IF is_ar THEN SELECT "openInCurrency" INTO open_sum FROM get_ar_open_by_customer(f.company_id,'2026-01-01');
      ELSE SELECT "openInCurrency" INTO open_sum FROM get_ap_open_by_supplier(f.company_id,'2026-01-01'); END IF;
      ASSERT open_sum=80,'Zero-decimal document boundary must use group currency precision';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      UPDATE currency SET "decimalPlaces"=3 WHERE code='EUR' AND "companyGroupId"=f.group_id;
      doc:=pg_temp.seed_invoice(f,is_ar,100.00375,.8);
      PERFORM pg_temp.book_control(f,is_ar,100.00375,'2026-01-01');
      p1:=pg_temp.seed_payment(f,is_ar,80.002,.8,'2026-01-02');
      PERFORM pg_temp.apply_cash(f,is_ar,p1,doc,80.002,100.0025,.8,.8,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-100.0025,'2026-01-02');
      PERFORM pg_temp.assert_invoice(f,is_ar,doc,.001,'Partially Paid','three-decimal minor unit');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',.00125,0,.00125,'three-decimal currency remains payable');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      FOR n IN 1..5 LOOP
        doc:=pg_temp.seed_invoice(f,is_ar,n*100,.8,'2026-01-02',(ARRAY['2026-05-01','2026-04-30','2026-03-20','2026-02-25','2026-01-01']::date[])[n]);
        PERFORM pg_temp.book_control(f,is_ar,n*100,'2026-01-02');
      END LOOP;
      p1:=pg_temp.seed_payment(f,is_ar,40,.8,'2026-01-03');
      PERFORM pg_temp.book_control(f,is_ar,-50,'2026-01-03');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-05-01',1500,-50,1450,'all aging buckets include unapplied source once');
      IF is_ar THEN SELECT * INTO STRICT row_value FROM get_ar_aging(f.company_id,'2026-05-01');
      ELSE SELECT * INTO STRICT row_value FROM get_ap_aging(f.company_id,'2026-05-01'); END IF;
      ASSERT row_value.current=100 AND row_value.bucket1=200 AND row_value.bucket2=300 AND row_value.bucket3=400 AND row_value.bucket4=500 AND row_value.unapplied=-50,'Due-date aging bucket boundaries changed';
      IF is_ar THEN SELECT * INTO STRICT row_value FROM get_ar_aging(f.company_id,'2026-05-01','documentDate',10,20,30);
      ELSE SELECT * INTO STRICT row_value FROM get_ap_aging(f.company_id,'2026-05-01','documentDate',10,20,30); END IF;
      ASSERT row_value.bucket4=1500 AND row_value.total=1450,'Document-date/custom bucket arguments changed';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    BEGIN
      f:=pg_temp.seed_report_company();
      FOREACH excluded_status IN ARRAY ARRAY['Draft','Pending','Voided'] LOOP
        doc:=pg_temp.seed_invoice(f,is_ar,100,.8,'2026-01-01','2026-01-31',excluded_status);
        PERFORM pg_temp.assert_invoice(f,is_ar,doc,80,excluded_status,'operational status guard');
      END LOOP;
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8,'2026-01-01','2026-01-31','Paid');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-01',0,0,0,'draft pending voided and legacy Paid without date excluded');
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8,'2026-01-10');
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-10');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-09',0,0,0,'future invoice and journal excluded');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    -- The tie-out exists to prove the subledger and the aging agree, so its
    -- unapplied-cash predicate must be the aging's. A party-less payment for
    -- this side (a Receipt from a supplier / a Disbursement to a customer) is
    -- the other subledger's cash: counting it in the tie-out but not the aging
    -- left get_ar_tie_out/get_ap_tie_out with a permanent non-zero variance.
    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,.8);
      PERFORM pg_temp.book_control(f,is_ar,100,'2026-01-01',doc);
      -- No control journal: this cash posts to the OTHER side's control account.
      p1:=pg_temp.seed_crossparty_payment(f,is_ar,80,.8,'2026-01-02');
      ASSERT (SELECT CASE WHEN is_ar THEN "customerId" ELSE "supplierId" END IS NULL
        FROM payment WHERE id=p1),'Cross-party fixture must leave this side party-less';
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',100,0,100,'party-less payment stays out of both the tie-out and the aging');
      -- The same cash under this side own party still reaches both.
      p2:=pg_temp.seed_payment(f,is_ar,80,.8,'2026-01-02');
      PERFORM pg_temp.book_control(f,is_ar,-100,'2026-01-02',NULL,'Payment',p2,' (on-account credit)');
      PERFORM pg_temp.assert_reports(f,is_ar,'2026-01-02',100,-100,0,'same-party unapplied payment still reaches the tie-out and the aging');
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

    -- fxGainLossAmount is no longer GENERATED ALWAYS, so writers supply it and
    -- readers sum it bare -- SUM("appliedAmount" +/- "fxGainLossAmount"). NULL
    -- plus anything is NULL, so a single nullable row would erase that whole
    -- settlement principal from the tie-out and the aging. The column must
    -- refuse a NULL outright rather than have six read sites COALESCE it.
    BEGIN
      f:=pg_temp.seed_report_company();
      doc:=pg_temp.seed_invoice(f,is_ar,100,1);
      p1:=pg_temp.seed_payment(f,is_ar,100,1,'2026-01-02');
      BEGIN
        INSERT INTO "invoiceSettlement" ("paymentId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","fxGainLossAmount","appliedDate","companyId","createdBy")
          VALUES (p1,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,100,100,1,1,NULL,'2026-01-02',f.company_id,'system');
        ASSERT false,'invoiceSettlement.fxGainLossAmount accepted an explicit NULL';
      EXCEPTION WHEN not_null_violation THEN NULL; END;
      -- Omitting it lands on the 0 default, never on NULL.
      INSERT INTO "invoiceSettlement" ("paymentId","targetSalesInvoiceId","targetPurchaseInvoiceId","sourceAmount","appliedAmount","sourceExchangeRate","targetExchangeRate","appliedDate","companyId","createdBy")
        VALUES (p1,CASE WHEN is_ar THEN doc END,CASE WHEN NOT is_ar THEN doc END,100,100,1,1,'2026-01-02',f.company_id,'system')
        RETURNING "fxGainLossAmount" INTO open_sum;
      ASSERT open_sum=0,'invoiceSettlement.fxGainLossAmount default is no longer 0';
      RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='fixture cleanup';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;

  END LOOP;
END;
$cases$;

DO $contract$
DECLARE fn record;
BEGIN
  ASSERT (SELECT array_agg(reloptions ORDER BY relname) IS NOT NULL FROM pg_class WHERE oid IN ('"salesInvoices"'::regclass,'"purchaseInvoices"'::regclass)), 'Invoker view options missing';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('"salesInvoices"'::regclass,'"purchaseInvoices"'::regclass) AND NOT ('security_invoker=true'=ANY(COALESCE(reloptions,ARRAY[]::text[])))), 'Invoice views must use security invoker';
  ASSERT (SELECT count(*)=40 FROM information_schema.columns WHERE table_schema='public' AND table_name='salesInvoices'), 'salesInvoices column contract changed';
  ASSERT (SELECT count(*)=36 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchaseInvoices'), 'purchaseInvoices column contract changed';
  ASSERT (SELECT attnotnull FROM pg_attribute WHERE attrelid='"invoiceSettlement"'::regclass AND attname='fxGainLossAmount'), 'invoiceSettlement.fxGainLossAmount must stay NOT NULL now that it is written rather than generated';
  ASSERT (SELECT provolatile='i' AND prorettype='numeric'::regtype AND pronargs=1 AND proargtypes[0]='numeric'::regtype FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='accounting_round_internal'), 'accounting_round_internal must remain an immutable numeric(numeric) helper';
  ASSERT accounting_round_internal(1.0000050)=1.00001 AND accounting_round_internal(-1.0000050)=-1.00001 AND accounting_round_internal(NULL) IS NULL, 'accounting_round_internal must behave exactly as round(value,5)';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_ar_tie_out','get_ap_tie_out','get_ar_open_by_customer','get_ap_open_by_supplier','get_ar_aging','get_ap_aging') AND prosrc ~ 'round\([^()]*,[[:space:]]*5[[:space:]]*\)'), 'Reporting RPCs must round internal scale through accounting_round_internal, never a bare scale literal';
  FOR fn IN SELECT proname,prosecdef,proargnames FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_ar_tie_out','get_ap_tie_out','get_ar_open_by_customer','get_ap_open_by_supplier','get_ar_aging','get_ap_aging') LOOP
    ASSERT NOT fn.prosecdef,'RPC must remain security invoker: '||fn.proname;
    ASSERT fn.proargnames[1:2]=ARRAY['_company_id','_as_of_date'],'RPC arguments changed: '||fn.proname;
  END LOOP;
  RAISE NOTICE 'ALL % REPORT CASES PASSED',currval('pg_temp.report_case_count');
END;
$contract$;
ROLLBACK;
