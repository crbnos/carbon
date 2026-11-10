-- Review fixes for the accounting cutover
-- (.ai/specs/implemented/2026-10-08-accounting-cutover.md).
--
-- 1. check_accounting_config_locked: a demo dataset apply may re-date the
--    cutover. The dataset tiers set app.dataset_apply (SET LOCAL) in their
--    transaction; every other change of a set cutover is still refused, and
--    the base currency and fiscal year locks are unchanged.
-- 2. journal_posting_status reads companySettings FOR SHARE, as the TS
--    journalPostingStatus does, so the SQL job costing
--    (backflush_job_materials, complete_job_to_inventory) cannot write a
--    Provisional journal after the enable commits. Was a STABLE SQL function
--    with a plain SELECT; still SECURITY INVOKER.
-- 3. The legacy journal attach of a charge or reimbursement
--    (20261009060609) accepts only a journal of the same company with a line
--    whose document is that row. Before, any updater could attach any
--    journal id to a Posted row that had none.
--
-- Each function is copied from its live definition (pg_get_functiondef);
-- only the marked branch is new or changed.

-- ── 1. A dataset apply may re-date the cutover ──────────────────────────────

CREATE OR REPLACE FUNCTION public.check_accounting_config_locked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_activated_at TIMESTAMP WITH TIME ZONE;
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
    SELECT cs."accountingActivatedAt" INTO v_activated_at
    FROM "companySettings" cs WHERE cs."id" = NEW."id";
    IF v_activated_at IS NOT NULL
       AND NEW."baseCurrencyCode" IS DISTINCT FROM OLD."baseCurrencyCode" THEN
      RAISE EXCEPTION 'The base currency is locked: accounting was set up %', v_activated_at;
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

-- ── 2. The posting status waits for the enable ──────────────────────────────

CREATE OR REPLACE FUNCTION public.journal_posting_status(p_company_id text)
 RETURNS "journalEntryStatus"
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutover DATE;
BEGIN
  -- FOR SHARE, held to the end of the posting transaction: the enable takes
  -- FOR UPDATE on this row, so a posting that read "no cutover" commits
  -- before the enable promotes, and one that starts during the enable waits
  -- and reads the cutover it set.
  SELECT cs."accountingCutoverDate" INTO v_cutover
  FROM "companySettings" cs
  WHERE cs."id" = p_company_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company settings not found for company %', p_company_id;
  END IF;
  RETURN CASE WHEN v_cutover IS NULL
    THEN 'Provisional'::"journalEntryStatus"
    ELSE 'Posted'::"journalEntryStatus" END;
END;
$function$;

-- ── 3. A legacy journal attach names its own document ───────────────────────

CREATE OR REPLACE FUNCTION public.check_charge_draft_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Charge %s/%s must be created in Draft status',
          NEW.id,
          NEW."companyId"
        );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Charge %s/%s is %s and cannot be deleted',
          OLD.id,
          OLD."companyId",
          OLD.status
        );
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Posted' THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Charge %s/%s content cannot change while posting',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  -- The accounting enable attaches the journal of a legacy charge.
  IF OLD.status = 'Posted' AND NEW.status = 'Posted'
     AND OLD."journalId" IS NULL AND NEW."journalId" IS NOT NULL THEN
    -- Only a journal of the same company written for this charge:
    -- one of its lines names the charge as its document.
    IF NOT EXISTS (
      SELECT 1
      FROM "journal" j
      JOIN "journalLine" jl
        ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
      WHERE j."id" = NEW."journalId"
        AND j."companyId" = NEW."companyId"
        AND j."status" IN ('Provisional', 'Posted')
        AND jl."documentType" = 'Charge'
        AND jl."documentId" = NEW."id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Charge %s/%s can only be given a journal written for it',
          OLD.id,
          OLD."companyId"
        );
    END IF;
    IF (to_jsonb(NEW) - ARRAY['journalId', 'updatedAt', 'updatedBy']) =
       (to_jsonb(OLD) - ARRAY['journalId', 'updatedAt', 'updatedBy']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Charge %s/%s content cannot change while its journal is attached',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF OLD.status = 'Posted' AND NEW.status = 'Voided' THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Charge %s/%s content cannot change while voiding',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format(
      'Charge %s/%s cannot transition from %s to %s',
      OLD.id,
      OLD."companyId",
      OLD.status,
      NEW.status
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_reimbursement_draft_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Reimbursement %s/%s must be created in Draft status',
          NEW.id,
          NEW."companyId"
        );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Reimbursement %s/%s is %s and cannot be deleted',
          OLD.id,
          OLD."companyId",
          OLD.status
        );
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Posted' THEN
    -- payableAccountId joins the allowed set: the posting transaction resolves
    -- the control account and stores it on the row as it posts.
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'payableAccountId', 'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'payableAccountId', 'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Reimbursement %s/%s content cannot change while posting',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  -- The accounting enable attaches the journal of a legacy reimbursement,
  -- and the payable account it credits when the row has none.
  IF OLD.status = 'Posted' AND NEW.status = 'Posted'
     AND OLD."journalId" IS NULL AND NEW."journalId" IS NOT NULL
     AND (OLD."payableAccountId" IS NULL
          OR NEW."payableAccountId" IS NOT DISTINCT FROM OLD."payableAccountId") THEN
    -- Only a journal of the same company written for this reimbursement:
    -- one of its lines names the reimbursement as its document.
    IF NOT EXISTS (
      SELECT 1
      FROM "journal" j
      JOIN "journalLine" jl
        ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
      WHERE j."id" = NEW."journalId"
        AND j."companyId" = NEW."companyId"
        AND j."status" IN ('Provisional', 'Posted')
        AND jl."documentType" = 'Reimbursement'
        AND jl."documentId" = NEW."id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Reimbursement %s/%s can only be given a journal written for it',
          OLD.id,
          OLD."companyId"
        );
    END IF;
    IF (to_jsonb(NEW) - ARRAY[
          'journalId', 'payableAccountId', 'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'journalId', 'payableAccountId', 'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Reimbursement %s/%s content cannot change while its journal is attached',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF OLD.status = 'Posted' AND NEW.status = 'Voided' THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Reimbursement %s/%s content cannot change while voiding',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format(
      'Reimbursement %s/%s cannot transition from %s to %s',
      OLD.id,
      OLD."companyId",
      OLD.status,
      NEW.status
    );
END;
$function$;
