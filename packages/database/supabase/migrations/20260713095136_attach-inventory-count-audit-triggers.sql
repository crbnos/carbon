-- Attach async event triggers so inventoryCount changes flow to the AUDIT handler.
-- The AUDIT eventSystemSubscription rows are created at runtime by
-- syncAuditSubscriptions (on every /api/audit-log fetch), so no subscription SQL
-- is needed here.
--
-- Pass all three args explicitly: a 2-arg call is ambiguous because both the
-- legacy 2-arg overload and the 3-arg overload (defaulted after_sync_functions,
-- added 20260410030406) match. Empty arrays = async-only (no sync/after-sync).
SELECT attach_event_trigger('inventoryCount'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('inventoryCountLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
