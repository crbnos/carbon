---
paths: ["packages/ee/src/accounting/providers/**"]
triggers: ["listChanges", "SupportsIncrementalPull", "VERIFY"]
promoted: null
---
# A VERIFY-flagged provider endpoint in a cron loop is an outage, not a TODO

**Context:** The Rillet AP payment pull assumed an org-wide `GET /bill-payments` feed mirroring `/invoice-payments`. The method carried a VERIFY comment ("assumed to mirror… not confirmed") and even named its own fallback, but shipped unguarded inside `listChanges`. The endpoint does not exist (404).

**Problem:** Every `accounting-pull-sweep` run threw at the AP step, killing the whole Rillet pull — including the AR invoice-payment changes collected earlier in the same call — every 30 minutes, silently. Payments recorded in Rillet never flowed back to Carbon, so a bill paid remotely stayed open locally, got paid a second time in Carbon, and the outbound push then failed forever on Rillet's over-pay guard. One unverified assumption at the bottom of a sweep became a permanent, compounding data gap that surfaced two layers away from its cause.

**Rule:** An API call that only runs inside a cron/sweep is exercised for the first time in production — verify VERIFY-flagged endpoints against the live sandbox *before* wiring them into a loop (one curl answers it), and never let one entity family's listing failure discard another family's already-collected changes. When an assumed endpoint is missing, compose from verified ones instead: Rillet AP payments = `GET /bills?updated.gt` (payment activity bumps the bill's `updated_at`) + `GET /bills/{id}/payments` per changed bill.

**Applies to:** `packages/ee/src/accounting/providers/rillet/provider.ts` (`listChanges`, `listBillPaymentsUpdatedSince`), any `SupportsIncrementalPull.listChanges` implementation, VERIFY-flagged calls anywhere under `packages/ee/src/accounting/providers/**`.
