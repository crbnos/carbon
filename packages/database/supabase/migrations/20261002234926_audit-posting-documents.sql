-- Attach async event triggers so the posting documents newly registered in
-- auditConfig (packages/database/src/audit.config.ts) flow to the AUDIT
-- handler: journal entries, payments, memos, reimbursements, picking lists,
-- depreciation runs and revenue recognition runs, each with its lines.
--
-- journal, payment and reimbursement already carry these triggers (other
-- subscribers use them); attach_event_trigger drops and recreates, so listing
-- only the tables that lack them keeps this migration to what is new.
--
-- The AUDIT eventSystemSubscription rows are created at runtime by
-- syncAuditSubscriptions (on every /api/audit-log fetch), so no subscription
-- SQL is needed here. dispatch_event_batch checks for a (table, companyId)
-- subscription before enqueuing, so a company without audit logging pays one
-- EXISTS per statement on these tables and nothing more.
--
-- Pass all three args explicitly: a 2-arg call is ambiguous because both the
-- legacy 2-arg overload and the 3-arg overload (defaulted after_sync_functions,
-- added 20260410030406) match. Empty arrays = async-only (no sync/after-sync).
SELECT attach_event_trigger('journalLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('invoiceSettlement'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('memo'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('reimbursementLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('pickingList'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('pickingListLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('depreciationRun'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('depreciationRunLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('revenueRecognitionRun'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('revenueRecognitionRunLine'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
