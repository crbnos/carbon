-- Changelog newsletter dispatch ledger: one row per feed entry already handled.
-- Platform-level, so no companyId. Service-role only: RLS comes from the authz
-- manifest (`changelogDispatch: serviceOnly()`).
-- IF NOT EXISTS because this replaces 20260904191748_changelog-subscriptions.sql,
-- which some development databases already ran.
CREATE TABLE IF NOT EXISTS "changelogDispatch" (
    "guid" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "dispatchedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "changelogDispatch_pkey" PRIMARY KEY ("guid")
);
