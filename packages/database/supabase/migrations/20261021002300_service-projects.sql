-- Service projects: the project type, the By Coverage treatment, coverage on charges,
-- expense entries, billable items, fixed-price nodes and the parent project.
-- RLS lives in packages/database/src/authz/manifest.ts.
-- Spec: .ai/specs/2026-10-03-projects.md (Service projects)

ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "projectType" "projectType" NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT;
ALTER TABLE "project" ADD CONSTRAINT "project_parent_fkey"
  FOREIGN KEY ("parentProjectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("parentProjectId");
ALTER TABLE "project" ADD CONSTRAINT "project_parent_check"
  CHECK ("parentProjectId" IS NULL OR "parentProjectId" <> "id");
CREATE INDEX IF NOT EXISTS "project_parentProjectId_idx" ON "project" ("parentProjectId", "companyId");

-- A Service project's identifier is its order's readable id (SVC000123).
ALTER TABLE "project" DROP CONSTRAINT "project_identifier_check";
ALTER TABLE "project" ADD CONSTRAINT "project_identifier_check"
  CHECK ("identifier" IS NULL OR "projectType" = 'Service' OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$');
ALTER TABLE "project" ADD CONSTRAINT "project_service_treatment_check"
  CHECK (("projectType" = 'Service') = ("costTreatment" = 'By Coverage'));

-- Bill this node's whole subtree as one invoice line at this price.
ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "fixedPrice" NUMERIC
  CHECK ("fixedPrice" IS NULL OR "fixedPrice" >= 0);

-- Coverage on every charge of a Service project. The visit FK is added with "serviceVisit".
ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "coverage" "serviceCoverage",
  ADD COLUMN IF NOT EXISTS "coverageReason" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceVisitId" TEXT;
ALTER TABLE "projectLedger"
  ADD COLUMN IF NOT EXISTS "coverage" "serviceCoverage",
  ADD COLUMN IF NOT EXISTS "coverageReason" TEXT;

-- An amount with no card charge or invoice, for example mileage.
-- Posts Dr the treatment's account / Cr goodsReceivedNotInvoicedAccount.
CREATE TABLE IF NOT EXISTS "projectExpenseEntry" (
  "id" TEXT NOT NULL DEFAULT id('pjx'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- null = the project itself
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "entryDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL CHECK ("amount" <> 0),   -- negative only on a reversal
  "coverage" "serviceCoverage",
  "coverageReason" TEXT,
  "serviceVisitId" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "reversalOfId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectExpenseEntry_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectExpenseEntry_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectExpenseEntry_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectExpenseEntry_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "projectExpenseEntry"("id", "companyId"),
  CONSTRAINT "projectExpenseEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectExpenseEntry_companyId_idx" ON "projectExpenseEntry" ("companyId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_projectId_idx" ON "projectExpenseEntry" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_projectElementId_idx" ON "projectExpenseEntry" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_employeeId_idx" ON "projectExpenseEntry" ("employeeId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_serviceVisitId_idx" ON "projectExpenseEntry" ("serviceVisitId", "companyId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_journalId_idx" ON "projectExpenseEntry" ("journalId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_reversalOfId_idx" ON "projectExpenseEntry" ("reversalOfId", "companyId");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_createdBy_idx" ON "projectExpenseEntry" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectExpenseEntry_updatedBy_idx" ON "projectExpenseEntry" ("updatedBy");

CREATE INDEX IF NOT EXISTS "timesheetEntry_serviceVisitId_idx" ON "timesheetEntry" ("serviceVisitId", "companyId");

-- The billing row of a charge: one per projectLedger row of a Service project
-- (and, in Phase 4, of a Contract project under a billing element).
CREATE TABLE IF NOT EXISTS "projectBillableItem" (
  "id" TEXT NOT NULL DEFAULT id('pbi'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectElementId" TEXT,
  "projectLedgerId" TEXT NOT NULL,
  "customerContractLineId" TEXT,                     -- projects Phase 4
  "itemId" TEXT REFERENCES "item"("id"),
  "description" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,                      -- 0 when covered or inside a fixed-price node
  "amount" NUMERIC NOT NULL,
  "coverage" "serviceCoverage",
  "status" "projectBillableItemStatus" NOT NULL DEFAULT 'Unbilled',
  "statusReason" TEXT,
  "reversalOfId" TEXT,
  "salesInvoiceLineId" TEXT,                         -- stamp
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectBillableItem_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectBillableItem_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "projectBillableItem_element_fkey" FOREIGN KEY ("projectElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId"),
  CONSTRAINT "projectBillableItem_ledger_fkey" FOREIGN KEY ("projectLedgerId", "companyId") REFERENCES "projectLedger"("id", "companyId"),
  CONSTRAINT "projectBillableItem_contractLine_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("customerContractLineId"),
  CONSTRAINT "projectBillableItem_reversal_fkey" FOREIGN KEY ("reversalOfId", "companyId") REFERENCES "projectBillableItem"("id", "companyId"),
  -- salesInvoiceLine has a single-column primary key.
  CONSTRAINT "projectBillableItem_invoiceLine_fkey" FOREIGN KEY ("salesInvoiceLineId") REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
  CONSTRAINT "projectBillableItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "projectBillableItem_ledger_key" ON "projectBillableItem" ("projectLedgerId", "companyId") WHERE "reversalOfId" IS NULL;
CREATE INDEX IF NOT EXISTS "projectBillableItem_unbilled_idx" ON "projectBillableItem" ("companyId", "projectId") WHERE "status" = 'Unbilled';
CREATE INDEX IF NOT EXISTS "projectBillableItem_invoiceLine_idx" ON "projectBillableItem" ("salesInvoiceLineId") WHERE "salesInvoiceLineId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "projectBillableItem_companyId_idx" ON "projectBillableItem" ("companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_projectId_idx" ON "projectBillableItem" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_projectElementId_idx" ON "projectBillableItem" ("projectElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_projectLedgerId_idx" ON "projectBillableItem" ("projectLedgerId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_customerContractLineId_idx" ON "projectBillableItem" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_itemId_idx" ON "projectBillableItem" ("itemId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_reversalOfId_idx" ON "projectBillableItem" ("reversalOfId", "companyId");
CREATE INDEX IF NOT EXISTS "projectBillableItem_createdBy_idx" ON "projectBillableItem" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectBillableItem_updatedBy_idx" ON "projectBillableItem" ("updatedBy");
