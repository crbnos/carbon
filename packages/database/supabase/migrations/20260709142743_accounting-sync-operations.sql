-- Accounting sync engine v2: durable per-record sync-operation ledger
-- Spec: .ai/specs/2026-07-09-accounting-sync-engine.md (Phase A)

DO $$ BEGIN
  CREATE TYPE "syncOperationStatus" AS ENUM
    ('Pending', 'In Flight', 'Completed', 'Failed', 'Warning', 'Skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "accountingSyncOperation" (
    "id" TEXT NOT NULL DEFAULT id('syncop'),
    "companyId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "direction" TEXT NOT NULL CHECK ("direction" IN ('push-to-accounting','pull-from-accounting')),
    "trigger" TEXT NOT NULL CHECK ("trigger" IN ('event','webhook','backfill','manual','posting','retry')),
    "status" "syncOperationStatus" NOT NULL DEFAULT 'Pending',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "accountingSyncOperation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "accountingSyncOperation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One live operation per record+direction+integration: re-triggers are absorbed
CREATE UNIQUE INDEX IF NOT EXISTS "accountingSyncOperation_live_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "entityType", "entityId", "direction")
  WHERE "status" IN ('Pending', 'In Flight');
CREATE UNIQUE INDEX IF NOT EXISTS "accountingSyncOperation_idempotency_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_inbox_idx"
  ON "accountingSyncOperation" ("companyId", "integration", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_companyId_idx"
  ON "accountingSyncOperation" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_createdBy_idx"
  ON "accountingSyncOperation" ("createdBy");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_updatedBy_idx"
  ON "accountingSyncOperation" ("updatedBy");

ALTER TABLE "accountingSyncOperation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingSyncOperation";
CREATE POLICY "SELECT" ON "public"."accountingSyncOperation" FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."accountingSyncOperation";
CREATE POLICY "UPDATE" ON "public"."accountingSyncOperation" FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

-- No INSERT/DELETE policies: rows are created and removed by jobs via service role only.

-- Posting-sync trigger source: journal UPDATEs flow into the event system (PGMQ)
SELECT attach_event_trigger('journal', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
