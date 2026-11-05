-- Government contracting Phase 5a: timekeeping and funding tables.
-- RLS comes from the authz manifest, not from this migration.

-- The users who may charge time to a project with restrictCharging.
CREATE TABLE IF NOT EXISTS "projectMember" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectMember_pkey" PRIMARY KEY ("projectId", "userId", "companyId"),
  CONSTRAINT "projectMember_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "projectMember_companyId_idx" ON "projectMember" ("companyId");
CREATE INDEX IF NOT EXISTS "projectMember_project_idx" ON "projectMember" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectMember_userId_idx" ON "projectMember" ("userId");
CREATE INDEX IF NOT EXISTS "projectMember_createdBy_idx" ON "projectMember" ("createdBy");

-- The DCAA correction trail: one row per change to a saved timesheet entry.
CREATE TABLE IF NOT EXISTS "timesheetEntryRevision" (
  "id" TEXT NOT NULL DEFAULT id('tsr'),
  "companyId" TEXT NOT NULL,
  "timesheetEntryId" TEXT NOT NULL,                  -- no FK: the trail outlives a deleted Draft entry
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "revisedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "revisedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) > 0),
  "before" JSONB,                                    -- null: the entry was created
  "after" JSONB,                                     -- null: the entry was deleted
  CONSTRAINT "timesheetEntryRevision_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetEntryRevision_change_check" CHECK ("before" IS NOT NULL OR "after" IS NOT NULL),
  CONSTRAINT "timesheetEntryRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_entry_idx" ON "timesheetEntryRevision" ("companyId", "timesheetEntryId", "revisedAt");
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_employee_idx" ON "timesheetEntryRevision" ("companyId", "employeeId", "revisedAt");
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_employeeId_idx" ON "timesheetEntryRevision" ("employeeId");
CREATE INDEX IF NOT EXISTS "timesheetEntryRevision_revisedBy_idx" ON "timesheetEntryRevision" ("revisedBy");

-- Weekly certification. No unique key: a re-certified week keeps every row,
-- and the latest row is current.
CREATE TABLE IF NOT EXISTS "timesheetCertification" (
  "id" TEXT NOT NULL DEFAULT id('tsc'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "weekStart" DATE NOT NULL,
  "certifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "textHash" TEXT NOT NULL,
  "flsaStatus" "flsaStatus",
  CONSTRAINT "timesheetCertification_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "timesheetCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "timesheetCertification_week_idx" ON "timesheetCertification" ("companyId", "employeeId", "weekStart", "certifiedAt");
CREATE INDEX IF NOT EXISTS "timesheetCertification_employeeId_idx" ON "timesheetCertification" ("employeeId");

-- Payroll totals per employee and pay period, imported from CSV.
CREATE TABLE IF NOT EXISTS "payrollPeriodTotal" (
  "id" TEXT NOT NULL DEFAULT id('ppt'),
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "grossWages" NUMERIC NOT NULL CHECK ("grossWages" >= 0),
  "hoursPaid" NUMERIC NOT NULL CHECK ("hoursPaid" >= 0),
  "importedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "importedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "payrollPeriodTotal_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "payrollPeriodTotal_period_key" UNIQUE ("employeeId", "periodStart", "periodEnd", "companyId"),
  CONSTRAINT "payrollPeriodTotal_dates_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "payrollPeriodTotal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "payrollPeriodTotal_companyId_idx" ON "payrollPeriodTotal" ("companyId");
CREATE INDEX IF NOT EXISTS "payrollPeriodTotal_importedBy_idx" ON "payrollPeriodTotal" ("importedBy");

-- ACRN funding actions on a contract line (DFARS 204.71).
CREATE TABLE IF NOT EXISTS "customerContractFunding" (
  "id" TEXT NOT NULL DEFAULT id('conf'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "modificationNumber" TEXT NOT NULL,
  "fundedDate" DATE NOT NULL,
  "acrn" TEXT NOT NULL CHECK ("acrn" ~ '^[A-Z0-9]{2}$'),
  "fundedCost" NUMERIC NOT NULL,                     -- negative for a deobligation
  "fundedFee" NUMERIC NOT NULL DEFAULT 0,
  "expiresOn" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractFunding_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractFunding_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractFunding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractFunding_companyId_idx" ON "customerContractFunding" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractFunding_line_idx" ON "customerContractFunding" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractFunding_createdBy_idx" ON "customerContractFunding" ("createdBy");

-- The ACRN allocation of a Cost Plus invoice (PGI 204.7108).
CREATE TABLE IF NOT EXISTS "salesInvoiceFundingAllocation" (
  "id" TEXT NOT NULL DEFAULT id('sifa'),
  "companyId" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL REFERENCES "salesInvoice"("id") ON DELETE CASCADE,
  "customerContractLineId" TEXT NOT NULL,
  "acrn" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "salesInvoiceFundingAllocation_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "salesInvoiceFundingAllocation_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId"),
  CONSTRAINT "salesInvoiceFundingAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "salesInvoiceFundingAllocation_companyId_idx" ON "salesInvoiceFundingAllocation" ("companyId");
CREATE INDEX IF NOT EXISTS "salesInvoiceFundingAllocation_salesInvoiceId_idx" ON "salesInvoiceFundingAllocation" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "salesInvoiceFundingAllocation_line_idx" ON "salesInvoiceFundingAllocation" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "salesInvoiceFundingAllocation_createdBy_idx" ON "salesInvoiceFundingAllocation" ("createdBy");
