-- A company's base currency can change until it records its first
-- transaction (spec .ai/specs/2026-11-21-base-currency-change.md).
--
-- 1. base_currency_change_blockers(company) lists why a change is refused,
--    one reason code per failing check. The ERP reads it to show the
--    reasons and to refuse with them; the trigger below enforces it.
-- 2. check_accounting_config_locked: the company branch refused any base
--    currency change once accounting was set up, and allowed every change
--    before. It now refuses a change while the company holds data in its
--    base currency, set up or not. A change relabels every stored amount and
--    converts nothing, so it is safe only when no amount depends on the old
--    base. An activated company with an empty ledger can change; one with a
--    journal line cannot. This removes the accountingActivatedAt read from
--    the company branch on purpose (function-redefinition-keeps-changes is
--    baselined for it). The cutover and fiscal year branches are unchanged.

-- ── 1. What holds a company's base currency ─────────────────────────────────

-- The checks one company's own rows decide. SECURITY INVOKER: from the
-- SECURITY DEFINER trigger it runs as the owner and sees every row; called
-- through the API it sees what the caller's RLS allows, and the trigger still
-- enforces the full answer.
CREATE OR REPLACE FUNCTION public.base_currency_data_blockers(p_company_id TEXT)
RETURNS TABLE ("reason" TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  -- A journal line with an amount, in any status: the Draft opening trial
  -- balance, Provisional journals written before the cutover, Posted ones.
  SELECT 'ledger-has-amounts'
  WHERE EXISTS (
    SELECT 1 FROM "journalLine"
    WHERE "companyId" = p_company_id AND "amount" <> 0
  )
  UNION ALL
  -- A document that stores a currency and an exchange rate against the
  -- base, in any status. A base-currency document holds the old code at
  -- rate 1 and would read as a foreign document at par.
  SELECT 'has-documents'
  WHERE EXISTS (SELECT 1 FROM "quote" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "salesOrder" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "salesInvoice" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "salesReturnOrder" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "supplierQuote" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "purchaseOrder" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "purchaseInvoice" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "purchaseReturnOrder" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "receipt" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "shipment" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "payment" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "memo" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "charge" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "reimbursement" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "customerContract" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "rentalAgreement" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "lease" WHERE "companyId" = p_company_id)
     OR EXISTS (
       SELECT 1 FROM "intercompanyTransaction"
       WHERE "sourceCompanyId" = p_company_id OR "targetCompanyId" = p_company_id
     )
  UNION ALL
  -- Stock and cost: a receipt, shipment, adjustment, opening stock import,
  -- job issue or completion writes one of these.
  SELECT 'has-stock-or-costs'
  WHERE EXISTS (SELECT 1 FROM "itemLedger" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "costLedger" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "supplierLedger" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "projectLedger" WHERE "companyId" = p_company_id)
  UNION ALL
  SELECT 'has-fixed-assets'
  WHERE EXISTS (SELECT 1 FROM "fixedAsset" WHERE "companyId" = p_company_id);
$$;

-- Every reason a base currency change of the company is refused; no rows
-- means it may change.
CREATE OR REPLACE FUNCTION public.base_currency_change_blockers(p_company_id TEXT)
RETURNS TABLE ("reason" TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT b."reason" FROM public.base_currency_data_blockers(p_company_id) b
  UNION ALL
  -- A parent's base is the group's consolidation currency: every subsidiary
  -- translates into it, so any company of the group with data holds it.
  SELECT 'group-has-data'
  FROM "company" c
  WHERE c."id" = p_company_id
    AND EXISTS (SELECT 1 FROM "company" s WHERE s."parentCompanyId" = c."id")
    AND EXISTS (
      SELECT 1
      FROM "company" o
      CROSS JOIN LATERAL public.base_currency_data_blockers(o."id") ob
      WHERE o."companyGroupId" = c."companyGroupId" AND o."id" <> c."id"
    )
  UNION ALL
  -- An accounting or spend provider holds the company's figures in the old
  -- base. Xero checks its home currency only at connect; the others read the
  -- base on every sync.
  SELECT 'accounting-integration'
  WHERE EXISTS (
    SELECT 1 FROM "companyIntegration"
    WHERE "companyId" = p_company_id
      AND "active"
      AND "id" IN ('xero', 'quickbooks', 'rillet', 'ramp')
  )
     OR EXISTS (
       SELECT 1 FROM "externalIntegrationMapping"
       WHERE "companyId" = p_company_id
         AND "integration" IN ('xero', 'quickbooks', 'rillet', 'ramp')
     )
     OR EXISTS (SELECT 1 FROM "accountingSyncOperation" WHERE "companyId" = p_company_id)
     OR EXISTS (SELECT 1 FROM "accountingSyncTieOut" WHERE "companyId" = p_company_id);
$$;

-- ── 2. The trigger refuses a change the blockers refuse ─────────────────────

CREATE OR REPLACE FUNCTION public.check_accounting_config_locked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_activated_at TIMESTAMP WITH TIME ZONE;
  v_blockers TEXT;
BEGIN
  IF TG_TABLE_NAME = 'companySettings' THEN
    -- A demo dataset apply (applyDatasetTiers) dates the cutover at the
    -- dataset's earliest seeded period, even when the company already has
    -- one: seed-company stamps the current month before onboarding applies
    -- its template. It sets app.dataset_apply with SET LOCAL in its own
    -- transaction. Never honoured for an API role.
    IF current_setting('app.dataset_apply', true) = 'true'
       AND coalesce(current_setting('role', true), 'none')
         NOT IN ('anon', 'authenticated') THEN
      RETURN NEW;
    END IF;
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND (NEW."accountingCutoverDate" IS DISTINCT FROM OLD."accountingCutoverDate"
         OR NEW."accountingActivatedAt" IS DISTINCT FROM OLD."accountingActivatedAt"
         OR NEW."accountingActivatedBy" IS DISTINCT FROM OLD."accountingActivatedBy") THEN
      RAISE EXCEPTION 'The accounting cutover is one-way and cannot change';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'company' THEN
    -- The base currency changes only while nothing is denominated in it.
    -- Every role is bound, the service role and a dataset apply included.
    IF NEW."baseCurrencyCode" IS DISTINCT FROM OLD."baseCurrencyCode" THEN
      SELECT string_agg(b."reason", ', ') INTO v_blockers
      FROM public.base_currency_change_blockers(NEW."id") b;
      IF v_blockers IS NOT NULL THEN
        RAISE EXCEPTION 'The base currency is locked: %', v_blockers;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'fiscalYearSettings' THEN
    SELECT cs."accountingActivatedAt" INTO v_activated_at
    FROM "companySettings" cs WHERE cs."id" = NEW."companyId";
    IF v_activated_at IS NOT NULL
       AND NEW."startMonth" IS DISTINCT FROM OLD."startMonth" THEN
      RAISE EXCEPTION 'The fiscal year start is locked: accounting was set up %', v_activated_at;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
