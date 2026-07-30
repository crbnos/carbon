-- Period close lifecycle: Open → Locked → Closed on accountingPeriod,
-- fiscal-year identity, and a hard trigger backstop on journal.
-- Tracking spec: .ai/specs/2026-07-02-period-closing.md

-- 1. Close lifecycle enum (separate axis from the legacy Active/Inactive status)
DO $$ BEGIN
  CREATE TYPE "periodCloseStatus" AS ENUM ('Open', 'Locked', 'Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. New columns
ALTER TABLE "accountingPeriod"
  ADD COLUMN IF NOT EXISTS "closeStatus" "periodCloseStatus" NOT NULL DEFAULT 'Open',
  ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "periodNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "accountingPeriod_lockedBy_idx" ON "accountingPeriod" ("lockedBy");

-- 3. Backfill closeStatus from closedAt (column existed but was never populated;
--    be safe in case any environment has data)
UPDATE "accountingPeriod"
SET "closeStatus" = 'Closed'
WHERE "closedAt" IS NOT NULL AND "closeStatus" = 'Open';

-- 4. Backfill fiscalYear/periodNumber from the period's own startDate and the
--    company's fiscal start month. Fiscal years are named by the calendar year
--    in which they END (a FY starting Jul 2025 is FY2026); for January starts
--    the fiscal year equals the calendar year.
UPDATE "accountingPeriod" ap
SET
  "periodNumber" = ((EXTRACT(MONTH FROM ap."startDate")::int - s.start_month + 12) % 12) + 1,
  "fiscalYear" = CASE
    WHEN s.start_month = 1 THEN EXTRACT(YEAR FROM ap."startDate")::int
    WHEN EXTRACT(MONTH FROM ap."startDate")::int >= s.start_month THEN EXTRACT(YEAR FROM ap."startDate")::int + 1
    ELSE EXTRACT(YEAR FROM ap."startDate")::int
  END
FROM (
  SELECT
    c."id" AS company_id,
    COALESCE(
      (SELECT array_position(enum_range(NULL::"month")::text[], fys."startMonth"::text)
       FROM "fiscalYearSettings" fys
       WHERE fys."companyId" = c."id"),
      1
    ) AS start_month
  FROM "company" c
) s
WHERE s.company_id = ap."companyId"
  AND (ap."fiscalYear" IS NULL OR ap."periodNumber" IS NULL);

-- 5. Uniqueness of (companyId, fiscalYear, periodNumber). The lazy period
--    auto-creation has a historical race that could have produced duplicate
--    months; fall back to a plain index rather than failing the deploy.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "accountingPeriod_company_fy_period_idx"
    ON "accountingPeriod" ("companyId", "fiscalYear", "periodNumber");
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Duplicate (companyId, fiscalYear, periodNumber) rows exist; creating non-unique index instead';
  CREATE INDEX IF NOT EXISTS "accountingPeriod_company_fy_period_idx"
    ON "accountingPeriod" ("companyId", "fiscalYear", "periodNumber");
END $$;

-- 6. Hard backstop: nothing enters, leaves, or gets posted into a Closed
--    period. Locked-period semantics (who may post) require actor identity and
--    are enforced at the service layer; this trigger only guards the invariant
--    that Closed-period financials never change. Posted → Reversed status flips
--    are intentionally allowed (the offsetting entry lands in an open period).
CREATE OR REPLACE FUNCTION public.check_accounting_period_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_status "periodCloseStatus";
  v_old_status "periodCloseStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'Draft' THEN
      SELECT "closeStatus" INTO v_old_status
      FROM "accountingPeriod"
      WHERE ("id" = OLD."accountingPeriodId")
         OR (OLD."accountingPeriodId" IS NULL
             AND "companyId" = OLD."companyId"
             AND OLD."postingDate" BETWEEN "startDate" AND "endDate")
      LIMIT 1;
      IF v_old_status = 'Closed' THEN
        RAISE EXCEPTION 'Cannot delete journal %: accounting period is closed', OLD."id";
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- Skip UPDATEs that neither move the journal between periods nor post a draft
  IF TG_OP = 'UPDATE'
     AND NEW."postingDate" IS NOT DISTINCT FROM OLD."postingDate"
     AND NEW."accountingPeriodId" IS NOT DISTINCT FROM OLD."accountingPeriodId"
     AND NOT (OLD."status" = 'Draft' AND NEW."status" = 'Posted') THEN
    RETURN NEW;
  END IF;

  -- Moving a journal OUT of a closed period changes closed financials too
  IF TG_OP = 'UPDATE'
     AND (NEW."postingDate" IS DISTINCT FROM OLD."postingDate"
          OR NEW."accountingPeriodId" IS DISTINCT FROM OLD."accountingPeriodId") THEN
    SELECT "closeStatus" INTO v_old_status
    FROM "accountingPeriod"
    WHERE ("id" = OLD."accountingPeriodId")
       OR (OLD."accountingPeriodId" IS NULL
           AND "companyId" = OLD."companyId"
           AND OLD."postingDate" BETWEEN "startDate" AND "endDate")
    LIMIT 1;
    IF v_old_status = 'Closed' THEN
      RAISE EXCEPTION 'Cannot move journal % out of a closed accounting period', OLD."id";
    END IF;
  END IF;

  SELECT "closeStatus" INTO v_new_status
  FROM "accountingPeriod"
  WHERE ("id" = NEW."accountingPeriodId")
     OR (NEW."accountingPeriodId" IS NULL
         AND "companyId" = NEW."companyId"
         AND NEW."postingDate" BETWEEN "startDate" AND "endDate")
  LIMIT 1;

  IF v_new_status = 'Closed' THEN
    RAISE EXCEPTION 'Accounting period is closed for posting date %', NEW."postingDate";
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "journal_check_period_open" ON "journal";
CREATE TRIGGER "journal_check_period_open"
  BEFORE INSERT OR DELETE OR UPDATE OF "postingDate", "accountingPeriodId", "status" ON "journal"
  FOR EACH ROW EXECUTE FUNCTION public.check_accounting_period_open();

-- 7. Posted-record immutability backstop (readiness audit MW-1: SOX AS 2401 /
--    GoBD Unveränderbarkeit). A second SECURITY DEFINER trigger — so it binds
--    edge functions and service-role jobs, not just PostgREST callers — makes
--    posted journals immutable in EVERY period state, not only Closed:
--      * journal: once status = 'Posted', the only permitted UPDATE is the
--        status transition Posted → Reversed (which stamps reversedById). Any
--        other field change, or any other status change, is rejected. DELETE of
--        a Posted or Reversed journal is likewise rejected (it would cascade the
--        lines away); such entries can only be reversed, never removed.
--      * journalLine: all UPDATE/DELETE is rejected once the parent journal has
--        left Draft (Posted or Reversed), in every period state. Lines are only
--        editable while the parent is still a Draft entry.
--    Corrections remain reversal-only. Draft → Posted and Draft-line edits are
--    untouched. One function branches on TG_TABLE_NAME; two triggers attach it.
CREATE OR REPLACE FUNCTION public.check_posted_record_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent_status "journalEntryStatus";
BEGIN
  IF TG_TABLE_NAME = 'journal' THEN
    IF TG_OP = 'DELETE' THEN
      -- A posted (or reversed) journal must never be deleted; a DELETE would
      -- cascade its lines out from under the audit trail. Only the reversing
      -- flow, which UPDATEs Posted -> Reversed, may touch such a journal.
      IF OLD."status" IN ('Posted', 'Reversed') THEN
        RAISE EXCEPTION 'Posted journal % is immutable and cannot be deleted; reverse it instead', OLD."id";
      END IF;
      RETURN OLD;
    END IF;
    IF OLD."status" = 'Posted' AND NEW."status" IS DISTINCT FROM 'Reversed' THEN
      RAISE EXCEPTION 'Posted journal % is immutable; only the Posted -> Reversed transition is permitted', OLD."id";
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'journalLine' THEN
    SELECT "status" INTO v_parent_status FROM "journal" WHERE "id" = OLD."journalId";
    IF v_parent_status IN ('Posted', 'Reversed') THEN
      RAISE EXCEPTION 'Journal line % is immutable because journal % is posted', OLD."id", OLD."journalId";
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "journal_posted_immutable" ON "journal";
CREATE TRIGGER "journal_posted_immutable"
  BEFORE UPDATE OR DELETE ON "journal"
  FOR EACH ROW EXECUTE FUNCTION public.check_posted_record_immutable();

DROP TRIGGER IF EXISTS "journalLine_posted_immutable" ON "journalLine";
CREATE TRIGGER "journalLine_posted_immutable"
  BEFORE UPDATE OR DELETE ON "journalLine"
  FOR EACH ROW EXECUTE FUNCTION public.check_posted_record_immutable();

-- 8. journalLine gains createdBy so every line carries preparer identity from
--    day one of enforced close (nullable: pre-existing lines have no author).
ALTER TABLE "journalLine"
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "journalLine_createdBy_idx" ON "journalLine" ("createdBy");

-- 9. NetSuite-style persisted close checklist: a company-level template of task
--    definitions plus per-period task instances. System definitions (isSystem)
--    seed the nine default close steps and can be deactivated but never deleted.
CREATE TABLE IF NOT EXISTS "periodCloseTaskDefinition" (
  "id" TEXT NOT NULL DEFAULT id('pctd'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taskType" TEXT NOT NULL DEFAULT 'Manual',   -- 'Auto' | 'Action' | 'Manual'
  "autoCheckKey" TEXT,                          -- binds Auto tasks to a readiness evaluator
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "severity" TEXT,                              -- 'Blocker' | 'Warning' (Auto tasks)
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,    -- seeded rows: deactivate, never delete
  "defaultAssigneeId" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "periodCloseTaskDefinition_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "periodCloseTaskDefinition_companyId_name_key" UNIQUE ("companyId", "name"),
  CONSTRAINT "periodCloseTaskDefinition_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "periodCloseTaskDefinition_companyId_idx" ON "periodCloseTaskDefinition" ("companyId");
CREATE INDEX IF NOT EXISTS "periodCloseTaskDefinition_createdBy_idx" ON "periodCloseTaskDefinition" ("createdBy");
CREATE INDEX IF NOT EXISTS "periodCloseTaskDefinition_defaultAssigneeId_idx" ON "periodCloseTaskDefinition" ("defaultAssigneeId");

CREATE TABLE IF NOT EXISTS "periodCloseTask" (
  "id" TEXT NOT NULL DEFAULT id('pct'),
  "companyId" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL,           -- FK accountingPeriod (legacy single-col PK)
  "definitionId" TEXT,                          -- NULL = ad-hoc task added for this period
  "name" TEXT NOT NULL,                         -- snapshot from definition
  "taskType" TEXT NOT NULL,
  "autoCheckKey" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL,
  "severity" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Open',        -- 'Open' | 'Done' | 'Skipped'
  "assigneeId" TEXT REFERENCES "user"("id"),
  "completedBy" TEXT REFERENCES "user"("id"),   -- NULL for system-auto completions
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "skippedReason" TEXT,                         -- required when status = 'Skipped'
  "evidenceJournalId" TEXT,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "periodCloseTask_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "periodCloseTask_period_definition_key" UNIQUE ("companyId", "accountingPeriodId", "definitionId"),
  CONSTRAINT "periodCloseTask_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "periodCloseTask_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId")
    REFERENCES "accountingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "periodCloseTask_definitionId_fkey" FOREIGN KEY ("definitionId", "companyId")
    REFERENCES "periodCloseTaskDefinition"("id", "companyId") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "periodCloseTask_companyId_idx" ON "periodCloseTask" ("companyId");
CREATE INDEX IF NOT EXISTS "periodCloseTask_accountingPeriodId_idx" ON "periodCloseTask" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "periodCloseTask_definitionId_idx" ON "periodCloseTask" ("definitionId", "companyId");
CREATE INDEX IF NOT EXISTS "periodCloseTask_createdBy_idx" ON "periodCloseTask" ("createdBy");
CREATE INDEX IF NOT EXISTS "periodCloseTask_assigneeId_idx" ON "periodCloseTask" ("assigneeId");
CREATE INDEX IF NOT EXISTS "periodCloseTask_completedBy_idx" ON "periodCloseTask" ("completedBy");

-- RLS: four standardized policies gated on accounting_* per conventions.
ALTER TABLE "public"."periodCloseTaskDefinition" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "SELECT" ON "public"."periodCloseTaskDefinition"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "INSERT" ON "public"."periodCloseTaskDefinition"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "UPDATE" ON "public"."periodCloseTaskDefinition"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "DELETE" ON "public"."periodCloseTaskDefinition"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
  );

ALTER TABLE "public"."periodCloseTask" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."periodCloseTask";
CREATE POLICY "SELECT" ON "public"."periodCloseTask"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."periodCloseTask";
CREATE POLICY "INSERT" ON "public"."periodCloseTask"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."periodCloseTask";
CREATE POLICY "UPDATE" ON "public"."periodCloseTask"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."periodCloseTask";
CREATE POLICY "DELETE" ON "public"."periodCloseTask"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
  );

-- Seed the nine default system definitions for every existing company. Idempotent
-- via the (companyId, name) unique key; re-running the migration adds nothing.
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT
  c."id", d."name", d."taskType", d."autoCheckKey", d."sortOrder", d."required", d."severity", true, true, 'system'
FROM "company" c
CROSS JOIN (
  VALUES
    ('Post pending operational documents',          'Auto',   'pending-postings',   1, true,  'Blocker'),
    ('Post or re-date draft journal entries',       'Auto',   'draft-journals',     2, true,  'Blocker'),
    ('Lock the period',                             'Action', NULL,                 3, true,  NULL),
    ('Post depreciation runs covering the period',  'Auto',   'draft-depreciation', 4, true,  'Warning'),
    ('Match & eliminate intercompany transactions', 'Auto',   'unmatched-ic',       5, true,  'Warning'),
    ('Review negative on-hand inventory',           'Auto',   'negative-inventory', 6, true,  'Warning'),
    ('Trial balance in balance for the period',     'Auto',   'tb-balanced',        7, true,  'Blocker'),
    ('Review financial statements',                 'Manual', NULL,                 8, true,  NULL),
    ('Close the period',                            'Action', NULL,                 9, false, NULL)
) AS d("name", "taskType", "autoCheckKey", "sortOrder", "required", "severity")
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
ON CONFLICT ("companyId", "name") DO NOTHING;
