-- Database denomination, source-principal constraints, and real consolidation rates.
-- Complements production posting/transaction tests; seeded SQL does not execute HTTP posting.
-- Run: pnpm exec tsx .context/accounting/run-local-check.ts psql -X -v ON_ERROR_STOP=1
--   -f packages/database/supabase/tests/accounting-posting-corrections.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '60s';

CREATE TYPE pg_temp.posting_fixture AS (
  group_id text, company_id text, customer_id text, supplier_id text,
  supplier_interaction_id text, ar_account text, ap_account text, bank_account text,
  reason_account text, period_id text
);

CREATE FUNCTION pg_temp.seed_posting_company() RETURNS pg_temp.posting_fixture
LANGUAGE plpgsql AS $fn$
DECLARE f pg_temp.posting_fixture; defaults_json jsonb;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Posting harness '||id(),'system') RETURNING id INTO f.group_id;
  INSERT INTO "company" (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Posting harness '||id(),f.group_id,'USD','America/New_York') RETURNING id INTO f.company_id;
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

CREATE FUNCTION pg_temp.seed_invoice(f pg_temp.posting_fixture,is_ar boolean,amount_base numeric,rate numeric,
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

DO $denominations$
DECLARE f pg_temp.posting_fixture; invoice_id text; row_value record;
BEGIN
  f:=pg_temp.seed_posting_company();
  invoice_id:=pg_temp.seed_invoice(f,true,50,.8);
  UPDATE "salesInvoiceLine" SET quantity=2,"addOnCost"=20,"nonTaxableAddOnCost"=10,"shippingCost"=5,"setupPrice"=7,"taxPercent"=.1
    WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  SELECT * INTO STRICT row_value FROM "salesInvoiceLine" WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  ASSERT row_value."unitPrice"=50 AND row_value."convertedUnitPrice"=40,'Sales unitPrice is base; convertedUnitPrice is document';
  ASSERT row_value."convertedAddOnCost"=16 AND row_value."convertedNonTaxableAddOnCost"=8 AND row_value."convertedShippingCost"=4 AND row_value."convertedSetupPrice"=5.6,'Sales generated components multiply base by foreign-per-base rate';
  SELECT * INTO STRICT row_value FROM "salesInvoices" WHERE id=invoice_id AND "companyId"=f.company_id;
  ASSERT row_value.subtotal=135 AND row_value."totalTax"=12.5 AND row_value."totalAmount"=147.5,'Sales aggregate remains base and applies taxable/non-taxable split';
  ASSERT row_value.balance*.8=118,'Sales balance converts base carrying to document display once';
  RAISE NOTICE 'PASS generated sales base/document components and aggregate denomination';

  invoice_id:=pg_temp.seed_invoice(f,false,50,.8);
  UPDATE "purchaseInvoiceLine" SET quantity=2,"supplierShippingCost"=4,"supplierTaxAmount"=8,"conversionFactor"=5
    WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  SELECT * INTO STRICT row_value FROM "purchaseInvoiceLine" WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  ASSERT row_value."supplierUnitPrice"=40 AND row_value."unitPrice"=50 AND row_value."extendedPrice"=100,'Purchase supplier fields are document; generated unit/extended are base';
  ASSERT row_value."shippingCost"=5 AND row_value."taxAmount"=10 AND row_value."totalAmount"=115,'Purchase generated components divide document by foreign-per-base rate exactly once';
  ASSERT row_value."conversionFactor"=5 AND row_value."unitPrice"/row_value."conversionFactor"=10,'Non-1 purchase UOM keeps inventory base unit cost distinct from purchase-unit cost';
  SELECT * INTO STRICT row_value FROM "purchaseInvoices" WHERE id=invoice_id AND "companyId"=f.company_id;
  ASSERT row_value."totalAmount"=115 AND row_value.balance*.8=92,'Purchase aggregate and document balance retain denominations';
  RAISE NOTICE 'PASS generated purchase denominations with non-1 UOM';

  UPDATE "purchaseInvoiceLine" SET quantity=1,"supplierUnitPrice"=160.01,"supplierShippingCost"=0,"supplierTaxAmount"=0,"exchangeRate"=16000
    WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  SELECT * INTO STRICT row_value FROM "purchaseInvoiceLine" WHERE "invoiceId"=invoice_id AND "companyId"=f.company_id;
  ASSERT row_value."unitPrice"=.010000625 AND row_value."totalAmount"=.010000625,'Purchase generated amounts must retain raw precision beyond the ledger scale';
  ASSERT row_value."unitPrice"*row_value."exchangeRate"=160.01,'Generated purchase precision must round-trip the last foreign minor unit';
  RAISE NOTICE 'PASS generated purchase amount preserves 160.01 at rate16000';
END;
$denominations$;

DO $pair_rates$
DECLARE f pg_temp.posting_fixture; other pg_temp.posting_fixture; rates record;
BEGIN
  f:=pg_temp.seed_posting_company(); other:=pg_temp.seed_posting_company();
  UPDATE company SET "baseCurrencyCode"='GBP' WHERE id=f.company_id;
  UPDATE company SET "baseCurrencyCode"='EUR' WHERE id=other.company_id;
  INSERT INTO currency(code,"companyGroupId","decimalPlaces","historicalExchangeRate","createdBy")
    VALUES('GBP',f.group_id,2,1.25,'system'),('GBP',other.group_id,2,9,'system');
  -- New dates only, inside this rollback. Never overwrite a global market row.
  INSERT INTO "exchangeRate" ("currencyCode","effectiveDate",rate) VALUES
    ('GBP','2199-12-30',4),('GBP','2199-12-31',2),('EUR','2199-12-30',4),('EUR','2199-12-31',4);
  SELECT * INTO STRICT rates FROM "getConsolidationRates"(f.group_id,f.company_id,'EUR','2199-12-31','2199-12-30');
  ASSERT rates."sourceCurrency"='GBP' AND rates."closingRate"=2 AND rates."averageRate"=1.5 AND rates."historicalRate"=1.25,'Consolidation must use target/source pair ratios and group-owned historical rate';
  RAISE NOTICE 'PASS real consolidation RPC closing2/average1.5/historical1.25 pair rates';
  SELECT * INTO STRICT rates FROM "getConsolidationRates"(other.group_id,other.company_id,'GBP','2199-12-31','2199-12-30');
  ASSERT rates."closingRate"=.5 AND rates."averageRate"=.75,'Reverse consolidation direction must invert each daily pair before averaging';
  RAISE NOTICE 'PASS real consolidation reciprocal pair direction';
  SELECT * INTO STRICT rates FROM "getConsolidationRates"(f.group_id,f.company_id,'GBP','2199-12-31','2199-12-30');
  ASSERT rates."closingRate"=1 AND rates."averageRate"=1 AND rates."historicalRate"=1,'Identity consolidation returns one for all rate kinds';
  RAISE NOTICE 'PASS real consolidation identity rates';
END;
$pair_rates$;

DO $settlement_cases$
DECLARE
  f pg_temp.posting_fixture;
  other pg_temp.posting_fixture;
  customer_id text;
  other_customer_id text;
  owner_id text;
  source_id text;
  other_source_id text;
  target_id text;
  memo_source_id text;
  settlement_id text;
  invalid_amount numeric;
  constraint_name text;
BEGIN
  f := pg_temp.seed_posting_company();
  other := pg_temp.seed_posting_company();
  INSERT INTO "customer" (name, "companyId", "createdBy")
    VALUES ('Settlement customer', f.company_id, 'system') RETURNING id INTO customer_id;
  INSERT INTO "customer" (name, "companyId", "createdBy")
    VALUES ('Other company customer', other.company_id, 'system') RETURNING id INTO other_customer_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy", "exchangeRate", status, "postingDate")
    VALUES ('APPLY', 'Receipt', DATE '2026-09-07', 'EUR', 0.01, f.bank_account, customer_id, f.company_id, 'system',16000,'Posted','2026-09-07') RETURNING id INTO owner_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy", "exchangeRate", status, "postingDate")
    VALUES ('SOURCE', 'Receipt', DATE '2026-09-06', 'EUR', 0.01, f.bank_account, customer_id, f.company_id, 'system',16000,'Posted','2026-09-07') RETURNING id INTO source_id;
  INSERT INTO "payment" ("paymentId", "paymentType", "paymentDate", "currencyCode", "totalAmount", "bankAccount", "customerId", "companyId", "createdBy", "exchangeRate", status, "postingDate")
    VALUES ('OTHER-SOURCE', 'Receipt', DATE '2026-09-06', 'EUR', 0.01, other.bank_account, other_customer_id, other.company_id, 'system',16000,'Posted','2026-09-06') RETURNING id INTO other_source_id;
  INSERT INTO "memo" ("memoId", direction, "memoDate", "currencyCode", amount, "customerId", "companyId", "createdBy", "exchangeRate", status, "postingDate", "reasonAccount")
    VALUES ('TARGET', 'Debit', DATE '2026-09-07', 'EUR', 0.01, customer_id, f.company_id, 'system',16000,'Posted','2026-09-07',f.reason_account) RETURNING id INTO target_id;
  INSERT INTO "memo" ("memoId", direction, "memoDate", "currencyCode", amount, "customerId", "companyId", "createdBy", "exchangeRate", status, "postingDate", "reasonAccount")
    VALUES ('MEMO-SOURCE', 'Credit', DATE '2026-09-07', 'EUR', 0.01, customer_id, f.company_id, 'system',16000,'Posted','2026-09-07',f.reason_account) RETURNING id INTO memo_source_id;

  -- This is the terminal 0.01 document-currency application at rate 16000:
  -- internal base principal rounds to zero, but source principal must survive.
  INSERT INTO "invoiceSettlement" ("paymentId", "sourcePaymentId", "targetMemoId", "appliedAmount", "sourceAmount",
    "sourceExchangeRate", "targetExchangeRate", "appliedDate", "companyId", "createdBy", "fxGainLossAmount")
  VALUES (owner_id, source_id, target_id, 0, 0.01, 16000, 16000, DATE '2026-09-07', f.company_id, 'system', 0)
  RETURNING id INTO settlement_id;
  ASSERT (SELECT "appliedAmount" = 0 AND "sourceAmount" = 0.01 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Source-only minor-unit allocation must survive base rounding';
  UPDATE "invoiceSettlement" SET "fxGainLossAmount" = -0.00001 WHERE id = settlement_id;
  ASSERT (SELECT "fxGainLossAmount" = -0.00001 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Signed FX snapshot must be writable';
  RAISE NOTICE 'PASS source-only minor-unit allocation and writable FX snapshot';

  BEGIN
    UPDATE "invoiceSettlement" SET "sourcePaymentId" = other_source_id WHERE id = settlement_id;
    ASSERT false, 'Cross-company source payment must be refused';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_companyId_fkey', 'Expected same-company funding FK';
  END;
  BEGIN
    UPDATE "invoiceSettlement" SET "sourcePaymentId" = owner_id WHERE id = settlement_id;
    ASSERT false, 'A payment must not fund itself as prior credit';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_check', 'Expected self-funding constraint';
  END;
  BEGIN
    UPDATE "invoiceSettlement" SET "paymentId" = NULL, "memoId" = memo_source_id WHERE id = settlement_id;
    ASSERT false, 'Memo-owned allocation must not name a source payment';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_check', 'Expected payment-only funding constraint';
  END;
  BEGIN
    DELETE FROM "payment" WHERE id = source_id AND "companyId" = f.company_id;
    ASSERT false, 'Referenced funding payment must be retained';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_sourcePaymentId_companyId_fkey', 'Expected funding-source delete protection';
  END;
  RAISE NOTICE 'PASS same-company FK, self-funding, payment owner, and source deletion guards';

  FOREACH invalid_amount IN ARRAY ARRAY[-0.01::numeric, 'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric] LOOP
    BEGIN
      -- Positive appliedAmount isolates sourceAmount validation from the
      -- zero-components check, proving exactly the constraint under test.
      UPDATE "invoiceSettlement" SET "appliedAmount" = 1, "sourceAmount" = invalid_amount WHERE id = settlement_id;
      ASSERT false, 'Invalid source amount accepted: ' || invalid_amount;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      ASSERT constraint_name = 'invoiceSettlement_sourceAmount_check', 'Expected source-amount constraint for ' || invalid_amount;
    END;
  END LOOP;
  BEGIN
    UPDATE "invoiceSettlement" SET "sourceAmount" = 0 WHERE id = settlement_id;
    ASSERT false, 'An entirely empty allocation must still be refused';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    ASSERT constraint_name = 'invoiceSettlement_anyComponent_check', 'Expected empty-allocation constraint';
  END;
  UPDATE "invoiceSettlement" SET "sourcePaymentId" = NULL WHERE id = settlement_id;
  ASSERT (SELECT "sourcePaymentId" IS NULL AND "sourceAmount" = 0.01 FROM "invoiceSettlement" WHERE id = settlement_id),
    'Current cash may supply a source-only minor-unit allocation';
  RAISE NOTICE 'PASS finite/nonnegative source amounts, empty allocation refusal, and current-cash source';
  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$settlement_cases$;

ROLLBACK;
