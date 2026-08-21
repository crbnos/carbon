-- Phase G — outbound payment write-back.
--
-- Attach the event-system trigger to the `payment` table so a Carbon-born
-- payment reaching Posted/Voided enqueues an outbound push operation (see
-- events/sync.ts → getPaymentPushDecision). Provider-recorded payments still
-- flow INTO Carbon via the Rillet webhook + pull sweep; the push syncer skips
-- those (their mapping marks them provider-owned), so this trigger does not
-- create a loop.
--
-- The per-company SYNC subscription for the `payment` table is created by the
-- Rillet install hook (rilletOnInstall, via createEventSystemSubscription) —
-- not backfilled here. Rillet is a new integration with no pre-existing installs
-- to patch, and the trigger is a cheap no-op until a matching subscription
-- exists. Idempotent: attach_event_trigger drops and recreates its triggers.

SELECT attach_event_trigger('payment', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
