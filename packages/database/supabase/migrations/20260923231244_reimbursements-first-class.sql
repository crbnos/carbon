-- Reimbursements as a first-class Carbon document.
--
-- An employee expense payable, imported from a spend tool (Ramp today) as a
-- Draft, edited in Carbon while Draft, then posted by a human. Shape mirrors
-- `charge` / `chargeLine` (20260922195151_rename-card-transactions-to-charges)
-- so one line editor serves both documents, plus a generic
-- `reimbursementLineDimension` child mirroring `journalLineDimension`
-- (20260228024512_dimensions) so the existing DimensionSelector can drive the
-- coding lines.
--
-- Also: the `employeeReimbursementsPayableAccount` control-account default
-- (resolved by id, never by number, at posting time), a fourth
-- `invoiceSettlement` target, and an employee payee on `payment`.
--
-- Every statement is idempotent: the deploy runner retries a failed file over
-- committed partial state.

-- ============================================================
-- (a) Enums
-- ============================================================

DO $$
BEGIN
  IF to_regtype('public."reimbursementStatus"') IS NULL THEN
    CREATE TYPE public."reimbursementStatus" AS ENUM ('Draft', 'Posted', 'Voided');
  END IF;
END;
$$;

-- `ALTER TYPE ... ADD VALUE` may not be REFERENCED later in the same
-- transaction. Nothing below references either label.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Reimbursement';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Reimbursement';

-- ============================================================
-- (b) Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "reimbursement" (
  id TEXT NOT NULL DEFAULT id('reimb'),
  "companyId" TEXT NOT NULL,
  "reimbursementId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  status "reimbursementStatus" NOT NULL DEFAULT 'Draft',
  integration TEXT NOT NULL DEFAULT 'ramp',
  "reimbursementDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"(code),
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  "payableAccountId" TEXT REFERENCES "account"(id),
  reference TEXT,
  notes TEXT,
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

  CONSTRAINT "reimbursement_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "reimbursement_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "reimbursement_employeeId_fkey"
    FOREIGN KEY ("employeeId", "companyId")
    REFERENCES "employee"(id, "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "reimbursement_reimbursementId_companyId_key"
    UNIQUE ("reimbursementId", "companyId"),
  CONSTRAINT "reimbursement_lifecycle_audit_check" CHECK (
    (status = 'Draft' AND "journalId" IS NULL AND "postedAt" IS NULL
     AND "postedBy" IS NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
    OR (status = 'Posted' AND "postingDate" IS NOT NULL AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
    OR (status = 'Voided' AND "postingDate" IS NOT NULL AND "postedAt" IS NOT NULL
        AND "postedBy" IS NOT NULL AND "voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS "reimbursementLine" (
  id TEXT NOT NULL DEFAULT id('reimbl'),
  "companyId" TEXT NOT NULL,
  "reimbursementId" TEXT NOT NULL,
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

  CONSTRAINT "reimbursementLine_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "reimbursementLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "reimbursementLine_reimbursementId_fkey"
    FOREIGN KEY ("reimbursementId", "companyId")
    REFERENCES "reimbursement"(id, "companyId") ON DELETE CASCADE,
  CONSTRAINT "reimbursementLine_costCenterId_fkey"
    FOREIGN KEY ("costCenterId", "companyId")
    REFERENCES "costCenter"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("costCenterId"),
  CONSTRAINT "reimbursementLine_projectId_fkey"
    FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("projectId")
);

-- Generic dimension pairs for a coding line. DimensionSelector works in
-- {dimensionId, valueId} pairs and the two legacy columns above cannot hold
-- them, so the editor needs this table. The legacy columns STAY (the Ramp
-- sync writes them, posting reads them); the posting pass unions both sources
-- and de-duplicates by dimensionId.
--
-- This MIRRORS "journalLineDimension" (20260228024512_dimensions.sql:116-138)
-- and deliberately departs from the usual table template to do so, because it
-- is the same kind of thing and the two are read together at posting:
--   * single-column PRIMARY KEY ("id") — NOT the usual composite
--     ("id","companyId"); journalLineDimension is PK ("id") alone.
--   * single-column FK to "dimension"("id"). `dimension` is companyGroup-
--     scoped with a single-column PK, like `account` and `item`, so a
--     composite (dimensionId, companyId) FK would not resolve.
--   * plain "companyId" REFERENCES "company"("id").
--   * no createdBy/updatedBy — journalLineDimension carries only createdAt,
--     and an association row written and replaced wholesale by one code path
--     has no independent authorship worth recording.
CREATE TABLE IF NOT EXISTS "reimbursementLineDimension" (
  "id" TEXT NOT NULL DEFAULT id('reimbld'),
  "reimbursementLineId" TEXT NOT NULL,
  "dimensionId" TEXT NOT NULL,
  "valueId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "reimbursementLineDimension_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reimbursementLineDimension_line_dimension_key"
    UNIQUE ("reimbursementLineId", "dimensionId"),
  CONSTRAINT "reimbursementLineDimension_reimbursementLineId_fkey"
    FOREIGN KEY ("reimbursementLineId", "companyId")
    REFERENCES "reimbursementLine"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reimbursementLineDimension_dimensionId_fkey"
    FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reimbursementLineDimension_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- valueId is INTENTIONALLY not a foreign key, exactly as on
-- journalLineDimension (see the comment at 20260228024512:131-134). For a
-- Custom dimension it references dimensionValue.id; for an entity-based one it
-- references that entity's table (location.id, department.id, ...). Adding a
-- FK here would break every entity-typed dimension. The polymorphic reference
-- is enforced at the application layer.

-- ============================================================
-- (c) Indexes — companyId and EVERY foreign key
-- ============================================================

CREATE INDEX IF NOT EXISTS "reimbursement_companyId_idx" ON "reimbursement" ("companyId");
CREATE INDEX IF NOT EXISTS "reimbursement_companyId_status_idx" ON "reimbursement" ("companyId", status);
CREATE INDEX IF NOT EXISTS "reimbursement_companyId_reimbursementDate_idx" ON "reimbursement" ("companyId", "reimbursementDate");
CREATE INDEX IF NOT EXISTS "reimbursement_employeeId_companyId_idx" ON "reimbursement" ("employeeId", "companyId");
CREATE INDEX IF NOT EXISTS "reimbursement_currencyCode_idx" ON "reimbursement" ("currencyCode");
CREATE INDEX IF NOT EXISTS "reimbursement_payableAccountId_idx" ON "reimbursement" ("payableAccountId");
CREATE INDEX IF NOT EXISTS "reimbursement_journalId_idx" ON "reimbursement" ("journalId");
CREATE INDEX IF NOT EXISTS "reimbursement_createdBy_idx" ON "reimbursement" ("createdBy");
CREATE INDEX IF NOT EXISTS "reimbursement_updatedBy_idx" ON "reimbursement" ("updatedBy");
CREATE INDEX IF NOT EXISTS "reimbursement_postedBy_idx" ON "reimbursement" ("postedBy");
CREATE INDEX IF NOT EXISTS "reimbursement_voidedBy_idx" ON "reimbursement" ("voidedBy");

CREATE INDEX IF NOT EXISTS "reimbursementLine_companyId_idx" ON "reimbursementLine" ("companyId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_reimbursementId_companyId_idx" ON "reimbursementLine" ("reimbursementId", "companyId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_accountId_idx" ON "reimbursementLine" ("accountId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_costCenterId_companyId_idx" ON "reimbursementLine" ("costCenterId", "companyId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_projectId_idx" ON "reimbursementLine" ("projectId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_createdBy_idx" ON "reimbursementLine" ("createdBy");
CREATE INDEX IF NOT EXISTS "reimbursementLine_updatedBy_idx" ON "reimbursementLine" ("updatedBy");

-- The same three journalLineDimension carries (20260228024512:136-138).
CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_reimbursementLineId_idx" ON "reimbursementLineDimension" ("reimbursementLineId");
CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_dimensionId_idx" ON "reimbursementLineDimension" ("dimensionId");
CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_companyId_idx" ON "reimbursementLineDimension" ("companyId");

-- ============================================================
-- (d) Triggers — company-group account integrity + the Draft-only state machine
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_reimbursement_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  company_group_id text;
BEGIN
  -- payableAccountId is nullable (it is resolved and stored at posting time),
  -- so a NULL is not a violation — there is nothing to check yet.
  IF NEW."payableAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c."companyGroupId" INTO company_group_id
  FROM "company" c
  WHERE c.id = NEW."companyId";

  IF company_group_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "account" a
       WHERE a.id = NEW."payableAccountId"
         AND a."companyGroupId" = company_group_id
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'reimbursement_account_companyGroup_check',
      MESSAGE = format(
        'Reimbursement %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "reimbursement_account_companyGroup_guard" ON "reimbursement";
CREATE TRIGGER "reimbursement_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "payableAccountId"
  ON "reimbursement"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_reimbursement_account_company_group();

CREATE OR REPLACE FUNCTION public.check_reimbursement_line_account_company_group()
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
      CONSTRAINT = 'reimbursementLine_account_companyGroup_check',
      MESSAGE = format(
        'Reimbursement line %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "reimbursementLine_account_companyGroup_guard" ON "reimbursementLine";
CREATE TRIGGER "reimbursementLine_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "accountId"
  ON "reimbursementLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_reimbursement_line_account_company_group();

-- Draft-only mutation and lifecycle state machine. The Draft -> Draft arm is
-- what permits header editing; everything else is immutable.

CREATE OR REPLACE FUNCTION public.check_reimbursement_draft_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS "reimbursement_draft_guard" ON "reimbursement";
CREATE TRIGGER "reimbursement_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "reimbursement"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_reimbursement_draft_mutation();

CREATE OR REPLACE FUNCTION public.lock_reimbursement_line_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  parent_id text;
  parent_company_id text;
  parent_status "reimbursementStatus";
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW."reimbursementId" IS DISTINCT FROM OLD."reimbursementId"
       OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Reimbursement line %s/%s cannot be moved to another parent',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."reimbursementId";
    parent_company_id := OLD."companyId";
  ELSE
    parent_id := NEW."reimbursementId";
    parent_company_id := NEW."companyId";
  END IF;

  SELECT h.status INTO parent_status
  FROM "reimbursement" h
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
      CONSTRAINT = 'reimbursementLine_reimbursementId_fkey',
      MESSAGE = format(
        'Reimbursement line parent %s/%s does not exist',
        parent_id,
        parent_company_id
      );
  END IF;

  IF parent_status <> 'Draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Reimbursement %s/%s is %s; its lines are immutable',
        parent_id,
        parent_company_id,
        parent_status
      );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "reimbursementLine_draft_guard" ON "reimbursementLine";
CREATE TRIGGER "reimbursementLine_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "reimbursementLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_reimbursement_line_parent();

-- ============================================================
-- (e) RLS — mirrors the trigger invariants for authenticated clients.
--     Service-role posting still passes through the triggers above.
-- ============================================================

ALTER TABLE "public"."reimbursement" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."reimbursement";
CREATE POLICY "SELECT" ON "public"."reimbursement"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."reimbursement";
CREATE POLICY "INSERT" ON "public"."reimbursement"
FOR INSERT WITH CHECK (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."reimbursement";
CREATE POLICY "UPDATE" ON "public"."reimbursement"
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
DROP POLICY IF EXISTS "DELETE" ON "public"."reimbursement";
CREATE POLICY "DELETE" ON "public"."reimbursement"
FOR DELETE USING (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

ALTER TABLE "public"."reimbursementLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."reimbursementLine";
CREATE POLICY "SELECT" ON "public"."reimbursementLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."reimbursementLine";
CREATE POLICY "INSERT" ON "public"."reimbursementLine"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "reimbursement" h
    WHERE h.id = "reimbursementLine"."reimbursementId"
      AND h."companyId" = "reimbursementLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."reimbursementLine";
CREATE POLICY "UPDATE" ON "public"."reimbursementLine"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "reimbursement" h
    WHERE h.id = "reimbursementLine"."reimbursementId"
      AND h."companyId" = "reimbursementLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM "reimbursement" h
    WHERE h.id = "reimbursementLine"."reimbursementId"
      AND h."companyId" = "reimbursementLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."reimbursementLine";
CREATE POLICY "DELETE" ON "public"."reimbursementLine"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "reimbursement" h
    WHERE h.id = "reimbursementLine"."reimbursementId"
      AND h."companyId" = "reimbursementLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- SELECT / INSERT / DELETE only — the same three journalLineDimension carries
-- (20260228024512:144-172), and the right set here for an independent reason:
-- a line's dimensions are replaced by delete-then-insert, so nothing ever
-- issues an UPDATE against this table. Gated on INVOICING permissions (not
-- accounting, unlike the precedent — this is an invoicing document). The table
-- carries its own companyId, so the tenancy clause is direct; the EXISTS
-- reaches the Draft check through two joins. SELECT matches its parent tables'
-- role-based read: anyone who can read the line can read its dimensions,
-- posted or not.

ALTER TABLE "public"."reimbursementLineDimension" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."reimbursementLineDimension";
CREATE POLICY "SELECT" ON "public"."reimbursementLineDimension"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."reimbursementLineDimension";
CREATE POLICY "INSERT" ON "public"."reimbursementLineDimension"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "reimbursementLine" l
    JOIN "reimbursement" h
      ON h.id = l."reimbursementId" AND h."companyId" = l."companyId"
    WHERE l.id = "reimbursementLineDimension"."reimbursementLineId"
      AND l."companyId" = "reimbursementLineDimension"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."reimbursementLineDimension";
CREATE POLICY "DELETE" ON "public"."reimbursementLineDimension"
FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM "reimbursementLine" l
    JOIN "reimbursement" h
      ON h.id = l."reimbursementId" AND h."companyId" = l."companyId"
    WHERE l.id = "reimbursementLineDimension"."reimbursementLineId"
      AND l."companyId" = "reimbursementLineDimension"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- ============================================================
-- (f) Account default — Employee Reimbursements Payable
-- ============================================================
-- Nullable BY DESIGN: runtime falls back to the AP payables account when
-- unset. No SET NOT NULL phase. Posting resolves this by ID, never by number.

ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "employeeReimbursementsPayableAccount" TEXT
  REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed 2180 for existing company groups. Group headers have no number —
-- resolve the parent by isGroup + name, never by number
-- (precedent: 20260908142501_returns-module.sql:289-326).
DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup"
  LOOP
    SELECT id INTO parent_id
    FROM "account"
    WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Current Liabilities'
    LIMIT 1;

    IF parent_id IS NULL THEN
      -- Customized COA without a Current Liabilities group header: skip rather
      -- than insert an orphan. accountDefault stays NULL for these companies
      -- and the app falls back to the payables account.
      RAISE WARNING 'companyGroup % has no Current Liabilities group header; skipping Employee Reimbursements Payable seed', cg.id;
      CONTINUE;
    END IF;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance", class,
      "consolidatedRate", "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '2180', 'Employee Reimbursements Payable', FALSE,
      'Other Current Liability'::"accountType",
      'Balance Sheet'::"glIncomeBalance",
      'Liability'::"glAccountClass",
      'Current'::"glConsolidatedRate",
      parent_id, FALSE, cg.id, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = cg.id AND number = '2180'
    );
  END LOOP;
END $$;

UPDATE "accountDefault" ad
SET "employeeReimbursementsPayableAccount" = (
  SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId"
      AND a.number = '2180'
      -- a customized chart may use 2180 for something unrelated; then leave
      -- NULL so the documented payables fallback applies
      AND a.name = 'Employee Reimbursements Payable'
    LIMIT 1
)
WHERE ad."employeeReimbursementsPayableAccount" IS NULL;

-- ============================================================
-- (g) Settlement target — a reimbursement is the fourth settleable document
-- ============================================================

ALTER TABLE "invoiceSettlement" ADD COLUMN IF NOT EXISTS "targetReimbursementId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceSettlement_targetReimbursementId_fkey'
  ) THEN
    ALTER TABLE "invoiceSettlement"
      ADD CONSTRAINT "invoiceSettlement_targetReimbursementId_fkey"
      FOREIGN KEY ("targetReimbursementId", "companyId")
      REFERENCES "reimbursement"(id, "companyId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

-- Widen the target XOR. `invoiceSettlement` is financial data, so the swap is
-- guarded on the constraint's own DEFINITION (not just its name): a retry that
-- already sees the widened form does nothing, and never drops a live
-- constraint. Added NOT VALID then validated separately so the ADD takes a
-- brief lock and the scan runs under SHARE UPDATE EXCLUSIVE.
--
-- It cannot reject an existing row: every existing row satisfies the old
-- three-way XOR, and `targetReimbursementId` is NULL on all of them, so each
-- sum is exactly 1. VALIDATE is therefore guaranteed to pass — it proves that
-- rather than assuming it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceSettlement_target_check'
      AND pg_get_constraintdef(oid) LIKE '%targetReimbursementId%'
  ) THEN
    ALTER TABLE "invoiceSettlement" DROP CONSTRAINT IF EXISTS "invoiceSettlement_target_check";
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_target_check" CHECK (
      (("targetSalesInvoiceId" IS NOT NULL)::int
        + ("targetPurchaseInvoiceId" IS NOT NULL)::int
        + ("targetMemoId" IS NOT NULL)::int
        + ("targetReimbursementId" IS NOT NULL)::int) = 1
    ) NOT VALID;
    ALTER TABLE "invoiceSettlement" VALIDATE CONSTRAINT "invoiceSettlement_target_check";
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetReimbursementId_idx"
  ON "invoiceSettlement" ("targetReimbursementId")
  WHERE "targetReimbursementId" IS NOT NULL;

-- ============================================================
-- (h) Payment payee — `payment` is PRODUCTION-CRITICAL
-- ============================================================
-- A reimbursement payout is a disbursement to an employee, and `payment` today
-- is customer XOR supplier. Every statement below is additive and guarded;
-- nothing is destructive. Adding a nullable column with no default is a
-- catalogue-only operation in PostgreSQL 11+, so it does not rewrite the table.

ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_employeeId_fkey'
  ) THEN
    ALTER TABLE "payment"
      ADD CONSTRAINT "payment_employeeId_fkey"
      FOREIGN KEY ("employeeId", "companyId")
      REFERENCES "employee"(id, "companyId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

-- Same guarded swap as (g), and for a stronger reason: this is the payments
-- table. The guard reads the constraint DEFINITION, so re-running the
-- migration after success is a no-op and never leaves `payment` briefly
-- unconstrained.
--
-- It cannot reject an existing row. Every existing payment satisfies the old
-- customer-XOR-supplier rule, and `employeeId` is NULL on all of them (the
-- column was just added), so each sum is exactly 1. The widened form is
-- strictly weaker than the old one on the existing column pair — it only ADDS
-- a third way to be valid — so no historical row can fail it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_party_check'
      AND pg_get_constraintdef(oid) LIKE '%employeeId%'
  ) THEN
    ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_party_check";
    ALTER TABLE "payment" ADD CONSTRAINT "payment_party_check" CHECK (
      (("customerId" IS NOT NULL)::int
        + ("supplierId" IS NOT NULL)::int
        + ("employeeId" IS NOT NULL)::int) = 1
    ) NOT VALID;
    ALTER TABLE "payment" VALIDATE CONSTRAINT "payment_party_check";
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "payment_employeeId_companyId_idx"
  ON "payment" ("employeeId", "companyId") WHERE "employeeId" IS NOT NULL;

-- ============================================================
-- (i) Document sequence + event trigger
-- ============================================================

INSERT INTO "sequence" (
  "table", name, prefix, suffix, next, size, step, "companyId"
)
SELECT 'reimbursement', 'Reimbursement',
       'REIMB-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;

SELECT attach_event_trigger(
  'reimbursement',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);

NOTIFY pgrst, 'reload schema';
