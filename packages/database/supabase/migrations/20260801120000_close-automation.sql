-- Close automation (#1039): schema foundation for scheduled depreciation proposals,
-- prepaid-expense amortization, recurring journal templates, and auto-reversing accruals.
-- Spec: .ai/specs/2026-07-04-close-automation.md
--
-- SCOPE: additive schema foundation ONLY. Every TS consumer (accounting services,
-- the `period-close-automation` Inngest job, the `post-purchase-invoice` prepaid
-- branch, the recurring-journals / prepaid-schedules routes + UI, the JE
-- auto-reverse toggle, and the close-checklist evaluators together with their
-- `periodCloseTaskDefinition` registration) lands once `pnpm run generate:types`
-- has regenerated the DB types against a live database. See
-- .ai/plans/2026-07-30-close-automation-1039.md for the execute-ready plan.
--
-- The two new close-checklist definitions are intentionally NOT registered here:
-- a `periodCloseTaskDefinition` row whose `autoCheckKey` has no evaluator fails
-- closed (evaluateCloseChecklist synthesizes a failing check), so registering the
-- rows before their evaluators exist would block period close until skipped. The
-- rows, the computePeriodReadiness `checks[]` entries, and the seed.data.ts array
-- are added together in the TS phase.

-- 1. Additive journal source types -------------------------------------------------
-- Bare ADD VALUE per the established precedent (20260726013204, 20260630093809).
-- Not referenced anywhere else in this migration, so it is transaction-safe.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Prepaid Amortization';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Recurring Journal';

-- 2. Auto-reversing accruals: a nullable flag on the manual JE, set while Draft -----
-- The (autoReverseOn, reversedById) pair fully encodes "pending reversal"; the job
-- posts the mirror via the existing reverseJournalEntry machinery. The CHECK keeps
-- the reversal strictly after the posting date (existing rows have NULL and pass).
ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "autoReverseOn" DATE;
ALTER TABLE "journal" ADD CONSTRAINT "journal_autoReverseOn_check"
  CHECK ("autoReverseOn" IS NULL OR "autoReverseOn" > "postingDate");

-- 3. Depreciation proposal toggle --------------------------------------------------
-- Default on: a Draft run is a deletable, zero-GL-effect proposal; defaulting off
-- would recreate the exact missed-depreciation risk this feature closes (GAP-4.1).
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS
  "depreciationProposalsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- 4. Prepaid flag + straight-line schedule params on AP invoice lines --------------
-- Restricted to 'G/L Account' lines via a dedicated CHECK (leaves the existing
-- multi-branch "invoiceLineType_number" constraint untouched). "invoiceLineType"
-- is of type "payableLineType"; 'G/L Account' is a valid value.
ALTER TABLE "purchaseInvoiceLine"
  ADD COLUMN IF NOT EXISTS "isPrepaid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prepaidStartDate" DATE,
  ADD COLUMN IF NOT EXISTS "prepaidMonths" INTEGER;

ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_prepaid_check"
  CHECK (
    "isPrepaid" IS NOT TRUE
    OR (
      "invoiceLineType" = 'G/L Account'
      AND "prepaidStartDate" IS NOT NULL
      AND "prepaidMonths" IS NOT NULL
      AND "prepaidMonths" > 0
    )
  );

-- 4b. Composite-tenant-FK targets -------------------------------------------------
-- The prepaid schedule below carries source-document ids (purchaseInvoice /
-- purchaseInvoiceLine) and a journal id alongside its own companyId. A single-
-- column FK to journal("id") / purchaseInvoice("id") would let a row in company A
-- reference a parent owned by company B (RLS scopes the row itself, not the parent
-- it points at). To let the database reject that, each composite FK target needs a
-- UNIQUE ("id", "companyId") — id alone is already the PK on all three, so this is
-- trivially unique. Mirrors 20260703143904_composite-tenant-fks.sql (which did the
-- same for customer/supplier). Guarded so re-application is a no-op.
--
-- NOTE: "account" is deliberately excluded. Unlike these tables it has NO
-- companyId column — accounts are scoped by "companyGroupId" and shared across a
-- company group, so a same-company FK is neither possible nor correct. Account
-- references below use a plain account("id") FK, matching the established
-- journalLine.accountId convention (20260703143904 likewise never touched account).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_id_companyId_key' AND conrelid = '"journal"'::regclass
  ) THEN
    ALTER TABLE "journal" ADD CONSTRAINT "journal_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchaseInvoice_id_companyId_key' AND conrelid = '"purchaseInvoice"'::regclass
  ) THEN
    ALTER TABLE "purchaseInvoice" ADD CONSTRAINT "purchaseInvoice_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchaseInvoiceLine_id_companyId_key' AND conrelid = '"purchaseInvoiceLine"'::regclass
  ) THEN
    ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;
END $$;

-- 5. Prepaid schedules (header) ----------------------------------------------------
-- Amounts are base currency (journalLine.amount is already base) so schedules carry
-- no FX exposure. prepaidAccountId is the resolved accountDefault.prepaymentAccount
-- (stored as an account id); expenseAccountId is the amortization target from the
-- source invoice line. The invoice source columns carry composite tenant FKs so a
-- cross-company or non-existent invoice/line can't be linked, but with ON DELETE
-- SET NULL (column-list form, nulling only the source id — companyId is NOT NULL)
-- so the schedule still survives independently of its originating document.
CREATE TABLE IF NOT EXISTS "prepaidSchedule" (
  "id" TEXT NOT NULL DEFAULT id('ppd'),
  "companyId" TEXT NOT NULL,
  "purchaseInvoiceId" TEXT,
  "purchaseInvoiceLineId" TEXT,
  "description" TEXT NOT NULL,
  "prepaidAccountId" TEXT NOT NULL,
  "expenseAccountId" TEXT NOT NULL,
  "totalAmount" NUMERIC NOT NULL,
  "startDate" DATE NOT NULL,
  "months" INTEGER NOT NULL CHECK ("months" > 0),
  "method" TEXT NOT NULL DEFAULT 'Straight Line',
  "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active', 'Complete', 'Cancelled')),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "prepaidSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "prepaidSchedule_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Account references use a plain account("id") FK (account is companyGroup-scoped,
  -- not companyId-scoped — see §4b), matching the journalLine.accountId convention.
  -- RESTRICT: an account backing an active schedule cannot be deleted out from under it.
  CONSTRAINT "prepaidSchedule_prepaidAccountId_fkey" FOREIGN KEY ("prepaidAccountId")
    REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prepaidSchedule_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId")
    REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Composite tenant FKs on the source-document pointers: the invoice/line must
  -- belong to the same company. SET NULL (PG15 column-list form — only the source
  -- id, never the NOT NULL companyId) so deleting the source document leaves the
  -- schedule intact with a nulled pointer.
  CONSTRAINT "prepaidSchedule_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId", "companyId")
    REFERENCES "purchaseInvoice"("id", "companyId") ON DELETE SET NULL ("purchaseInvoiceId") ON UPDATE CASCADE,
  CONSTRAINT "prepaidSchedule_purchaseInvoiceLineId_fkey" FOREIGN KEY ("purchaseInvoiceLineId", "companyId")
    REFERENCES "purchaseInvoiceLine"("id", "companyId") ON DELETE SET NULL ("purchaseInvoiceLineId") ON UPDATE CASCADE
);
CREATE INDEX "prepaidSchedule_companyId_status_idx"
  ON "prepaidSchedule" ("companyId", "status");

ALTER TABLE "public"."prepaidSchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."prepaidSchedule" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."prepaidSchedule" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."prepaidSchedule" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."prepaidSchedule" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 6. Prepaid schedule entries (one precomputed straight-line row per month) ---------
-- journalId is the durable draft-journal association: the job stamps it the moment
-- it drafts the amortization journal (inside the same transaction as the draft),
-- NOT at posting time. That makes the generation idempotent under Inngest retries
-- — the `..._due_idx` partial index (WHERE journalId IS NULL) stops selecting an
-- entry once a draft exists, so a retry never creates a second Draft journal for
-- the same entry. Whether that journal is Posted vs still Draft is read from the
-- journal's own status, not inferred from journalId being NULL. The unique
-- (companyId, scheduleId, amortizationDate) key additionally dedupes entry rows.
CREATE TABLE IF NOT EXISTS "prepaidScheduleEntry" (
  "id" TEXT NOT NULL DEFAULT id('ppde'),
  "companyId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "amortizationDate" DATE NOT NULL,
  "amount" NUMERIC NOT NULL,
  "journalId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "prepaidScheduleEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "prepaidScheduleEntry_schedule_date_key" UNIQUE ("companyId", "scheduleId", "amortizationDate"),
  CONSTRAINT "prepaidScheduleEntry_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prepaidScheduleEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId", "companyId")
    REFERENCES "prepaidSchedule"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Composite tenant FK: only NULL the journalId (not companyId, which is NOT NULL)
  -- when the referenced journal is deleted — PG15 column-list SET NULL form.
  CONSTRAINT "prepaidScheduleEntry_journalId_fkey" FOREIGN KEY ("journalId", "companyId")
    REFERENCES "journal"("id", "companyId") ON DELETE SET NULL ("journalId") ON UPDATE CASCADE
);
CREATE INDEX "prepaidScheduleEntry_companyId_scheduleId_idx"
  ON "prepaidScheduleEntry" ("companyId", "scheduleId");
CREATE INDEX "prepaidScheduleEntry_due_idx"
  ON "prepaidScheduleEntry" ("companyId", "amortizationDate") WHERE "journalId" IS NULL;

ALTER TABLE "public"."prepaidScheduleEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."prepaidScheduleEntry" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."prepaidScheduleEntry" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."prepaidScheduleEntry" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."prepaidScheduleEntry" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 7. Recurring journal templates (header) ------------------------------------------
-- Balance (Σ debits = Σ credits) is validated at save in the service, matching
-- postJournalEntry. The job drafts a journal dated nextRunDate and advances
-- nextRunDate by frequency; passing endDate deactivates the template.
CREATE TABLE IF NOT EXISTS "recurringJournalTemplate" (
  "id" TEXT NOT NULL DEFAULT id('rjt'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'Monthly' CHECK ("frequency" IN ('Monthly', 'Quarterly', 'Annually')),
  "nextRunDate" DATE NOT NULL,
  "endDate" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "recurringJournalTemplate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "recurringJournalTemplate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "recurringJournalTemplate_due_idx"
  ON "recurringJournalTemplate" ("companyId", "nextRunDate") WHERE "active" = true;

ALTER TABLE "public"."recurringJournalTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."recurringJournalTemplate" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."recurringJournalTemplate" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."recurringJournalTemplate" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."recurringJournalTemplate" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- 8. Recurring journal template lines ----------------------------------------------
-- Fixed debit/credit amounts (v1: no formulas/allocations). accountId is stored as
-- an account id, matching journalLine.
CREATE TABLE IF NOT EXISTS "recurringJournalTemplateLine" (
  "id" TEXT NOT NULL DEFAULT id('rjtl'),
  "companyId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "debit" NUMERIC NOT NULL DEFAULT 0,
  "credit" NUMERIC NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "recurringJournalTemplateLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "recurringJournalTemplateLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recurringJournalTemplateLine_templateId_fkey" FOREIGN KEY ("templateId", "companyId")
    REFERENCES "recurringJournalTemplate"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Plain account("id") FK (account is companyGroup-scoped, not companyId-scoped —
  -- see §4b), matching the journalLine.accountId convention.
  CONSTRAINT "recurringJournalTemplateLine_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "recurringJournalTemplateLine_companyId_templateId_idx"
  ON "recurringJournalTemplateLine" ("companyId", "templateId");

ALTER TABLE "public"."recurringJournalTemplateLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."recurringJournalTemplateLine" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."recurringJournalTemplateLine" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."recurringJournalTemplateLine" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."recurringJournalTemplateLine" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
