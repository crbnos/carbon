-- Historical posting balances survive account/ancestor deactivation in every
-- financial-report balance RPC, with and without period-close snapshots.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/accounting-historical-balances.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.assert_historical_balance(group_id text, company_id text, account_id text, label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE actual numeric; delta numeric;
BEGIN
  SELECT "balanceAtDate", "netChange" INTO actual, delta
  FROM "accountTreeBalancePeriodSeries"(group_id, company_id, '2026-07-01', ARRAY['2026-07-31','2026-08-31']::date[])
  WHERE "accountId"=account_id AND "periodEnd"='2026-08-31';
  ASSERT actual=100 AND delta=20, label||': monthly history was dropped: '||COALESCE(actual::text,'missing');

  SELECT "balanceAtDate", "netChange" INTO actual, delta
  FROM "accountTreeBalancePeriodSeries"(group_id, company_id, '2026-08-01', ARRAY['2026-08-31']::date[])
  WHERE "accountId"=account_id;
  ASSERT actual=100 AND delta=20, label||': snapshot-bounded monthly history was dropped: '||COALESCE(actual::text,'missing');

  SELECT "balanceAtDate", "netChange" INTO actual, delta
  FROM "accountTreeBalancesByCompany"(group_id, company_id, '2026-08-01', '2026-08-31')
  WHERE "accountId"=account_id;
  ASSERT actual=100 AND delta=20, label||': company history was dropped: '||COALESCE(actual::text,'missing');

  SELECT "balanceAtDate", "netChange" INTO actual, delta
  FROM "accountTreeBalances"(group_id, '2026-08-01', '2026-08-31')
  WHERE "accountId"=account_id;
  ASSERT actual=100 AND delta=20, label||': group history was dropped: '||COALESCE(actual::text,'missing');
END;
$fn$;

DO $cases$
DECLARE
  group_id text; company_id text; root_id text; parent_id text; leaf_id text; revenue_id text;
  journal_id text; period_id text; at_date date; amount numeric; account_id text; has_snapshot boolean;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Inactive report regression','system') RETURNING id INTO group_id;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Inactive report regression',group_id,'USD','America/New_York') RETURNING id INTO company_id;
  INSERT INTO account (name,class,"incomeBalance","isGroup","companyGroupId","createdBy")
    VALUES ('Assets','Asset','Balance Sheet',true,group_id,'system') RETURNING id INTO root_id;
  INSERT INTO account (name,class,"incomeBalance","isGroup","parentId","companyGroupId","createdBy")
    VALUES ('Historical cash group','Asset','Balance Sheet',true,root_id,group_id,'system') RETURNING id INTO parent_id;
  INSERT INTO account (name,class,"incomeBalance","isGroup","parentId","companyGroupId","createdBy")
    VALUES ('Historical cash','Asset','Balance Sheet',false,parent_id,group_id,'system') RETURNING id INTO leaf_id;
  INSERT INTO account (name,class,"incomeBalance","isGroup","companyGroupId","createdBy")
    VALUES ('Sales','Revenue','Income Statement',false,group_id,'system') RETURNING id INTO revenue_id;
  INSERT INTO "accountingPeriod" ("startDate","endDate",status,"companyId","createdBy","fiscalYear","periodNumber")
    VALUES ('2026-07-01','2026-07-31','Active',company_id,'system',2026,7) RETURNING id INTO period_id;

  FOREACH at_date IN ARRAY ARRAY['2026-07-15','2026-08-15']::date[] LOOP
    amount:=CASE WHEN at_date='2026-07-15' THEN 80 ELSE 20 END;
    INSERT INTO journal ("journalEntryId","companyId","postingDate",status,"sourceType","createdBy")
      VALUES ('INACTIVE-'||id(),company_id,at_date,'Draft','Manual','system') RETURNING id INTO journal_id;
    INSERT INTO "journalLine" ("journalId","accountId",amount,"journalLineReference","companyId")
      VALUES (journal_id,leaf_id,amount,id(),company_id),(journal_id,revenue_id,amount,id(),company_id);
    ASSERT (SELECT sum(CASE a.class WHEN 'Asset' THEN jl.amount ELSE -jl.amount END)=0
      FROM "journalLine" jl JOIN account a ON a.id=jl."accountId" WHERE jl."journalId"=journal_id), 'Fixture journal must balance';
    UPDATE journal SET status='Posted' WHERE id=journal_id AND "companyId"=company_id;
  END LOOP;

  -- Draft activity must stay excluded while historical accounts remain visible.
  INSERT INTO journal ("journalEntryId","companyId","postingDate",status,"sourceType","createdBy")
    VALUES ('INACTIVE-DRAFT-'||id(),company_id,'2026-08-20','Draft','Manual','system') RETURNING id INTO journal_id;
  INSERT INTO "journalLine" ("journalId","accountId",amount,"journalLineReference","companyId")
    VALUES (journal_id,leaf_id,900,id(),company_id),(journal_id,revenue_id,900,id(),company_id);

  FOREACH account_id IN ARRAY ARRAY[leaf_id,parent_id,root_id,revenue_id] LOOP
    PERFORM pg_temp.assert_historical_balance(group_id,company_id,account_id,'active baseline');
  END LOOP;

  FOREACH has_snapshot IN ARRAY ARRAY[false,true] LOOP
    IF has_snapshot THEN
      UPDATE "accountingPeriod" SET "closeStatus"='Closed' WHERE id=period_id AND "companyId"=company_id;
      PERFORM "snapshotAccountingPeriodBalances"(company_id,period_id,'system');
      ASSERT (SELECT "endingBalance"=80 FROM "accountingPeriodBalance"
        WHERE "accountingPeriodId"=period_id AND "accountId"=leaf_id AND "companyId"=company_id), 'Snapshot must retain inactive posting accounts';
    END IF;
    UPDATE account SET active=false WHERE id IN (leaf_id,revenue_id) AND "companyGroupId"=group_id;
    FOREACH account_id IN ARRAY ARRAY[leaf_id,parent_id,root_id,revenue_id] LOOP
      PERFORM pg_temp.assert_historical_balance(group_id,company_id,account_id,'inactive leaf; snapshot='||has_snapshot);
    END LOOP;
    UPDATE account SET active=false WHERE id=parent_id AND "companyGroupId"=group_id;
    FOREACH account_id IN ARRAY ARRAY[leaf_id,parent_id,root_id,revenue_id] LOOP
      PERFORM pg_temp.assert_historical_balance(group_id,company_id,account_id,'inactive ancestor; snapshot='||has_snapshot);
    END LOOP;
  END LOOP;
  ASSERT NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('accountTreeBalances','accountTreeBalancesByCompany','accountTreeBalancePeriodSeries') AND prosecdef), 'Balance RPCs must remain security invoker';
  RAISE NOTICE 'ALL HISTORICAL BALANCE CASES PASSED (active/inactive leaf/ancestor, full scan/snapshot, draft exclusion)';
END;
$cases$;
ROLLBACK;
