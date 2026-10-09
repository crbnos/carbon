-- Time and the project ledger: labor categories and their rates, labor plan lines,
-- timesheet entries, the project ledger, charge numbers on documents, and the
-- project account defaults and settings.
-- RLS lives in packages/database/src/authz/manifest.ts.
-- Spec: .ai/specs/2026-10-03-projects.md (Charging: the five entry points; Cost treatment)

CREATE TYPE "projectCostType" AS ENUM ('Material', 'Labor', 'Machine', 'Overhead',
  'Outside Processing', 'Purchased Service', 'Other Direct', 'Material Variance',
  'Payback Variance', 'Burden');
CREATE TYPE "timesheetEntryStatus" AS ENUM ('Draft', 'Submitted', 'Approved', 'Posted', 'Rejected');

CREATE TABLE IF NOT EXISTS "laborCategory" (
  "id" TEXT NOT NULL DEFAULT id('lbc'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "laborCategory_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "laborCategory_name_key" UNIQUE ("companyId", "name"),
  CONSTRAINT "laborCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "laborCategory_companyId_idx" ON "laborCategory" ("companyId");
CREATE INDEX IF NOT EXISTS "laborCategory_createdBy_idx" ON "laborCategory" ("createdBy");
CREATE INDEX IF NOT EXISTS "laborCategory_updatedBy_idx" ON "laborCategory" ("updatedBy");

CREATE TABLE IF NOT EXISTS "laborCategoryRate" (
  "id" TEXT NOT NULL DEFAULT id('lbr'),
  "companyId" TEXT NOT NULL,
  "laborCategoryId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "costRate" NUMERIC NOT NULL CHECK ("costRate" >= 0),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "laborCategoryRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "laborCategoryRate_effective_key" UNIQUE ("laborCategoryId", "effectiveFrom", "companyId"),
  CONSTRAINT "laborCategoryRate_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "laborCategoryRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "laborCategoryRate_companyId_idx" ON "laborCategoryRate" ("companyId");
CREATE INDEX IF NOT EXISTS "laborCategoryRate_laborCategoryId_idx" ON "laborCategoryRate" ("laborCategoryId", "companyId");
CREATE INDEX IF NOT EXISTS "laborCategoryRate_createdBy_idx" ON "laborCategoryRate" ("createdBy");
CREATE INDEX IF NOT EXISTS "laborCategoryRate_updatedBy_idx" ON "laborCategoryRate" ("updatedBy");

ALTER TABLE "employeeJob" ADD COLUMN IF NOT EXISTS "laborCategoryId" TEXT;
ALTER TABLE "employeeJob" ADD CONSTRAINT "employeeJob_laborCategory_fkey"
  FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId") ON DELETE SET NULL ("laborCategoryId");
CREATE INDEX IF NOT EXISTS "employeeJob_laborCategoryId_idx" ON "employeeJob" ("laborCategoryId", "companyId");

CREATE TABLE IF NOT EXISTS "projectElementLabor" (
  "id" TEXT NOT NULL DEFAULT id('pjr'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT NOT NULL,
  "laborCategoryId" TEXT NOT NULL,
  "hours" NUMERIC NOT NULL CHECK ("hours" > 0),
  "startDate" DATE,
  "endDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementLabor_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementLabor_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLabor_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId"),
  CONSTRAINT "projectElementLabor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectElementLabor_companyId_idx" ON "projectElementLabor" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabor_projectElementId_idx" ON "projectElementLabor" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabor_projectId_idx" ON "projectElementLabor" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabor_laborCategoryId_idx" ON "projectElementLabor" ("laborCategoryId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLabor_createdBy_idx" ON "projectElementLabor" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElementLabor_updatedBy_idx" ON "projectElementLabor" ("updatedBy");

CREATE TABLE IF NOT EXISTS "timesheetEntry" (
  "id" TEXT NOT NULL DEFAULT id('tse'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "entryDate" DATE NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- null = the project itself
  "laborCategoryId" TEXT NOT NULL,
  "hours" NUMERIC NOT NULL CHECK ("hours" <> 0),     -- negative only on a reversal
  "note" TEXT,
  "status" "timesheetEntryStatus" NOT NULL DEFAULT 'Draft',
  "submittedAt" TIMESTAMP WITH TIME ZONE,
  "approvedBy" TEXT REFERENCES "user"("id"),
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "rejectionNote" TEXT,
  "costRate" NUMERIC,
  "reversalOfId" TEXT,
  "correctionReason" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "timesheetEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetEntry_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "timesheetEntry_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "timesheetEntry_category_fkey" FOREIGN KEY ("laborCategoryId", "companyId") REFERENCES "laborCategory"("id", "companyId"),
  CONSTRAINT "timesheetEntry_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "timesheetEntry"("id", "companyId"),
  CONSTRAINT "timesheetEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "timesheetEntry_correction_check" CHECK ("reversalOfId" IS NULL OR "correctionReason" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "timesheetEntry_employee_date_idx" ON "timesheetEntry" ("companyId", "employeeId", "entryDate");

CREATE INDEX IF NOT EXISTS "timesheetEntry_companyId_idx" ON "timesheetEntry" ("companyId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_employeeId_idx" ON "timesheetEntry" ("employeeId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_projectId_idx" ON "timesheetEntry" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_projectElementId_idx" ON "timesheetEntry" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_laborCategoryId_idx" ON "timesheetEntry" ("laborCategoryId", "companyId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_approvedBy_idx" ON "timesheetEntry" ("approvedBy");
CREATE INDEX IF NOT EXISTS "timesheetEntry_reversalOfId_idx" ON "timesheetEntry" ("reversalOfId", "companyId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_journalId_idx" ON "timesheetEntry" ("journalId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_createdBy_idx" ON "timesheetEntry" ("createdBy");
CREATE INDEX IF NOT EXISTS "timesheetEntry_updatedBy_idx" ON "timesheetEntry" ("updatedBy");

CREATE TABLE IF NOT EXISTS "projectLedger" (
  "id" TEXT NOT NULL DEFAULT id('pjl'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- null = the project itself
  "postingDate" DATE NOT NULL,
  "costType" "projectCostType" NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "jobId" TEXT,
  "itemId" TEXT,
  "employeeId" TEXT,
  "laborCategoryId" TEXT,
  "supplierId" TEXT,
  "quantity" NUMERIC,
  "unitOfMeasureCode" TEXT,
  "amount" NUMERIC NOT NULL,
  "journalLineId" TEXT,
  "reversalOfId" TEXT,
  "unallowable" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectLedger_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectLedger_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectLedger_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectLedger_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "projectLedger"("id", "companyId"),
  CONSTRAINT "projectLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "projectLedger_element_idx" ON "projectLedger" ("companyId", "projectId", "projectElementId", "postingDate");
CREATE INDEX IF NOT EXISTS "projectLedger_document_idx" ON "projectLedger" ("companyId", "documentType", "documentId");

CREATE INDEX IF NOT EXISTS "projectLedger_companyId_idx" ON "projectLedger" ("companyId");
CREATE INDEX IF NOT EXISTS "projectLedger_projectId_idx" ON "projectLedger" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectLedger_projectElementId_idx" ON "projectLedger" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectLedger_reversalOfId_idx" ON "projectLedger" ("reversalOfId", "companyId");
CREATE INDEX IF NOT EXISTS "projectLedger_createdBy_idx" ON "projectLedger" ("createdBy");

-- Charge numbers on documents. The composite FK makes a mismatched project/element pair impossible.
ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "consumeToProject" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "job"
  ADD CONSTRAINT "job_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "job_projectElement_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  ADD CONSTRAINT "job_consumeToProject_check" CHECK (NOT "consumeToProject" OR "projectId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "job_projectId_idx" ON "job" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "job_projectElementId_idx" ON "job" ("projectElementId", "projectId", "companyId");

ALTER TABLE "purchaseOrderLine"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "purchaseOrderLine"
  ADD CONSTRAINT "purchaseOrderLine_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "purchaseOrderLine_projectElement_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_projectId_idx" ON "purchaseOrderLine" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_projectElementId_idx" ON "purchaseOrderLine" ("projectElementId", "projectId", "companyId");

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_projectElementId_idx" ON "purchaseInvoiceLine" ("projectElementId", "projectId", "companyId");

ALTER TABLE "chargeLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "chargeLine" ADD CONSTRAINT "chargeLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "chargeLine_projectElementId_idx" ON "chargeLine" ("projectElementId", "projectId", "companyId");

ALTER TABLE "reimbursementLine" ADD COLUMN IF NOT EXISTS "projectElementId" TEXT;
ALTER TABLE "reimbursementLine" ADD CONSTRAINT "reimbursementLine_projectElement_fkey"
  FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "reimbursementLine_projectElementId_idx" ON "reimbursementLine" ("projectElementId", "projectId", "companyId");

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "projectExpenseAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "projectWorkInProgressAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "accountDefault_projectExpenseAccount_idx" ON "accountDefault" ("projectExpenseAccount");
CREATE INDEX IF NOT EXISTS "accountDefault_projectWorkInProgressAccount_idx" ON "accountDefault" ("projectWorkInProgressAccount");

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "timesheetApprovalRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "requireProjectElement" BOOLEAN NOT NULL DEFAULT FALSE;
