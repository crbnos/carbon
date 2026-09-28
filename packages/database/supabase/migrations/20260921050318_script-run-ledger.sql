-- Ledger of one-off operational scripts that have already run against THIS
-- database. `ci/src/migrations.ts` reads it after `supabase db push` and runs
-- only the scripts it has no row for, so a deploy re-runs nothing.
--
-- Why this lives here and not on the CI control plane's `workspaces` table:
-- "has this script run?" is a fact about this database, so it travels with it.
-- A workspace that is cloned, restored or re-pointed at a different project
-- carries the correct answer instead of inheriting a stale flag, and a
-- self-hosted instance gets the same bookkeeping from `supabase db push`
-- alone, with no control-plane table to replicate.
--
-- Deliberately NOT tenant-scoped: it has neither "companyId" nor
-- "companyGroupId", so `selectWipeableTables` (company-backup.ts) cannot
-- select it and a company restore can never erase the ledger.
CREATE TABLE "scriptRun" (
  -- The script's stable name, e.g. 'migrate-private-buckets'. Renaming a
  -- script re-runs it, so treat this as the script's permanent identifier.
  "name" TEXT NOT NULL,
  "ranAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Free-form result summary from the run (counts, skips, failures).
  "result" JSONB,

  CONSTRAINT "scriptRun_pkey" PRIMARY KEY ("name")
);

-- Operational metadata: readable by signed-in users for debugging, writable
-- only by the service role (no INSERT/UPDATE/DELETE policy exists), matching
-- how "config" is governed.
ALTER TABLE "scriptRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "scriptRun"
FOR SELECT
USING (
  auth.role() = 'authenticated'
);
