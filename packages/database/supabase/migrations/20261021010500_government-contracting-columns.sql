-- Government contracting Phase 5a: columns on existing tables.
-- Every new column defaults to today's behavior. The DCAA controls stay off
-- until companySettings.timekeepingControls = 'DCAA'.

-- Allowability (FAR 31.201-6) and the IPMDAR element of cost of each account.
ALTER TABLE "account"
  ADD COLUMN IF NOT EXISTS "allowability" "accountAllowability" NOT NULL DEFAULT 'Allowable',
  ADD COLUMN IF NOT EXISTS "unallowableReason" TEXT,
  ADD COLUMN IF NOT EXISTS "elementOfCost" "elementOfCost";

-- The cost objective of a project, and charge restrictions to its members.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "costObjective" "projectCostObjective",
  ADD COLUMN IF NOT EXISTS "restrictCharging" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_costObjective_treatment_check";
ALTER TABLE "project" ADD CONSTRAINT "project_costObjective_treatment_check"
  CHECK ("costObjective" IS NULL OR "costTreatment" <> 'Expense' OR "costObjective" IN ('IR&D', 'B&P', 'Indirect'));

-- Element flags: an unallowable branch, preproduction cost, and leave.
ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isUnallowable" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isPreproduction" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isLeave" BOOLEAN NOT NULL DEFAULT FALSE;

-- Timekeeping settings.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "timekeepingControls" "timekeepingControls" NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS "timesheetEntryWindowDays" INTEGER NOT NULL DEFAULT 1 CHECK ("timesheetEntryWindowDays" >= 0),
  ADD COLUMN IF NOT EXISTS "timesheetTimecardCheck" TEXT NOT NULL DEFAULT 'Warn' CHECK ("timesheetTimecardCheck" IN ('Off', 'Warn', 'Block')),
  ADD COLUMN IF NOT EXISTS "certificationTextExempt" TEXT,
  ADD COLUMN IF NOT EXISTS "certificationTextNonExempt" TEXT,
  ADD COLUMN IF NOT EXISTS "standardWeeklyHours" NUMERIC NOT NULL DEFAULT 40 CHECK ("standardWeeklyHours" > 0);

-- Dilution applies to exempt staff.
ALTER TABLE "employeeJob"
  ADD COLUMN IF NOT EXISTS "flsaStatus" "flsaStatus";

-- The late reason, the source of a labor transfer, and the dilution factor that posted.
ALTER TABLE "timesheetEntry"
  ADD COLUMN IF NOT EXISTS "lateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionOfId" TEXT,
  ADD COLUMN IF NOT EXISTS "dilutionFactor" NUMERIC CHECK ("dilutionFactor" > 0 AND "dilutionFactor" <= 1);
ALTER TABLE "timesheetEntry" DROP CONSTRAINT IF EXISTS "timesheetEntry_correctionOf_fkey";
ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_correctionOf_fkey"
  FOREIGN KEY ("correctionOfId", "companyId") REFERENCES "timesheetEntry"("id", "companyId") ON DELETE SET NULL ("correctionOfId");
CREATE INDEX IF NOT EXISTS "timesheetEntry_correctionOfId_idx" ON "timesheetEntry" ("correctionOfId", "companyId");

-- CLIN and SLIN numbers. No unique index: an amendment of a Fixed line copies
-- the number, so the service checks uniqueness among current lines.
ALTER TABLE "customerContractLine"
  ADD COLUMN IF NOT EXISTS "lineItemNumber" TEXT CHECK ("lineItemNumber" ~ '^[0-9]{4}([A-Z]{2}|[0-9]{2})?$'),
  ADD COLUMN IF NOT EXISTS "parentLineId" TEXT;
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_parentLine_fkey";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_parentLine_fkey"
  FOREIGN KEY ("parentLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("parentLineId");
CREATE INDEX IF NOT EXISTS "customerContractLine_parentLineId_idx" ON "customerContractLine" ("parentLineId", "companyId");
