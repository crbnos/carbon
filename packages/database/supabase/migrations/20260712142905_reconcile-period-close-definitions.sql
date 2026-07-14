-- Restore the period-close checklist tables (and the posted-record immutability
-- infra) that never reached prod, then reconcile the checklist definitions.
--
-- Why the tables can be missing: the checklist tables + immutability trigger +
-- journalLine.createdBy originally shipped in 20260711203911. A later merge
-- folded that content into 20260702044133 and deleted 20260711203911. Any
-- environment that had already applied 20260702044133 in its pre-merge form is
-- NOT re-run for the modified file (migrations are tracked by version), so it
-- never gets those objects. This migration recreates them idempotently — a
-- no-op where they already exist (e.g. dev), a create where they don't (prod) —
-- so the reconcile below always has tables to work on.
--
-- Every statement here is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP
-- POLICY IF EXISTS), so the deploy runner can safely re-run the whole file over
-- a committed partial state.

-- ==========================================================================
-- Part 1 — ensure the checklist tables + immutability infra exist
-- (verbatim, idempotent DDL from 20260702044133; safe no-op where present)
-- ==========================================================================

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

ALTER TABLE "journalLine"
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "journalLine_createdBy_idx" ON "journalLine" ("createdBy");

CREATE TABLE IF NOT EXISTS "periodCloseTaskDefinition" (
  "id" TEXT NOT NULL DEFAULT id('pctd'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taskType" TEXT NOT NULL DEFAULT 'Manual',
  "autoCheckKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "severity" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
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
  "accountingPeriodId" TEXT NOT NULL,
  "definitionId" TEXT,
  "name" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "autoCheckKey" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL,
  "severity" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "assigneeId" TEXT REFERENCES "user"("id"),
  "completedBy" TEXT REFERENCES "user"("id"),
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "skippedReason" TEXT,
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

ALTER TABLE "public"."periodCloseTaskDefinition" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "SELECT" ON "public"."periodCloseTaskDefinition"
  FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "INSERT" ON "public"."periodCloseTaskDefinition"
  FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "UPDATE" ON "public"."periodCloseTaskDefinition"
  FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."periodCloseTaskDefinition";
CREATE POLICY "DELETE" ON "public"."periodCloseTaskDefinition"
  FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."periodCloseTask" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."periodCloseTask";
CREATE POLICY "SELECT" ON "public"."periodCloseTask"
  FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
DROP POLICY IF EXISTS "INSERT" ON "public"."periodCloseTask";
CREATE POLICY "INSERT" ON "public"."periodCloseTask"
  FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
DROP POLICY IF EXISTS "UPDATE" ON "public"."periodCloseTask";
CREATE POLICY "UPDATE" ON "public"."periodCloseTask"
  FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
DROP POLICY IF EXISTS "DELETE" ON "public"."periodCloseTask";
CREATE POLICY "DELETE" ON "public"."periodCloseTask"
  FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

-- ==========================================================================
-- Part 2 — reconcile the checklist definitions to the current 8-task set
-- ==========================================================================
-- 20260702044133 seeded the original 9-task set; this branch dropped "Close the
-- period" and reclassified "Review negative on-hand inventory" and "Review
-- financial statements" to manual Action tasks. Wipe-and-reseed (not an
-- ON CONFLICT upsert) so it's idempotent and needs no unique-constraint match.
-- No real company has GL postings yet, so instantiated tasks carry no state.

DELETE FROM "periodCloseTask";

DELETE FROM "periodCloseTaskDefinition"
WHERE "isSystem" = true
  OR "name" IN (
    'Post pending operational documents',
    'Post or re-date draft journal entries',
    'Lock the period',
    'Post depreciation runs covering the period',
    'Match & eliminate intercompany transactions',
    'Review negative on-hand inventory',
    'Trial balance in balance for the period',
    'Review financial statements'
  );

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
    ('Review negative on-hand inventory',           'Action', NULL,                 6, true,  NULL),
    ('Trial balance in balance for the period',     'Auto',   'tb-balanced',        7, true,  'Blocker'),
    ('Review financial statements',                 'Action', NULL,                 8, true,  NULL)
) AS d("name", "taskType", "autoCheckKey", "sortOrder", "required", "severity")
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system');
