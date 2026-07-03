# Accounting Bugs Remediation — 2026-07-02

Three user-reported accounting bugs, root-caused and fixed.

## Bug 1 — Manual MES issue of backflush materials corrupts WIP

**Symptom:** Issuing parts manually from MES (because the operation that would
backflush them was skipped) corrupted the WIP journal/ledger entries.

**Root cause:** `issueJobOperationMaterials()` in
`packages/database/supabase/functions/issue/index.ts` backflushed
`material.quantity × completedQuantity` unconditionally, ignoring
`jobMaterial.quantityIssued`. The SQL `backflush_job_materials` caps at
`GREATEST(target − quantityIssued, 0)`, but the edge-function path (used by
MES operation complete/end, batch and serial complete) did not. Since a job
can't complete until every operation is Done, the skipped operation is
eventually ended, re-issuing the already-manually-issued materials: duplicate
itemLedger/costLedger consumption and duplicate DR WIP / CR Inventory lines,
which then inflate the WIP discharge into finished goods.

**Fixes:**
- [x] `issue/index.ts`: cap backflush at `estimatedQuantity − quantityIssued`,
  skip materials with nothing remaining.
- [x] `issue/index.ts` (`partToOperation`): "Positive Adjmt." (return to
  inventory) now decrements `quantityIssued` instead of incrementing, keeping
  the backflush cap in sync.
- [x] `close-job/index.ts`: WIP variance entry is now sign-aware (was
  `Math.abs`, which doubled a negative/over-credited WIP residual instead of
  zeroing it).

## Bug 2 — Invoice-line tax not reflected in payable/payment amount

**Symptom:** Tax added on a purchase invoice line that wasn't on the PO
produced a correct PPV entry, but the payment was still for the pre-tax
amount.

**Root cause:** `post-purchase-invoice` credits AP tax-inclusive (correct),
but the `purchaseInvoices` view computed `balance` / derived `Paid` status /
`datePaid` from the stored header `purchaseInvoice.totalAmount` — written
pre-tax at PO→invoice conversion and never updated (deprecated by
`20260604120000`). `post-payment` rejects applications above the view
`balance`, pinning the payment to the pre-tax amount and stranding the tax as
an un-relievable AP credit. Regression chain: fixed by `20260630102736`, then
silently reverted by `20260630151500` (forked its view bodies from the
pre-fix `20260630095023`), perpetuated by `20260702061504`. The same fork
also reverted the memo-aware `settled` CTE (`20260630105334`) and dropped
`salesInvoices.paymentTermName` (`20260629120000`).

**Fixes:**
- [x] Migration `20260702114500_invoice-balance-includes-line-tax.sql`:
  recreates both invoice views with balance/status/datePaid derived from the
  live line-derived total (incl. tax + shipping), restores the memo-aware
  settled CTE and `salesInvoices.paymentTermName`, keeps dust forgiveness and
  the supplierShippingCost divide-with-zero-guard.
- [ ] After applying migrations: `pnpm run generate:types` (salesInvoices
  gains `paymentTermName`). Not run here — no local DB in this environment.

Expected visible side effect: invoices previously derived-'Paid' at the
pre-tax amount reopen with a balance equal to the unpaid tax (correct
outstanding AP).

## Bug 3 — Manual production events in ERP post no journal entries

**Symptom:** Adding/editing production events from ERP created no journal
entries.

**Root cause (chain):** the ERP routes do invoke `post-production-event`, but:
1. The edge function marked events with no work center (or no
   endTime/duration) as `postedToGL = true` and returned success — silently
   skipping them AND permanently excluding them from the
   `complete_job_to_inventory` fallback. Manual ERP entry is the only path
   where `workCenterId` can be null (MES stamps it at start).
2. The form's WorkCenter picker passed `jobOperationId` as a `processId`
   filter, so in edit mode the dropdown was always empty — the field was
   effectively impossible to set correctly.
3. Both routes discarded the invoke response, so failures were invisible.
4. Edits of already-posted events had no adjustment semantics (re-invoking
   would double-post; journal lines weren't attributable to the event).

**Fixes:**
- [x] `post-production-event/index.ts`: unpostable events (no
  endTime/duration/workCenter) no longer get `postedToGL = true`; they return
  `{ success: false, reason }` so they can post later (manually or via the
  completion fallback).
- [x] `post-production-event/index.ts`: journal lines are now tagged
  `production-event:{id}` (`journalReference.to.productionEvent`); reposting
  an already-posted (edited) event first reverses the net previously posted
  per account, then posts the new amount, in one balanced journal. Events
  posted before per-event tagging return `success: false` instead of
  double-posting.
- [x] ERP create/edit routes flash "saved, but no journal entry was posted:
  {reason}" when the invoke fails or is skipped.
- [x] `ProductionEventForm`: WorkCenter is filtered by the selected
  operation's `processId` (reactive to the Operation select).

## Follow-ups (not done, out of scope)

- `convert/index.ts` still writes the deprecated stored
  `purchaseInvoice.totalAmount` pre-tax; only external (Xero) sync readers
  see it.
- ~~Deleting a posted production event does not reverse its journal entry~~
  Done in a follow-up commit: `post-production-event` gained a
  `reverse: true` mode (posts a reversal journal from the per-event tagged
  lines, sets `postedToGL = false`); `deleteProductionEvent` reverses before
  deleting and blocks the delete when reversal isn't possible (events posted
  before per-event tagging). Covers both the ERP route and the MCP tool
  (service signature gained `companyId`/`userId`; MCP metadata regenerated).
- If manual-event posting still fails after these fixes, check edge-function
  logs for auth: `requirePermissions` in `functions/lib/supabase.ts` rejects
  opaque (`sb_secret_*`) service keys that `isTrustedBearer` accepts —
  auth-sensitive, so not changed here.
- Historical data repair (already-corrupted WIP/journal entries from bugs 1
  and 3, invoices mis-flagged Paid from bug 2) is a data fix, not covered by
  these code changes.

## Verification

- `pnpm --filter erp typecheck` — clean.
- Biome on changed app files — clean.
- Edge functions and migration SQL not executed here (no local DB / Deno);
  verify by applying the migration and exercising: manual MES issue → end
  skipped op → single consumption; invoice with added line tax → payment for
  full amount; manual ERP production event create/edit → journal entries and
  adjustment reversal.
