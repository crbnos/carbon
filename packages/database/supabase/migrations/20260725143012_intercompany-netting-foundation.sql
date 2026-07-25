-- Intercompany Maturity — Workstream 4 (Netting), data-model foundation
--
-- Follow-up to 20260724100357_intercompany-maturity-matching.sql (matching +
-- FX). This migration lands the netting workbench's data model only; the
-- statement-lifecycle RPCs, the accounting service functions, and the workbench
-- UI are the next step (they reference these new tables/columns in TypeScript, so
-- they ship together with regenerated @carbon/database types once applied).
--
-- Grounded in:
--   * 20260403120000_intercompany-tracking.sql  — the group-scoped
--     intercompanyTransaction table + its RLS shape (source-OR-target company via
--     accounting_*), mirrored here for the two new group-level tables.
--   * 20260724100357_intercompany-maturity-matching.sql — the seed/backfill
--     pattern for a per-group control account resolved into accountDefault by id.
--   * 20260630093809_ar-ap-payments.sql — payment / invoiceSettlement machinery
--     the settlement step will ride; here we only add payment.nettingStatementId
--     as the audit back-reference.
--
-- Spec: .ai/specs/2026-07-04-intercompany-maturity.md (§"Data Model Changes",
-- workstream 4). NUMERIC columns are bare (no precision) per repo convention.

------------------------------------------------------------------------------
-- 1. Account defaults: Intercompany Netting Clearing control account (by id)
--    Companion to intercompanyDifferenceAccount from the matching migration.
------------------------------------------------------------------------------

ALTER TABLE "accountDefault"
  ADD COLUMN "intercompanyNettingAccount" TEXT;

ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_intercompanyNettingAccount_fkey"
  FOREIGN KEY ("intercompanyNettingAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

COMMENT ON COLUMN "accountDefault"."intercompanyNettingAccount"
  IS 'Clearing account for intercompany netting settlements. Paired gross payments debit and credit it to net zero cash within each company. Resolved by id.';

-- Seed a "1135 Intercompany Netting Clearing" current-asset account per company
-- group that lacks it, parenting under the "Receivables" group header (sibling of
-- 1130 Inter-Company Receivables). Group headers carry a NULL number, so resolve
-- the parent by isGroup + name + class, never by number (the 20260702192816
-- group-header lesson). Mirrors the 7095 seed in the matching migration.
INSERT INTO "account" (
  "number", "name", "isGroup", "accountType", "incomeBalance", "class",
  "consolidatedRate", "parentId", "isSystem", "companyGroupId", "createdBy"
)
SELECT
  '1135',
  'Intercompany Netting Clearing',
  false,
  'Other Current Asset'::"accountType",
  'Balance Sheet'::"glIncomeBalance",
  'Asset'::"glAccountClass",
  'Current'::"glConsolidatedRate",
  parent."id",
  false,
  cg."id",
  'system'
FROM "companyGroup" cg
JOIN "account" parent
  ON parent."companyGroupId" = cg."id"
  AND parent."isGroup" = true
  AND parent."name" = 'Receivables'
  AND parent."class" = 'Asset'
WHERE NOT EXISTS (
  SELECT 1 FROM "account" a
  WHERE a."companyGroupId" = cg."id"
    AND a."number" = '1135'
);

-- Resolve into accountDefault by the seeded number; authoritative by id
-- thereafter. Left NULLABLE with no fallback: a group with a customized COA
-- lacking this account keeps it unset, and the settlement path then raises an
-- explicit error rather than posting to the wrong clearing account. Groups that
-- never net simply never need it.
UPDATE "accountDefault" ad
SET "intercompanyNettingAccount" = a."id"
FROM "account" a
JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId"
  AND a."number" = '1135'
  AND a."isGroup" = false
  AND ad."intercompanyNettingAccount" IS NULL;

------------------------------------------------------------------------------
-- 2. Netting statement + lines (group-level: intercompanyTransaction precedent)
--    Cross-company rows can't carry a single companyId, so — like
--    intercompanyTransaction — these use a single-column PK, companyGroupId, and
--    explicit company columns rather than the standard composite-PK template.
------------------------------------------------------------------------------

CREATE TABLE "intercompanyNettingStatement" (
  "id" TEXT NOT NULL DEFAULT id('icns'),
  "statementId" TEXT NOT NULL,                     -- readable, sequence-assigned per group
  "companyGroupId" TEXT NOT NULL,
  "companyAId" TEXT NOT NULL,
  "companyBId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "nettedAmount" NUMERIC NOT NULL,
  "residualAmount" NUMERIC NOT NULL DEFAULT 0,
  "residualPayerCompanyId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "settlementDate" DATE,
  "proposedBy" TEXT,
  "proposedAt" TIMESTAMP WITH TIME ZONE,
  "agreedBy" TEXT,
  "agreedAt" TIMESTAMP WITH TIME ZONE,
  "settledBy" TEXT,
  "settledAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "intercompanyNettingStatement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intercompanyNettingStatement_statementId_group_key"
    UNIQUE ("statementId", "companyGroupId"),
  CONSTRAINT "intercompanyNettingStatement_nettedAmount_check"
    CHECK ("nettedAmount" > 0),
  CONSTRAINT "intercompanyNettingStatement_distinct_companies_check"
    CHECK ("companyAId" <> "companyBId"),
  CONSTRAINT "intercompanyNettingStatement_status_check"
    CHECK ("status" IN ('Draft', 'Proposed', 'Agreed', 'Settled', 'Exception', 'Cancelled')),
  CONSTRAINT "intercompanyNettingStatement_companyGroupId_fkey"
    FOREIGN KEY ("companyGroupId") REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyNettingStatement_companyAId_fkey"
    FOREIGN KEY ("companyAId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyNettingStatement_companyBId_fkey"
    FOREIGN KEY ("companyBId") REFERENCES "company"("id"),
  CONSTRAINT "intercompanyNettingStatement_residualPayerCompanyId_fkey"
    FOREIGN KEY ("residualPayerCompanyId") REFERENCES "company"("id"),
  -- currencyCode is a bare TEXT (no FK), matching the group-scoped
  -- intercompanyTransaction precedent: a two-company row can't reference the
  -- per-company currency(code, companyId) table.
  CONSTRAINT "intercompanyNettingStatement_proposedBy_fkey"
    FOREIGN KEY ("proposedBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyNettingStatement_agreedBy_fkey"
    FOREIGN KEY ("agreedBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyNettingStatement_settledBy_fkey"
    FOREIGN KEY ("settledBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyNettingStatement_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "intercompanyNettingStatement_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "intercompanyNettingStatement_companyGroupId_idx"
  ON "intercompanyNettingStatement" ("companyGroupId");
CREATE INDEX "intercompanyNettingStatement_companies_idx"
  ON "intercompanyNettingStatement" ("companyAId", "companyBId");
CREATE INDEX "intercompanyNettingStatement_status_idx"
  ON "intercompanyNettingStatement" ("status", "companyGroupId");
CREATE INDEX "intercompanyNettingStatement_createdBy_idx"
  ON "intercompanyNettingStatement" ("createdBy");

CREATE TABLE "intercompanyNettingStatementLine" (
  "id" TEXT NOT NULL DEFAULT id('icnl'),
  "statementId" TEXT NOT NULL,                     -- FK to the statement (id), not the readable number
  "companyId" TEXT NOT NULL,                        -- whose book this open item sits in
  "salesInvoiceId" TEXT,
  "purchaseInvoiceId" TEXT,
  "openAmount" NUMERIC NOT NULL,
  "appliedAmount" NUMERIC NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "intercompanyNettingStatementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intercompanyNettingStatementLine_appliedAmount_check"
    CHECK ("appliedAmount" >= 0),
  CONSTRAINT "intercompanyNettingStatementLine_one_target_check"
    CHECK ((("salesInvoiceId" IS NOT NULL)::int + ("purchaseInvoiceId" IS NOT NULL)::int) = 1),
  CONSTRAINT "intercompanyNettingStatementLine_statementId_fkey"
    FOREIGN KEY ("statementId") REFERENCES "intercompanyNettingStatement"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyNettingStatementLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "intercompanyNettingStatementLine_salesInvoiceId_fkey"
    FOREIGN KEY ("salesInvoiceId") REFERENCES "salesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "intercompanyNettingStatementLine_purchaseInvoiceId_fkey"
    FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "intercompanyNettingStatementLine_statementId_idx"
  ON "intercompanyNettingStatementLine" ("statementId");
CREATE INDEX "intercompanyNettingStatementLine_companyId_idx"
  ON "intercompanyNettingStatementLine" ("companyId");
CREATE INDEX "intercompanyNettingStatementLine_salesInvoiceId_idx"
  ON "intercompanyNettingStatementLine" ("salesInvoiceId") WHERE "salesInvoiceId" IS NOT NULL;
CREATE INDEX "intercompanyNettingStatementLine_purchaseInvoiceId_idx"
  ON "intercompanyNettingStatementLine" ("purchaseInvoiceId") WHERE "purchaseInvoiceId" IS NOT NULL;

------------------------------------------------------------------------------
-- 3. Payment back-reference for the settlement audit trail
------------------------------------------------------------------------------

ALTER TABLE "payment"
  ADD COLUMN "nettingStatementId" TEXT
  REFERENCES "intercompanyNettingStatement"("id") ON DELETE RESTRICT;

CREATE INDEX "payment_nettingStatementId_idx"
  ON "payment" ("nettingStatementId") WHERE "nettingStatementId" IS NOT NULL;

------------------------------------------------------------------------------
-- 4. Readable statement numbering (per company; the initiating companyA supplies
--    the sequence). Seed existing companies; new companies are seeded via
--    seed.data.ts. Mirrors the payment-sequence backfill in the AR/AP migration.
------------------------------------------------------------------------------

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'intercompanyNettingStatement', 'IC Netting Statement', 'ICNS-%{yyyy}-', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------
-- 5. RLS — mirror the intercompanyTransaction policy shape exactly: either
--    company's accountants (source OR target) may view/manage, gated on
--    accounting_create / accounting_update / accounting_delete. The netting
--    tables are group-scoped, so this is the correct cross-company visibility
--    rule (the standard companyId = get_companies_with_employee_role() template
--    does not apply to a two-company row).
------------------------------------------------------------------------------

ALTER TABLE "intercompanyNettingStatement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompanyNettingStatement_select_policy"
  ON "intercompanyNettingStatement" FOR SELECT USING (
    "companyAId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "companyBId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyNettingStatement_insert_policy"
  ON "intercompanyNettingStatement" FOR INSERT WITH CHECK (
    "companyAId" = ANY (get_companies_with_employee_permission('accounting_create'))
    OR "companyBId" = ANY (get_companies_with_employee_permission('accounting_create'))
  );

CREATE POLICY "intercompanyNettingStatement_update_policy"
  ON "intercompanyNettingStatement" FOR UPDATE USING (
    "companyAId" = ANY (get_companies_with_employee_permission('accounting_update'))
    OR "companyBId" = ANY (get_companies_with_employee_permission('accounting_update'))
  );

CREATE POLICY "intercompanyNettingStatement_delete_policy"
  ON "intercompanyNettingStatement" FOR DELETE USING (
    "companyAId" = ANY (get_companies_with_employee_permission('accounting_delete'))
    OR "companyBId" = ANY (get_companies_with_employee_permission('accounting_delete'))
  );

-- Lines inherit the parent statement's cross-company visibility via EXISTS on
-- companyAId/companyBId (not the line's own single companyId), so the
-- counterparty company's accountants can see both sides of the statement.
ALTER TABLE "intercompanyNettingStatementLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompanyNettingStatementLine_select_policy"
  ON "intercompanyNettingStatementLine" FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "intercompanyNettingStatement" s
      WHERE s."id" = "intercompanyNettingStatementLine"."statementId"
        AND (
          s."companyAId" = ANY (get_companies_with_employee_permission('accounting_create'))
          OR s."companyBId" = ANY (get_companies_with_employee_permission('accounting_create'))
        )
    )
  );

CREATE POLICY "intercompanyNettingStatementLine_insert_policy"
  ON "intercompanyNettingStatementLine" FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "intercompanyNettingStatement" s
      WHERE s."id" = "intercompanyNettingStatementLine"."statementId"
        AND (
          s."companyAId" = ANY (get_companies_with_employee_permission('accounting_create'))
          OR s."companyBId" = ANY (get_companies_with_employee_permission('accounting_create'))
        )
    )
  );

CREATE POLICY "intercompanyNettingStatementLine_update_policy"
  ON "intercompanyNettingStatementLine" FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "intercompanyNettingStatement" s
      WHERE s."id" = "intercompanyNettingStatementLine"."statementId"
        AND (
          s."companyAId" = ANY (get_companies_with_employee_permission('accounting_update'))
          OR s."companyBId" = ANY (get_companies_with_employee_permission('accounting_update'))
        )
    )
  );

CREATE POLICY "intercompanyNettingStatementLine_delete_policy"
  ON "intercompanyNettingStatementLine" FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM "intercompanyNettingStatement" s
      WHERE s."id" = "intercompanyNettingStatementLine"."statementId"
        AND (
          s."companyAId" = ANY (get_companies_with_employee_permission('accounting_delete'))
          OR s."companyBId" = ANY (get_companies_with_employee_permission('accounting_delete'))
        )
    )
  );
