-- Phase G — outbound payment write-back.
--
-- The `payment` table joins the event system so a Carbon-born payment reaching
-- Posted/Voided enqueues an outbound push operation (see events/sync.ts →
-- getPaymentPushDecision). Provider-recorded payments still flow INTO Carbon via
-- the Rillet webhook + pull sweep; the push syncer skips those (their mapping
-- marks them provider-owned), so this trigger does not create a loop.
--
-- Idempotent: attach_event_trigger drops and recreates its triggers, and the
-- subscription backfill is guarded by ON CONFLICT DO NOTHING.

SELECT attach_event_trigger('payment', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);

-- Backfill the SYNC subscription for companies that already have Rillet
-- connected (identified by an existing 'rillet-sync' subscription). New installs
-- get the 'payment' subscription from rilletOnInstall. Each company's existing
-- rillet-sync config is copied so the provider tag matches.
INSERT INTO "eventSystemSubscription"
  ("name", "table", "companyId", "operations", "handlerType", "config", "filter", "active")
SELECT DISTINCT ON (s."companyId")
  'rillet-sync',
  'payment',
  s."companyId",
  ARRAY['INSERT', 'UPDATE', 'DELETE']::TEXT[],
  'SYNC',
  s."config",
  '{}'::jsonb,
  TRUE
FROM "eventSystemSubscription" s
WHERE s."name" = 'rillet-sync'
ORDER BY s."companyId"
ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company" DO NOTHING;
