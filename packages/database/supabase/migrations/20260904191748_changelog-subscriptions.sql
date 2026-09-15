-- Changelog subscriptions. Plan: .ai/plans/2026-09-05-changelog-subscriptions.md
--
-- The newsletter preference is an ordinary "notificationPreference" row
-- (topic 'changelog', channel 'email') — no schema change needed for it.

-- The dispatch ledger: one row per RSS <guid> already fanned out. Platform-level
-- (no companyId — the docs-site changelog is not tenant data, same class as the
-- global "exchangeRate" store). What makes the dispatcher idempotent: the hourly
-- cron, the merge-triggered run, and a manual re-fire can all overlap without
-- double-sending. Also the in-app "latest entry" source for the sidebar card,
-- which is why it carries the description. SERVICE-ROLE ONLY: RLS with no policies.
CREATE TABLE IF NOT EXISTS "changelogDispatch" (
    "guid" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "dispatchedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "changelogDispatch_pkey" PRIMARY KEY ("guid")
);

ALTER TABLE "changelogDispatch" ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.
