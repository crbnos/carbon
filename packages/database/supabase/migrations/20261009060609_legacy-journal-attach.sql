-- The accounting enable writes the journal of a legacy charge or
-- reimbursement (.ai/specs/2026-10-08-accounting-cutover.md section 5a): a
-- Posted document dated on or after the cutover with no journal, because it
-- posted with accounting off or the reset deleted its journal. The enable
-- sets the document's "journalId", as the posting does, so a later void
-- reverses that journal.
--
-- The draft guards refused every Posted -> Posted change. They now allow one:
-- a Posted document with no journal gets a journal, and nothing else changes
-- (a reimbursement may also get the payable account the journal credits,
-- when it has none). Both functions are copied from the live definitions
-- (pg_get_functiondef); only the new branch is added.

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
