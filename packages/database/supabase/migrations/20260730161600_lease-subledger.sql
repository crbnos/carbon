-- Lease subledger (ASC 842 / IFRS 16) — lessee + lessor.
-- Spec: .ai/specs/2026-07-04-lease-accounting.md
-- Schema foundation (TS consumers ship in a follow-up after `pnpm db:migrate`
-- regenerates types). Modern table style (period-close precedent 20260702044133):
-- id('prefix') PK default, composite PK ("id","companyId"), inline audit FKs,
-- bare NUMERIC (no-numeric-precision conformance gate). RLS SELECT gated on
-- accounting_view to match the fixed-asset subledger sibling.

------------------------------------------------------------------------------
-- 1) Enum types (CREATE TYPE is transaction-safe; value additions to existing
--    enums are in 20260730161500_lease-enums.sql)
------------------------------------------------------------------------------
CREATE TYPE "leaseRole" AS ENUM ('Lessee', 'Lessor');
CREATE TYPE "leaseStatus" AS ENUM ('Draft', 'Active', 'Terminated', 'Expired');
CREATE TYPE "lesseeClassification" AS ENUM ('Operating', 'Finance');
CREATE TYPE "lessorClassification" AS ENUM ('Operating', 'Sales-Type', 'Direct Financing');
CREATE TYPE "leasePaymentFrequency" AS ENUM ('Monthly', 'Quarterly', 'Annual');
CREATE TYPE "leasePaymentTiming" AS ENUM ('Advance', 'Arrears');
CREATE TYPE "leaseEventType" AS ENUM ('Term Change', 'Payment Change', 'Index Change',
  'Option Reassessment', 'Partial Termination', 'Full Termination');
CREATE TYPE "leaseOptionType" AS ENUM ('Renewal', 'Termination', 'Purchase');

------------------------------------------------------------------------------
-- 2) Policy elections on companySettings (IFRS low-value is opt-in; thresholds
--    are ASC 842-10-25-2 classification policy). Bare NUMERIC per conformance.
------------------------------------------------------------------------------
ALTER TABLE "companySettings"
  ADD COLUMN "leaseShortTermExpedientEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "leaseLowValueExpedientEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "leaseLowValueThreshold" NUMERIC NOT NULL DEFAULT 5000,
  ADD COLUMN "leaseMajorPartThresholdPercent" NUMERIC NOT NULL DEFAULT 75,
  ADD COLUMN "leaseSubstantiallyAllThresholdPercent" NUMERIC NOT NULL DEFAULT 90;

------------------------------------------------------------------------------
-- 3) leaseClass — GL mapping (fixedAssetClass pattern; seeded in
--    20260730161700_seed-lease-classes.sql). Lessee accounts NOT NULL; lessor
--    accounts nullable (required only when a lessor lease uses the class).
------------------------------------------------------------------------------
CREATE TABLE "leaseClass" (
  "id" TEXT NOT NULL DEFAULT id('lcls'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rouAssetAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "accumulatedRouAmortizationAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "leaseLiabilityAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "interestExpenseAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "rouAmortizationExpenseAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "operatingLeaseExpenseAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "variableLeaseExpenseAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "leaseClearingAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "leaseIncomeAccountId" TEXT REFERENCES "account"("id"),
  "netInvestmentAccountId" TEXT REFERENCES "account"("id"),
  "interestIncomeAccountId" TEXT REFERENCES "account"("id"),
  "straightLineRentAccountId" TEXT REFERENCES "account"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "leaseClass_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseClass_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseClass_companyId_name_key" UNIQUE ("name", "companyId")
);
CREATE INDEX "leaseClass_companyId_idx" ON "leaseClass" ("companyId");
CREATE INDEX "leaseClass_createdBy_idx" ON "leaseClass" ("createdBy");

------------------------------------------------------------------------------
-- 4) lease — master (both roles). role CHECK enforces counterparty integrity.
------------------------------------------------------------------------------
CREATE TABLE "lease" (
  "id" TEXT NOT NULL DEFAULT id('lse'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "leaseClassId" TEXT NOT NULL,
  "role" "leaseRole" NOT NULL DEFAULT 'Lessee',
  "status" "leaseStatus" NOT NULL DEFAULT 'Draft',
  "name" TEXT NOT NULL,
  "supplierId" TEXT,
  "customerId" TEXT,
  "fixedAssetId" TEXT,
  "locationId" TEXT,
  "commencementDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "discountRate" NUMERIC NOT NULL,
  "paymentFrequency" "leasePaymentFrequency" NOT NULL DEFAULT 'Monthly',
  "paymentTiming" "leasePaymentTiming" NOT NULL DEFAULT 'Arrears',
  "currencyCode" TEXT NOT NULL,
  "initialDirectCosts" NUMERIC NOT NULL DEFAULT 0,
  "incentivesReceived" NUMERIC NOT NULL DEFAULT 0,
  "prepaidAmount" NUMERIC NOT NULL DEFAULT 0,
  "fairValue" NUMERIC,
  "economicLifeMonths" INTEGER,
  "ownershipTransfers" BOOLEAN NOT NULL DEFAULT FALSE,
  "specializedAsset" BOOLEAN NOT NULL DEFAULT FALSE,
  "residualGuaranteed" NUMERIC NOT NULL DEFAULT 0,
  "unguaranteedResidual" NUMERIC NOT NULL DEFAULT 0,
  "lesseeClassification" "lesseeClassification",
  "lessorClassification" "lessorClassification",
  "classificationOverride" BOOLEAN NOT NULL DEFAULT FALSE,
  "classificationOverrideReason" TEXT,
  "isShortTerm" BOOLEAN NOT NULL DEFAULT FALSE,
  "isLowValue" BOOLEAN NOT NULL DEFAULT FALSE,
  "initialLiability" NUMERIC,
  "initialRouAsset" NUMERIC,
  "terminationDate" DATE,
  "terminationGainLoss" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "lease_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "lease_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_leaseClass_fkey" FOREIGN KEY ("leaseClassId", "companyId")
    REFERENCES "leaseClass"("id", "companyId"),
  CONSTRAINT "lease_role_counterparty_check" CHECK (
    ("role" = 'Lessee' AND "customerId" IS NULL) OR
    ("role" = 'Lessor' AND "supplierId" IS NULL)
  ),
  CONSTRAINT "lease_leaseId_key" UNIQUE ("leaseId", "companyId")
);
CREATE INDEX "lease_companyId_idx" ON "lease" ("companyId");
CREATE INDEX "lease_leaseClassId_idx" ON "lease" ("leaseClassId", "companyId");
CREATE INDEX "lease_createdBy_idx" ON "lease" ("createdBy");

------------------------------------------------------------------------------
-- 5) Payment structure + options + variable actuals
------------------------------------------------------------------------------
CREATE TABLE "leasePaymentTerm" (
  "id" TEXT NOT NULL DEFAULT id('lpt'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "amountPerPeriod" NUMERIC NOT NULL,
  "annualEscalationPercent" NUMERIC NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leasePaymentTerm_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leasePaymentTerm_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leasePaymentTerm_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "leasePaymentTerm_companyId_idx" ON "leasePaymentTerm" ("companyId");
CREATE INDEX "leasePaymentTerm_leaseId_idx" ON "leasePaymentTerm" ("leaseId", "companyId");

CREATE TABLE "leaseOption" (
  "id" TEXT NOT NULL DEFAULT id('lop'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "optionType" "leaseOptionType" NOT NULL,
  "exerciseDate" DATE NOT NULL,
  "extensionMonths" INTEGER,
  "optionAmount" NUMERIC,
  "reasonablyCertain" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseOption_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseOption_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseOption_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "leaseOption_companyId_idx" ON "leaseOption" ("companyId");
CREATE INDEX "leaseOption_leaseId_idx" ON "leaseOption" ("leaseId", "companyId");

CREATE TABLE "leaseVariablePayment" (
  "id" TEXT NOT NULL DEFAULT id('lvp'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "paymentDate" DATE NOT NULL,
  "amount" NUMERIC NOT NULL,
  "description" TEXT,
  "leaseRunLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseVariablePayment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseVariablePayment_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseVariablePayment_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "leaseVariablePayment_companyId_idx" ON "leaseVariablePayment" ("companyId");
CREATE INDEX "leaseVariablePayment_leaseId_idx" ON "leaseVariablePayment" ("leaseId", "companyId");

------------------------------------------------------------------------------
-- 6) Effective-interest schedule (both roles; lessor: liability cols = net
--    investment, interestAmount = interest income). Stores both expense
--    patterns so the IFRS-16 generator is a pure reader.
------------------------------------------------------------------------------
CREATE TABLE "leaseScheduleLine" (
  "id" TEXT NOT NULL DEFAULT id('lsl'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
  "superseded" BOOLEAN NOT NULL DEFAULT FALSE,
  "periodDate" DATE NOT NULL,
  "openingLiability" NUMERIC NOT NULL,
  "paymentAmount" NUMERIC NOT NULL,
  "interestAmount" NUMERIC NOT NULL,
  "principalAmount" NUMERIC NOT NULL,
  "closingLiability" NUMERIC NOT NULL,
  "rouAmortizationFinance" NUMERIC NOT NULL,
  "leaseCostOperating" NUMERIC NOT NULL,
  "rouAmortizationOperating" NUMERIC NOT NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "journalId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseScheduleLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseScheduleLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseScheduleLine_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leaseScheduleLine_version_period_key"
    UNIQUE ("leaseId", "companyId", "scheduleVersion", "periodDate")
);
CREATE INDEX "leaseScheduleLine_companyId_idx" ON "leaseScheduleLine" ("companyId");
CREATE INDEX "leaseScheduleLine_leaseId_idx" ON "leaseScheduleLine" ("leaseId", "companyId");

------------------------------------------------------------------------------
-- 7) Remeasurement / modification events
------------------------------------------------------------------------------
CREATE TABLE "leaseEvent" (
  "id" TEXT NOT NULL DEFAULT id('lev'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "eventType" "leaseEventType" NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "revisedDiscountRate" NUMERIC,
  "liabilityBefore" NUMERIC NOT NULL,
  "liabilityAfter" NUMERIC NOT NULL,
  "rouAdjustment" NUMERIC NOT NULL,
  "gainLoss" NUMERIC,
  "newScheduleVersion" INTEGER NOT NULL,
  "notes" TEXT,
  "journalId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseEvent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseEvent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseEvent_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "leaseEvent_companyId_idx" ON "leaseEvent" ("companyId");
CREATE INDEX "leaseEvent_leaseId_idx" ON "leaseEvent" ("leaseId", "companyId");

------------------------------------------------------------------------------
-- 8) Monthly run batch (depreciationRun pattern)
------------------------------------------------------------------------------
CREATE TABLE "leaseRun" (
  "id" TEXT NOT NULL DEFAULT id('lrun'),
  "companyId" TEXT NOT NULL,
  "leaseRunId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseRun_leaseRunId_key" UNIQUE ("leaseRunId", "companyId")
);
CREATE INDEX "leaseRun_companyId_idx" ON "leaseRun" ("companyId");
CREATE INDEX "leaseRun_createdBy_idx" ON "leaseRun" ("createdBy");

CREATE TABLE "leaseRunLine" (
  "id" TEXT NOT NULL DEFAULT id('lrl'),
  "companyId" TEXT NOT NULL,
  "leaseRunId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "leaseScheduleLineId" TEXT,
  "lineType" TEXT NOT NULL CHECK ("lineType" IN
    ('Schedule', 'Variable', 'Short-Term', 'Low-Value', 'Lessor Income', 'Lessor Interest')),
  "amount" NUMERIC NOT NULL,
  "journalId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseRunLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseRunLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseRunLine_leaseRun_fkey" FOREIGN KEY ("leaseRunId", "companyId")
    REFERENCES "leaseRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leaseRunLine_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "leaseRunLine_companyId_idx" ON "leaseRunLine" ("companyId");
CREATE INDEX "leaseRunLine_leaseRunId_idx" ON "leaseRunLine" ("leaseRunId", "companyId");
CREATE INDEX "leaseRunLine_leaseId_idx" ON "leaseRunLine" ("leaseId", "companyId");

------------------------------------------------------------------------------
-- 9) RLS — 4 policies per table. SELECT via accounting_view (fixed-asset
--    subledger parity); writes via accounting_create/update/delete.
------------------------------------------------------------------------------
ALTER TABLE "public"."leaseClass" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseClass" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseClass" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseClass" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseClass" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."lease" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."lease" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."lease" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."lease" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."lease" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leasePaymentTerm" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leasePaymentTerm" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leasePaymentTerm" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leasePaymentTerm" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leasePaymentTerm" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseOption" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseOption" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseOption" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseOption" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseOption" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseVariablePayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseVariablePayment" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseVariablePayment" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseVariablePayment" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseVariablePayment" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseScheduleLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseScheduleLine" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseScheduleLine" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseScheduleLine" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseScheduleLine" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseEvent" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseEvent" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseEvent" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseEvent" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseRun" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseRun" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseRun" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseRun" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

ALTER TABLE "public"."leaseRunLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."leaseRunLine" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[]));
CREATE POLICY "INSERT" ON "public"."leaseRunLine" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."leaseRunLine" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."leaseRunLine" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));

------------------------------------------------------------------------------
-- 10) Sequences (depreciationRun/fixedAsset pattern: seed per existing company)
------------------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'lease', 'Lease', 'LSE', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'leaseRun', 'Lease Run', 'LR', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------
-- 11) GL accounts for existing company groups (fixed-asset seed pattern; leaf
--     accounts parented by group NAME — group accounts carry no number).
--     Lessee interest expense reuses existing 7010; no new account for it.
------------------------------------------------------------------------------
INSERT INTO "account" (
  "number", "name", "isGroup", "accountType", "incomeBalance", "class",
  "parentId", "companyGroupId", "createdBy"
)
SELECT
  v.number, v.name, false,
  v.account_type::"accountType",
  v.income_balance::"glIncomeBalance",
  v.class::"glAccountClass",
  parent."id", cg."id", 'system'
FROM "companyGroup" cg
CROSS JOIN (
  VALUES
    ('1370', 'Right-of-Use Assets',          'Property, Plant & Equipment', 'Fixed Asset',             'Balance Sheet',    'Asset'),
    ('1380', 'Accumulated ROU Amortization',  'Property, Plant & Equipment', 'Accumulated Depreciation', 'Balance Sheet',  'Asset'),
    ('1450', 'Net Investment in Leases',      'Other Assets',                'Other Asset',            'Balance Sheet',    'Asset'),
    ('2180', 'Lease Clearing',                'Current Liabilities',         'Other Current Liability', 'Balance Sheet',   'Liability'),
    ('2190', 'Straight-Line Rent Accrual',    'Current Liabilities',         'Other Current Liability', 'Balance Sheet',   'Liability'),
    ('2440', 'Lease Liability',               'Long-Term Liabilities',       'Long Term Liability',    'Balance Sheet',    'Liability'),
    ('4150', 'Lease Income',                  'Other Income',                'Other Income',           'Income Statement', 'Revenue'),
    ('4160', 'Interest Income on Leases',     'Other Income',                'Other Income',           'Income Statement', 'Revenue'),
    ('6120', 'Operating Lease Expense',       'Operating Expenses',          'Expense',                'Income Statement', 'Expense'),
    ('6130', 'Variable Lease Expense',        'Operating Expenses',          'Expense',                'Income Statement', 'Expense'),
    ('6330', 'ROU Amortization Expense',      'Depreciation & Amortization', 'Other Expense',          'Income Statement', 'Expense')
) AS v("number", "name", parent_name, account_type, income_balance, "class")
-- LEFT JOIN so a leaf account is still created (ungrouped, NULL parentId) when a
-- company group's chart of accounts lacks the expected parent group name. An
-- inner join would silently drop the leaf, which then cascades to
-- 20260730161700 seeding zero lease classes for that tenant (it joins these
-- accounts by number). Mirrors the fixed-asset seed, which inserts with a NULL
-- parent on miss rather than dropping the row.
LEFT JOIN "account" parent
  ON parent."companyGroupId" = cg."id"
  AND parent."name" = v.parent_name
  AND parent."isGroup" = true
ON CONFLICT ("name", "companyGroupId", "isGroup") DO NOTHING;
