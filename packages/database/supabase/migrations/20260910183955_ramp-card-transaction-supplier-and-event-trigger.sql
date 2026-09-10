-- Ramp card charges as provider objects (Rillet charge / QBO Purchase / Xero
-- SPEND bank transaction) need a vendor. A Ramp charge only carried the merchant
-- as free text (`merchantName`); the sync now resolves the merchant to a Carbon
-- `supplier` (mapping → name match → auto-create, mirroring the bill family's
-- resolveRampSupplier) and records it here so the accounting-sync vendor syncers
-- can carry it to the provider. `supplier` has a single-column PK (`id`).
--
-- Also attach the event-system trigger so a cardTransaction reaching Posted /
-- Voided enqueues an outbound push operation — the same one-liner
-- 20260807152238_payment-event-trigger.sql added for `payment`. The per-company
-- SYNC subscription for the table is converged by the accounting providers'
-- install/onUpdate hooks and the outbound sweep (REQUIRED_SYNC_SUBSCRIPTIONS),
-- never backfilled here; the trigger is a cheap no-op until one exists.
--
-- Idempotent: the deploy runner retries a failed file over committed partial
-- state, so every statement is guarded.

ALTER TABLE "cardTransaction"
  ADD COLUMN IF NOT EXISTS "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_supplierId_idx"
  ON "cardTransaction" ("companyId", "supplierId");

SELECT attach_event_trigger('cardTransaction', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
