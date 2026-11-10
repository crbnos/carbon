-- A chart of accounts import moves a merged account's references, posted
-- documents included (.ai/specs/2026-10-12-chart-of-accounts-import.md). The
-- import runs only before the accounting cutover, so a posted document's
-- journal is Provisional and its account moves with the journal lines.
--
-- Payments, memos and invoice lines have no guard against that update. The
-- charge and reimbursement guards refuse any change to a non-Draft row, so
-- each gets one branch: while app.account_import is set (SET LOCAL, by
-- apply-account-import), a row may change its account columns and nothing
-- else, for a company with no cutover, never for an API role.
--
-- Each function is copied from its live definition (20261009145057); only the
-- app.account_import branch is new.

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

  -- A chart of accounts import (apply-account-import) moves a merged
  -- account's references before accounting is activated, posted charges
  -- included: their journals are still Provisional. It sets
  -- app.account_import with SET LOCAL. Only the account columns may change,
  -- never for an API role, and never once the company has a cutover.
  IF OLD.status = NEW.status
     AND current_setting('app.account_import', true) = 'true'
     AND coalesce(current_setting('role', true), 'none')
       NOT IN ('anon', 'authenticated')
     AND NOT EXISTS (
       SELECT 1 FROM "companySettings" cs
       WHERE cs."id" = NEW."companyId"
         AND cs."accountingCutoverDate" IS NOT NULL
     )
     AND (to_jsonb(NEW) - ARRAY['cardAccountId', 'offsetAccountId', 'updatedAt', 'updatedBy']) =
         (to_jsonb(OLD) - ARRAY['cardAccountId', 'offsetAccountId', 'updatedAt', 'updatedBy']) THEN
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

  -- A chart of accounts import (apply-account-import) moves a merged
  -- account's references before accounting is activated, posted reimbursements
  -- included: their journals are still Provisional. It sets
  -- app.account_import with SET LOCAL. Only the account columns may change,
  -- never for an API role, and never once the company has a cutover.
  IF OLD.status = NEW.status
     AND current_setting('app.account_import', true) = 'true'
     AND coalesce(current_setting('role', true), 'none')
       NOT IN ('anon', 'authenticated')
     AND NOT EXISTS (
       SELECT 1 FROM "companySettings" cs
       WHERE cs."id" = NEW."companyId"
         AND cs."accountingCutoverDate" IS NOT NULL
     )
     AND (to_jsonb(NEW) - ARRAY['payableAccountId', 'updatedAt', 'updatedBy']) =
         (to_jsonb(OLD) - ARRAY['payableAccountId', 'updatedAt', 'updatedBy']) THEN
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
