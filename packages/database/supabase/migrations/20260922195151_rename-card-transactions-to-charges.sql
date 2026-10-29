-- Card transactions are charges.
--
-- Renames the Ramp-fed cardTransaction / cardTransactionLine subsystem
-- (20260919152233_ramp-integration, 20260919153014_accounting-projects) to
-- charge / chargeLine: the tables, the readable-id and parent columns, the two
-- enums, the trigger functions and their messages, the RLS policies, the
-- document sequence, the event-trigger attachment, the 'Card Transaction' label
-- on the journal source/document enums, and the integration-mapping and
-- event-subscription rows that name the table. The accounting-sync engine
-- already calls this entity `charge`; the storage now matches it.
--
-- Written as drop-and-recreate rather than a chain of ALTER ... RENAME so the
-- charge schema reads from zero and every statement keeps an idempotent guard
-- for the retryable deploy runner. The feature had not been used, so both
-- tables are empty in every environment; the guard below refuses to run if that
-- is ever not true, so this can never silently destroy data.

DO $$
BEGIN
  IF to_regclass('public."cardTransaction"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."cardTransaction") THEN
    RAISE EXCEPTION
      'cardTransaction has rows; the charge rename expects an empty table';
  END IF;
END;
$$;

-- Old objects ----------------------------------------------------------------

DROP TABLE IF EXISTS "cardTransactionLine";
DROP TABLE IF EXISTS "cardTransaction";
DROP FUNCTION IF EXISTS public.check_card_transaction_account_company_group();
DROP FUNCTION IF EXISTS public.check_card_transaction_line_account_company_group();
DROP FUNCTION IF EXISTS public.check_card_transaction_draft_mutation();
DROP FUNCTION IF EXISTS public.lock_card_transaction_line_parent();
DROP TYPE IF EXISTS "cardTransactionType";
DROP TYPE IF EXISTS "cardTransactionStatus";

-- Journal enum labels --------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'journalEntrySourceType'
      AND e.enumlabel = 'Card Transaction'
  ) THEN
    ALTER TYPE "journalEntrySourceType" RENAME VALUE 'Card Transaction' TO 'Charge';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'journalLineDocumentType'
      AND e.enumlabel = 'Card Transaction'
  ) THEN
    ALTER TYPE "journalLineDocumentType" RENAME VALUE 'Card Transaction' TO 'Charge';
  END IF;
END;
$$;

-- Enums ----------------------------------------------------------------------

DO $$
BEGIN
  IF to_regtype('public."chargeType"') IS NULL THEN
    CREATE TYPE public."chargeType" AS ENUM
      ('Charge', 'Credit', 'Payment', 'Cashback', 'Repayment');
  END IF;
  IF to_regtype('public."chargeStatus"') IS NULL THEN
    CREATE TYPE public."chargeStatus" AS ENUM ('Draft', 'Posted', 'Voided');
  END IF;
END;
$$;

-- Tables ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "charge" (
  id TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  type "chargeType" NOT NULL DEFAULT 'Charge',
  status "chargeStatus" NOT NULL DEFAULT 'Draft',
  integration TEXT NOT NULL DEFAULT 'ramp',
  "cardAccountId" TEXT NOT NULL REFERENCES "account"(id),
  "offsetAccountId" TEXT REFERENCES "account"(id),
  "supplierId" TEXT,
  "merchantName" TEXT,
  "cardHolderName" TEXT,
  "cardLast4" TEXT,
  memo TEXT,
  "transactionDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"(code),
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  "journalId" TEXT REFERENCES "journal"(id),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"(id),
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT REFERENCES "user"(id),
  "createdBy" TEXT NOT NULL REFERENCES "user"(id),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"(id),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "charge_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "charge_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "charge_supplierId_fkey"
    FOREIGN KEY ("supplierId", "companyId")
    REFERENCES "supplier"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("supplierId"),
  CONSTRAINT "charge_chargeId_companyId_key"
    UNIQUE ("chargeId", "companyId"),
  CONSTRAINT "charge_offset_check" CHECK (
    type IN ('Charge', 'Credit') OR "offsetAccountId" IS NOT NULL
  ),
  CONSTRAINT "charge_lifecycle_audit_check" CHECK (
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
);

CREATE TABLE IF NOT EXISTS "chargeLine" (
  id TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL REFERENCES "account"(id),
  "costCenterId" TEXT,
  "projectId" TEXT,
  description TEXT,
  amount NUMERIC NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"(id),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"(id),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "chargeLine_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "chargeLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "chargeLine_chargeId_fkey"
    FOREIGN KEY ("chargeId", "companyId")
    REFERENCES "charge"(id, "companyId") ON DELETE CASCADE,
  CONSTRAINT "chargeLine_costCenterId_fkey"
    FOREIGN KEY ("costCenterId", "companyId")
    REFERENCES "costCenter"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("costCenterId"),
  CONSTRAINT "chargeLine_projectId_fkey"
    FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("projectId")
);

-- Supporting indexes ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS "charge_companyId_idx"
  ON "charge" ("companyId");
CREATE INDEX IF NOT EXISTS "charge_companyId_status_idx"
  ON "charge" ("companyId", status);
CREATE INDEX IF NOT EXISTS "charge_companyId_transactionDate_idx"
  ON "charge" ("companyId", "transactionDate");
CREATE INDEX IF NOT EXISTS "charge_companyId_supplierId_idx"
  ON "charge" ("companyId", "supplierId");
CREATE INDEX IF NOT EXISTS "charge_cardAccountId_idx"
  ON "charge" ("cardAccountId");
CREATE INDEX IF NOT EXISTS "charge_offsetAccountId_idx"
  ON "charge" ("offsetAccountId");
CREATE INDEX IF NOT EXISTS "charge_currencyCode_idx"
  ON "charge" ("currencyCode");
CREATE INDEX IF NOT EXISTS "charge_journalId_idx"
  ON "charge" ("journalId");
CREATE INDEX IF NOT EXISTS "charge_createdBy_idx"
  ON "charge" ("createdBy");
CREATE INDEX IF NOT EXISTS "charge_updatedBy_idx"
  ON "charge" ("updatedBy");
CREATE INDEX IF NOT EXISTS "charge_postedBy_idx"
  ON "charge" ("postedBy");
CREATE INDEX IF NOT EXISTS "charge_voidedBy_idx"
  ON "charge" ("voidedBy");

CREATE INDEX IF NOT EXISTS "chargeLine_companyId_idx"
  ON "chargeLine" ("companyId");
CREATE INDEX IF NOT EXISTS "chargeLine_chargeId_companyId_idx"
  ON "chargeLine" ("chargeId", "companyId");
CREATE INDEX IF NOT EXISTS "chargeLine_accountId_idx"
  ON "chargeLine" ("accountId");
CREATE INDEX IF NOT EXISTS "chargeLine_costCenterId_companyId_idx"
  ON "chargeLine" ("costCenterId", "companyId");
CREATE INDEX IF NOT EXISTS "chargeLine_projectId_idx"
  ON "chargeLine" ("projectId");
CREATE INDEX IF NOT EXISTS "chargeLine_createdBy_idx"
  ON "chargeLine" ("createdBy");
CREATE INDEX IF NOT EXISTS "chargeLine_updatedBy_idx"
  ON "chargeLine" ("updatedBy");

-- Company-group account integrity -------------------------------------------

CREATE OR REPLACE FUNCTION public.check_charge_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  company_group_id text;
BEGIN
  SELECT c."companyGroupId" INTO company_group_id
  FROM "company" c
  WHERE c.id = NEW."companyId";

  IF company_group_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "account" a
       WHERE a.id = NEW."cardAccountId"
         AND a."companyGroupId" = company_group_id
     )
     OR (
       NEW."offsetAccountId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "account" a
         WHERE a.id = NEW."offsetAccountId"
           AND a."companyGroupId" = company_group_id
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'charge_account_companyGroup_check',
      MESSAGE = format(
        'Charge %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "charge_account_companyGroup_guard" ON "charge";
CREATE TRIGGER "charge_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "cardAccountId", "offsetAccountId"
  ON "charge"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_charge_account_company_group();

CREATE OR REPLACE FUNCTION public.check_charge_line_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "company" c
    JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
    WHERE c.id = NEW."companyId"
      AND a.id = NEW."accountId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'chargeLine_account_companyGroup_check',
      MESSAGE = format(
        'Charge line %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "chargeLine_account_companyGroup_guard" ON "chargeLine";
CREATE TRIGGER "chargeLine_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "accountId"
  ON "chargeLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_charge_line_account_company_group();

-- Draft-only mutation and lifecycle state machine ---------------------------

CREATE OR REPLACE FUNCTION public.check_charge_draft_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS "charge_draft_guard" ON "charge";
CREATE TRIGGER "charge_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "charge"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_charge_draft_mutation();

CREATE OR REPLACE FUNCTION public.lock_charge_line_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  parent_id text;
  parent_company_id text;
  parent_status "chargeStatus";
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW."chargeId" IS DISTINCT FROM OLD."chargeId"
       OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Charge line %s/%s cannot be moved to another parent',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."chargeId";
    parent_company_id := OLD."companyId";
  ELSE
    parent_id := NEW."chargeId";
    parent_company_id := NEW."companyId";
  END IF;

  SELECT h.status INTO parent_status
  FROM "charge" h
  WHERE h.id = parent_id
    AND h."companyId" = parent_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- The parent row is no longer visible while its own Draft-only DELETE is
    -- cascading. The parent guard already authorized that delete.
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'chargeLine_chargeId_fkey',
      MESSAGE = format(
        'Charge line parent %s/%s does not exist',
        parent_id,
        parent_company_id
      );
  END IF;

  IF parent_status <> 'Draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Charge %s/%s is %s; its lines are immutable',
        parent_id,
        parent_company_id,
        parent_status
      );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "chargeLine_draft_guard" ON "chargeLine";
CREATE TRIGGER "chargeLine_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "chargeLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_charge_line_parent();

-- RLS mirrors the trigger invariants for authenticated clients. Service-role
-- posting still passes through the database triggers above.

ALTER TABLE "public"."charge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."charge";
CREATE POLICY "SELECT" ON "public"."charge"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."charge";
CREATE POLICY "INSERT" ON "public"."charge"
FOR INSERT WITH CHECK (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."charge";
CREATE POLICY "UPDATE" ON "public"."charge"
FOR UPDATE USING (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
) WITH CHECK (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."charge";
CREATE POLICY "DELETE" ON "public"."charge"
FOR DELETE USING (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

ALTER TABLE "public"."chargeLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."chargeLine";
CREATE POLICY "SELECT" ON "public"."chargeLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."chargeLine";
CREATE POLICY "INSERT" ON "public"."chargeLine"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "charge" h
    WHERE h.id = "chargeLine"."chargeId"
      AND h."companyId" = "chargeLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."chargeLine";
CREATE POLICY "UPDATE" ON "public"."chargeLine"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "charge" h
    WHERE h.id = "chargeLine"."chargeId"
      AND h."companyId" = "chargeLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM "charge" h
    WHERE h.id = "chargeLine"."chargeId"
      AND h."companyId" = "chargeLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."chargeLine";
CREATE POLICY "DELETE" ON "public"."chargeLine"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "charge" h
    WHERE h.id = "chargeLine"."chargeId"
      AND h."companyId" = "chargeLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- Document sequence. Existing companies carry the old row (20260919152233
-- inserted one per company); rename it in place, and seed any company that has
-- neither. New-company seed data owns the other population path.
UPDATE "sequence"
SET "table" = 'charge',
    name = 'Charge',
    prefix = 'CHG-%{yyyy}-%{mm}-'
WHERE "table" = 'cardTransaction';

INSERT INTO "sequence" (
  "table", name, prefix, suffix, next, size, step, "companyId"
)
SELECT 'charge', 'Charge',
       'CHG-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;

-- Rows that name the table: the accounting-sync subscription every provider
-- install creates, and the Ramp external-id mapping for a staged charge.
UPDATE "eventSystemSubscription"
SET "table" = 'charge'
WHERE "table" = 'cardTransaction';

UPDATE "externalIntegrationMapping"
SET "entityType" = 'charge'
WHERE "entityType" = 'cardTransaction';

SELECT attach_event_trigger(
  'charge',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);

NOTIFY pgrst, 'reload schema';
