-- Project revenue (Phase 4b): the cost relief ledger, the progress figures on a
-- contract revenue month, and the Contract Loss Provision account default. Idempotent.
-- Spec: .ai/specs/2026-10-09-project-billing.md (Phase 4b)
-- Plan: .ai/plans/2026-10-09-project-billing-phase-4b.md (decisions R2, R7, R9)

-- 1) Which ledger rows each relief covered (append-only) -----------------------------
-- Keyed by the Cost Relief schedule row, not a run line: the synthesizers write before
-- the run lines exist. A rebuilt month deletes its schedule rows and the cascade frees
-- their ledger rows; the unique key makes a second relief of one row impossible.
CREATE TABLE IF NOT EXISTS "projectCostRelief" (
  "id" TEXT NOT NULL DEFAULT id('pcr'),
  "companyId" TEXT NOT NULL,
  "projectLedgerId" TEXT NOT NULL,
  "revenueRecognitionScheduleId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectCostRelief_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectCostRelief_ledger_key" UNIQUE ("projectLedgerId", "companyId"),
  CONSTRAINT "projectCostRelief_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "projectCostRelief_ledger_fkey" FOREIGN KEY ("projectLedgerId", "companyId")
    REFERENCES "projectLedger"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectCostRelief_schedule_fkey" FOREIGN KEY ("revenueRecognitionScheduleId", "companyId")
    REFERENCES "revenueRecognitionSchedule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "projectCostRelief_companyId_idx"
  ON "projectCostRelief" ("companyId");
-- The unique key ("projectLedgerId", "companyId") already indexes the ledger FK.
CREATE INDEX IF NOT EXISTS "projectCostRelief_schedule_idx"
  ON "projectCostRelief" ("revenueRecognitionScheduleId", "companyId");

-- 2) The figures behind a progress month (decision R7) -------------------------------
ALTER TABLE "customerContractRevenue"
  ADD COLUMN IF NOT EXISTS "earnedToDate" NUMERIC,
  ADD COLUMN IF NOT EXISTS "estimateAtCompletion" NUMERIC,
  ADD COLUMN IF NOT EXISTS "transactionPrice" NUMERIC,
  ADD COLUMN IF NOT EXISTS "progress" NUMERIC;

DO $prprogress$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"customerContractRevenue"'::regclass
      AND conname = 'customerContractRevenue_progress_check'
  ) THEN
    ALTER TABLE "customerContractRevenue"
      ADD CONSTRAINT "customerContractRevenue_progress_check"
      CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 1);
  END IF;
END $prprogress$;

-- 3) The loss provision account default -----------------------------------------------
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "contractLossProvisionAccount" TEXT;

DO $prfk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"accountDefault"'::regclass
      AND conname = 'accountDefault_contractLossProvisionAccount_fkey'
  ) THEN
    ALTER TABLE "accountDefault"
      ADD CONSTRAINT "accountDefault_contractLossProvisionAccount_fkey"
      FOREIGN KEY ("contractLossProvisionAccount") REFERENCES "account"(id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $prfk$;

CREATE INDEX IF NOT EXISTS "accountDefault_contractLossProvisionAccount_idx"
  ON "accountDefault" ("contractLossProvisionAccount");

-- 4) The account, one per company group that has a chart --------------------------------
-- Re-runnable: a group that already holds the number OR the name keeps its account. The
-- parent is the seeded group by NAME; a chart that renamed or dropped it falls back to the
-- group holding a seeded sibling, and only then to the chart root, with a NOTICE.
DO $praccounts$
DECLARE
  spec RECORD;
  grp TEXT;
  parent_id TEXT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('2165', 'Contract Loss Provision', 'Liability', 'Other Current Liability', 'Balance Sheet', 'Current', 'Current Liabilities', ARRAY['2160', '2170', '2180'])
    ) AS s(number, name, class, account_type, income_balance, consolidated_rate, parent_name, sibling_numbers)
  LOOP
    FOR grp IN SELECT DISTINCT a."companyGroupId" FROM "account" a LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM "account" a
        WHERE a."companyGroupId" = grp AND (a.number = spec.number OR a.name = spec.name)
      );

      parent_id := NULL;

      SELECT g.id INTO parent_id
      FROM "account" g
      WHERE g."companyGroupId" = grp AND g."isGroup" = TRUE AND g.name = spec.parent_name
      LIMIT 1;

      IF parent_id IS NULL THEN
        SELECT p.id INTO parent_id
        FROM "account" a
        JOIN "account" p ON p.id = a."parentId" AND p."isGroup" = TRUE
        WHERE a."companyGroupId" = grp AND a.number = ANY (spec.sibling_numbers)
        ORDER BY array_position(spec.sibling_numbers, a.number)
        LIMIT 1;
      END IF;

      IF parent_id IS NULL THEN
        RAISE NOTICE 'project-revenue: company group % has no "%" group; account % % is at the chart root',
          grp, spec.parent_name, spec.number, spec.name;
      END IF;

      INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
      VALUES (
        id('acct'), spec.number, spec.name, spec.class::"glAccountClass", spec.account_type::"accountType",
        spec.income_balance::"glIncomeBalance", spec.consolidated_rate::"glConsolidatedRate",
        parent_id, false, true, false, grp, 'system'
      );
    END LOOP;
  END LOOP;
END $praccounts$;

-- 5) Backfill the default by number, then by leaf name for a group that renumbered it.
UPDATE "accountDefault" ad
SET "contractLossProvisionAccount" = a.id, "updatedBy" = 'system'
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '2165'
WHERE ad."companyId" = c.id AND ad."contractLossProvisionAccount" IS NULL;

UPDATE "accountDefault" ad
SET "contractLossProvisionAccount" = a.id, "updatedBy" = 'system'
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
  AND a.name = 'Contract Loss Provision' AND a."isGroup" = FALSE
WHERE ad."companyId" = c.id AND ad."contractLossProvisionAccount" IS NULL;

-- Every company must leave with a usable Contract Loss Provision default: a Percent
-- Complete line with a forecast loss refuses to recognize without one.
DO $prguard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accountDefault" ad
    LEFT JOIN "account" a ON a.id = ad."contractLossProvisionAccount"
    WHERE a.id IS NULL OR a.class <> 'Liability' OR a."isGroup"
  ) THEN
    RAISE EXCEPTION 'project-revenue: a company has no Contract Loss Provision default, or it is not a Liability leaf account';
  END IF;
END $prguard$;

NOTIFY pgrst, 'reload schema';
