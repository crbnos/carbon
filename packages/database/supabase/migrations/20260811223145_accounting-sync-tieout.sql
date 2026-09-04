-- Accounting sync tie-out (v3 spec §5 / v4 Pillar E):
--
-- 1) "accountingSyncTieOut" — one row per (integration × accounting period ×
--    account), written by the weekly accounting-reconciliation cron via the
--    service role. Per cell:
--      carbonPostedAmount = synced + docBacked + excluded + pending + blocked
--        (internal completeness), and
--      syncedAmount = providerAmount (external fidelity; NULL until fetched).
-- 2) Reconcile the "External GL sync complete" period-close auto-check into
--    every existing company's checklist (new companies get it from
--    seed.data.ts).
--
-- Every statement is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- ON CONFLICT DO NOTHING) so the deploy runner can safely re-run the whole
-- file over a committed partial state.

CREATE TABLE IF NOT EXISTS "accountingSyncTieOut" (
  "id" TEXT NOT NULL DEFAULT id('tieout'),
  "companyId" TEXT NOT NULL,
  "integration" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,

  -- Net debit-signed sums per cell
  "carbonPostedAmount" NUMERIC NOT NULL DEFAULT 0,
  "syncedAmount" NUMERIC NOT NULL DEFAULT 0,
  "docBackedAmount" NUMERIC NOT NULL DEFAULT 0,
  "excludedAmount" NUMERIC NOT NULL DEFAULT 0,
  "pendingAmount" NUMERIC NOT NULL DEFAULT 0,
  "blockedAmount" NUMERIC NOT NULL DEFAULT 0,
  "providerAmount" NUMERIC,          -- NULL until the provider fetch succeeds
  "internalDelta" NUMERIC NOT NULL DEFAULT 0,   -- carbonPosted − (synced+docBacked+excluded+pending+blocked)
  "externalDelta" NUMERIC,                      -- synced − provider (NULL when providerAmount is NULL)
  "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "accountingSyncTieOut_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "accountingSyncTieOut_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- "accountingPeriod" has a SINGLE-column PK ("id"), so this is a
  -- single-column FK — same as periodCloseTask (20260702044133). A composite
  -- ("accountingPeriodId","companyId") FK would be invalid.
  CONSTRAINT "accountingSyncTieOut_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId")
    REFERENCES "accountingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- "account" also has a single-column PK ("id")
  CONSTRAINT "accountingSyncTieOut_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "account"("id")
);

-- Latest-per-cell upsert target
-- (onConflict: "companyId,integration,accountingPeriodId,accountId")
CREATE UNIQUE INDEX IF NOT EXISTS "accountingSyncTieOut_cell_uq"
  ON "accountingSyncTieOut" ("companyId", "integration", "accountingPeriodId", "accountId");
CREATE INDEX IF NOT EXISTS "accountingSyncTieOut_period_idx"
  ON "accountingSyncTieOut" ("companyId", "integration", "accountingPeriodId");

CREATE INDEX IF NOT EXISTS "accountingSyncTieOut_companyId_idx" ON "accountingSyncTieOut" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingSyncTieOut_accountingPeriodId_idx" ON "accountingSyncTieOut" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "accountingSyncTieOut_accountId_idx" ON "accountingSyncTieOut" ("accountId");
CREATE INDEX IF NOT EXISTS "accountingSyncTieOut_createdBy_idx" ON "accountingSyncTieOut" ("createdBy");

-- RLS: controllers read tie-outs under accounting_view; NO insert/update/
-- delete policies — rows are written only by the reconciliation job through
-- the service role.
ALTER TABLE "public"."accountingSyncTieOut" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingSyncTieOut";
CREATE POLICY "SELECT" ON "public"."accountingSyncTieOut"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
  );

-- ==========================================================================
-- Reconcile the period-close checklist for EXISTING companies: add the
-- "External GL sync complete" Auto check (the v3 §5 close gate) after the
-- seeded 8-task set. Idempotent via the (companyId, name) unique key — a
-- targeted add, never a wipe-and-reseed. New companies are covered by
-- seed.data.ts (periodCloseTaskDefinitions).
-- ==========================================================================

INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT
  c."id", 'External GL sync complete', 'Auto', 'external-gl-sync', 9, true, 'Blocker', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
ON CONFLICT ("companyId", "name") DO NOTHING;
