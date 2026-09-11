-- A card transaction's status and audit columns describe one atomic lifecycle
-- state. The posting functions already write these shapes; enforce them for
-- every writer, including imports that intentionally bypass ordinary triggers.
--
-- This table is branch-new relative to main, so shipped customer backups cannot
-- contain legacy cardTransaction rows. Branch environments with malformed rows
-- fail with their identities instead of receiving fabricated actors/timestamps.

DO $migration$
DECLARE
  existing_definition text;
  existing_type "char";
  existing_validated boolean;
  offending text;
BEGIN
  SELECT contype, convalidated, pg_get_constraintdef(oid)
  INTO existing_type, existing_validated, existing_definition
    FROM pg_constraint
    WHERE conrelid = '"cardTransaction"'::regclass
      AND conname = 'cardTransaction_lifecycle_audit_check';

  IF existing_definition IS NOT NULL THEN
    IF existing_type <> 'c'
      OR NOT existing_validated
      OR existing_definition <> $constraint$CHECK ((((status = 'Draft'::"cardTransactionStatus") AND ("journalId" IS NULL) AND ("postedAt" IS NULL) AND ("postedBy" IS NULL) AND ("voidedAt" IS NULL) AND ("voidedBy" IS NULL)) OR ((status = 'Posted'::"cardTransactionStatus") AND ("postingDate" IS NOT NULL) AND ("postedAt" IS NOT NULL) AND ("postedBy" IS NOT NULL) AND ("voidedAt" IS NULL) AND ("voidedBy" IS NULL)) OR ((status = 'Voided'::"cardTransactionStatus") AND ("postingDate" IS NOT NULL) AND ("postedAt" IS NOT NULL) AND ("postedBy" IS NOT NULL) AND ("voidedAt" IS NOT NULL) AND ("voidedBy" IS NOT NULL))))$constraint$
    THEN
      RAISE EXCEPTION
        'cardTransaction_lifecycle_audit_check exists with an unexpected definition or validation state';
    END IF;
    RETURN;
  END IF;

  LOCK TABLE "cardTransaction" IN SHARE ROW EXCLUSIVE MODE;

  SELECT string_agg(
    format('%s/%s status=%s', invalid.id, invalid."companyId", invalid.status),
    ', '
    ORDER BY invalid.id, invalid."companyId"
  )
  INTO offending
  FROM (
    SELECT id, "companyId", status
    FROM "cardTransaction"
    WHERE NOT (
      (
        status = 'Draft'
        AND "journalId" IS NULL
        AND "postedAt" IS NULL
        AND "postedBy" IS NULL
        AND "voidedAt" IS NULL
        AND "voidedBy" IS NULL
      )
      OR (
        status = 'Posted'
        AND "postingDate" IS NOT NULL
        AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL
        AND "voidedAt" IS NULL
        AND "voidedBy" IS NULL
      )
      OR (
        status = 'Voided'
        AND "postingDate" IS NOT NULL
        AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL
        AND "voidedAt" IS NOT NULL
        AND "voidedBy" IS NOT NULL
      )
    )
    ORDER BY id, "companyId"
    LIMIT 25
  ) AS invalid;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransaction rows violate lifecycle audit invariants: %',
      offending;
  END IF;

  ALTER TABLE "cardTransaction"
    ADD CONSTRAINT "cardTransaction_lifecycle_audit_check" CHECK (
      (
        status = 'Draft'
        AND "journalId" IS NULL
        AND "postedAt" IS NULL
        AND "postedBy" IS NULL
        AND "voidedAt" IS NULL
        AND "voidedBy" IS NULL
      )
      OR (
        status = 'Posted'
        AND "postingDate" IS NOT NULL
        AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL
        AND "voidedAt" IS NULL
        AND "voidedBy" IS NULL
      )
      OR (
        status = 'Voided'
        AND "postingDate" IS NOT NULL
        AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL
        AND "voidedAt" IS NOT NULL
        AND "voidedBy" IS NOT NULL
      )
    );
END;
$migration$;
