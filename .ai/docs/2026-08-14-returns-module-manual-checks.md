# Returns Module — Manual UI Verification Guide

How to check the Returns module (customer RMAs + supplier returns) by clicking
through the app. Written after implementation on branch `returns-module`; the
✅ marks are flows already verified end-to-end against the local dev stack
(Northspoke Cycles company — `RMA000001`, `RMA000002`, `RTS000001` exist there
from that run). Log in with the dev bypass (`test@carbon.ms`) and pick
**Northspoke Cycles**.

> Heads-up for local testing: the local dev DB carries another branch's schema
> (cutList tables) plus a missing `companySettings.showCurrencyTrailingZeros`
> column. The only visible effect is money possibly rendering without trailing
> zeros. A one-shot reconcile script is at the end of this doc.

## 1. Customer RMA — the happy path ✅

1. **Sales → RMAs** (new sidebar item under Manage). The list shows readable
   ids, customer, status badge, received progress, credited quantity.
2. **Add RMA** → pick a customer (e.g. Cascade Bike Shop). Order Date defaults
   to the company's calendar today. Save → you land on the RMA detail with an
   `RMA0000NN` number already assigned.
3. In the left explorer, **Add lines from document** → the picker lists that
   customer's POSTED shipment lines with *returnable* quantities
   (shipped − already authorized on other RMAs). Pick one (quantities are
   clamped). Or **Add Line Item** for a blind return (no links).
   - For a serial/batch item, the line form's "Expected serials/batches"
     section offers exactly the entities shipped to that customer.
4. **Confirm** (header). Checks the reversible cap under a row lock, flips the
   status to Confirmed, and generates + attaches the RMA PDF (see the
   document on the details panel, and the PDF button in the header).
   - ✅ Over-authorization check: a second RMA against the same shipment line
     for more than the remainder is rejected at Confirm and stays Draft.
5. **Inventory → Receipts → New receipt** → Source Document **Sales Return
   Order** → pick the RMA. Lines pre-fill with the outstanding quantities at
   unit price 0 (cost is resolved at posting).
6. For serial/batch lines, the tracking section is a **picker of the expected
   entities** (not free-text serial entry) — choose which ones physically
   arrived. Blind lines keep the normal serial/batch entry.
7. **Post** the receipt. Verify:
   - RMA flips to **Partially Received** / **Received** (partial receipts are
     fine — the ladder follows quantities). ✅
   - The same serials are back, status **On Hold** (Items → Traceability shows
     a `Return Receipt` activity connecting the original shipment). ✅
   - Accounting → Journals: `Sales Return Receipt` entry, Dr Inventory /
     Cr COGS at the ORIGINAL outbound cost (the shipment's consumed layers,
     e.g. 2 × 782.4183 for goods sold at 1899). ✅ A blind line posts at
     current cost; a line whose Return Reason has "Zero inventory value" posts
     a zero-value layer and no journal.
8. **Void** the receipt (receipt header menu). Quantities, status, and the
   serial statuses all revert; the return's cost layers are zeroed so voided
   stock can never be consumed. ✅
9. **Disposition** (line form, enabled once received): **Use As Is** flips the
   returned serials to Available (visible in on-hand / tracked entities). ✅
   **Return to Customer** records the outcome; then a new **Shipment** with
   source "Sales Return Order" ships it back (On Hold entities are pickable
   for that source only). **Scrap / Rework** open a pre-associated quality
   Issue instead (see §3).
10. **Issue Credit** (header, needs invoicing permission): per-line quantities
    default to received − credited, with a restocking-fee preview. Creates a
    **Draft AR credit memo** linked to the RMA (e.g. 2 × 1899 × (1 − 10%) =
    3418.20 with a 379.80 fee recorded per line). ✅
11. Post the memo from **Invoicing → Credits**. Its reason account is the
    seeded **4900 Sales Returns** contra-revenue account, and the RMA's
    Credited quantity updates (voiding the memo reverts it). ✅
12. **Create Replacement Order** (header): drafts a sales order pre-filled
    from the RMA lines at resolvePrice pricing; both documents cross-link.
13. **Complete** (header): blocked while any received quantity is Pending
    disposition or a line is short (short-close the line with Stop Receiving
    to release it). ✅ after disposition + full receipt.

## 2. Supplier return — the mirror ✅

1. **Purchasing → Supplier Returns** → **New**. Pick the supplier; the
   "Supplier RMA #" field stores the supplier's own authorization number
   (shows on the PDF header). ✅
2. **Add from document** lists POSTED receipt lines from that supplier with
   returnable remainders; rows without a resolvable receipt are flagged
   **Blind**. Quantities/prices are inventory-UOM (converted once from the PO
   line).
3. **Confirm** → `RTS0000NN` + PDF. ✅
4. **Inventory → Shipments → New** → Source **Purchase Return Order** → pick
   the return → **Post**. Verify:
   - Return flips Partially Shipped / **Shipped**; line `quantityShipped`
     bumps. ✅
   - Ledger: `Purchase Return Shipment` negative rows at carried cost;
     journal **Cr Inventory (Raw Materials) / Dr GR/IR Clearing**. ✅
   - Tracked entities (picked from that supplier's Available stock) go
     **Consumed** with a `Return Shipment` activity. Voiding reverses all of
     it.
5. **Issue Credit** → Draft **AP credit memo** linked via the return; its
   reason account is **GR/IR Clearing** (nets the shipment's GRNI debit).
   Posting updates the credited quantity. ✅
6. **Create Replacement Order** drafts a PO priced from the linked PO line /
   supplier part.

## 3. Quality bridge (spot-check)

1. On an RMA line with received quantity, choose **Scrap** or **Rework** →
   an Issue opens pre-associated with the RMA line and its serials
   (Issue detail → Associations shows "RMA Lines"); the Issue's close posts
   the write-off — the RMA posts no GL itself.
2. On a quality Issue whose disposition rows are **Return to Supplier**, the
   details page shows a **Supplier Return** card → **Create Supplier Return**
   drafts a linked `RTS` document (supplier auto-resolved from the issue's
   associations; the picker is only needed when several suppliers are
   involved). Re-clicking creates nothing new for already-covered quantities.
3. While that return is open, **Complete** on the Issue is blocked with a
   named blocker. After the return ships, closing the Issue writes off only
   the uncovered remainder, and the shipped entities stay Consumed.

## 4. Configuration screens

- **Sales → Return Reasons** (Configure group): seeded with Defective / Wrong
  Item Shipped / Damaged in Transit / No Longer Needed / Warranty / Other; the
  "Zero inventory value" flag drives §1.7's zero-value receipt. ✅ (shared
  with supplier returns)
- **Settings → Document Templates**: two new customizable documents — "RMA"
  (Sales) and "Supplier Return" (Purchasing).

## 5. Permissions spot-checks

- RMA screens need `sales`; supplier-return screens need `purchasing`;
  both credit routes need `invoicing_create`; the Scrap/Rework escalation
  needs `quality_create`; receiving/shipping stays `inventory`.

## Appendix — local dev DB reconcile (optional, one-shot)

The local DB predates this branch and carries another branch's schema. To
align it with main + this branch (fixes the trailing-zeros display and drops
the foreign cutList scaffolding — all foreign tables were verified empty
except one throwaway cutList row, backed up during the run):

```bash
docker exec -i carbon-carbon-postgres-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DROP VIEW IF EXISTS "cutLists";
DROP TABLE IF EXISTS "cutListLine" CASCADE;
DROP TABLE IF EXISTS "cutList" CASCADE;
DROP TABLE IF EXISTS "cutPattern" CASCADE;
DROP TABLE IF EXISTS "itemStockDimension" CASCADE;
ALTER TABLE "jobOperation" DROP COLUMN IF EXISTS "jobOperationBatchId" CASCADE;
ALTER TABLE "productionEvent" DROP COLUMN IF EXISTS "jobOperationBatchId" CASCADE;
DROP TABLE IF EXISTS "jobOperationBatch" CASCADE;
DROP TYPE IF EXISTS "cutListStatus";
DROP TYPE IF EXISTS "jobOperationBatchStatus";
DELETE FROM pg_enum WHERE enumlabel = 'Cut List Consumption'
  AND enumtypid = '"itemLedgerDocumentType"'::regtype;
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "showCurrencyTrailingZeros" BOOLEAN NOT NULL DEFAULT true;
COMMIT;
SQL
docker exec carbon-carbon-postgres-1 psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';"
```

Then recreate the two `jobOperationsWith*` views from
`packages/database/supabase/migrations/20260811123619_widen-sales-production-scale.sql`
(the DROP COLUMN CASCADE removes them), and run `pnpm db:types` — the diff
should be empty on this branch.
