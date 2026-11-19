# Force delete reverses the order's receipts

## Context

The user's case: a PO is marked received by mistake. The goods never came,
and they want the PO gone. In prod the receipt's **Void** refuses (they could
not say which message). The force delete on this branch
(`dane/eloquent-archimedes-t0ow3h`) refuses too, while any receipt that isn't
voided still names the order. So nothing gets them out, though they expected
the Admin-approved override to. They chose: **reversing the receipts is part of
force delete**. Approving the request reverses the order's receipts, then
deletes the PO.

What blocks a void today (inventory.service.ts `postReceipt`, void branch,
~L14507–15460):

- Posted before the accounting cutover (`refuseVoidBeforeCutover`). The
  cutover reset that receipt's cost layers.
- Stock moved, picked or shipped since it was received
  (`assertReceivedStockOnHand`, L14110). A completed put-away into another
  bin is the likely everyday cause.
- Stock consumed (`planReceiptVoidCostLedger`, L15228).
- A rejected or partial inspection, a Put Away with picked stock, a
  capitalized asset, or a receipt created by a purchase invoice.

`postReceipt` opens its own Kysely transaction, and Kysely refuses nested
transactions, so the void cannot run inside force delete's transaction. A
negative adjustment can: `bookAdjustment(trx, …)` (shared.service.ts
L17416) writes the item ledger row, relieves cost layers and writes the
journal pair (`valueMovement`). Receipts and ledgers point at the PO only by
text ids, so they never block the delete. Purchase invoice lines
(ON DELETE RESTRICT) are the one hard FK.

## Approach: void when the void allows, adjust out when it can't

On **approve** (`decidePurchaseOrderForceDelete`, purchasing.server.ts
~L2530), in two steps.

**Step 1: exact reversals, before the delete transaction.** Each Posted PO
receipt goes through the existing void (`invokePosting(ctx, "post-receipt",
{type:"void"}, inventoryService.postReceipt)`, the same call as
`voidReceipt`, inventory.server.ts L650). This reverses ledger, cost layers,
journals, tracked entities, inspections and put-aways at the original cost.

- The two overridable refusals (before cutover; stock moved elsewhere) are
  caught by message constant and left for step 2.
- Any other refusal stops the approval with that message. The request stays
  Pending.
- Each void commits on its own. If a later step fails, the receipts already
  voided stay voided (the right state for a mistaken receipt). The request
  stays Pending and re-approving resumes, because a voided receipt is no
  longer counted.

**Step 2: adjust out the rest, and delete, in one transaction** (the existing
`ctx.transaction`). For each receipt step 1 left:

1. Re-lock the receipt (`lockPostedReceipt`, inventory.service.ts L14121).
   Read its received lines (`receiptLine`: item, location, storage unit,
   tracked entities, received quantity).
2. Read on-hand now, per item at the receipt's location, by storage unit,
   tracked entity and project stripe (sum of `itemLedger`).
   - Plan the removal with a new pure `planReceiptReversal`: tracked entities
     are taken where they now are, untracked stock comes from the received
     storage unit first, then the others.
   - If on-hand is short, refuse: "Cannot force delete: stock received on
     {receipt} was already used. Correct it with an inventory adjustment first."
     Stock that was used cannot be un-received.
3. Book each removal with `bookAdjustment(trx, …)`.
   - `entryType: "Negative Adjmt."`, `documentId: receiptId`,
     comment "Force delete of {PO}: reverses {receipt}".
   - Offset account:
     - **After cutover:** the account the receipt's journal credited (read with
       `documentJournalLines(receiptId, "Receipt")`, normally Goods Received
       Not Invoiced). The GRNI accrual from the receipt closes rather than
       leaving a stray variance.
     - **Before cutover:** the default `inventoryAdjustmentVarianceAccount`.
       That stock came in through the cutover's opening balance, so removing
       it is a write-down.
   - Tracked entities: quantity 0 and status Consumed, plus a
     `trackedActivity` "Void Receipt", as the void does.
4. Set `receipt.status = "Voided"`.

Then the existing steps run unchanged: re-read the blockers (shipments,
invoices and prepayments still block; receipts now all Voided), mark the
approval and request, cancel pending approvals, delete the PO.

Draft receipts on the order (never posted, no ledger) are deleted in the
transaction. A receipt in Pending (being posted) refuses: "{receipt} is being
posted; try again".

The accounting period, posting status, defaults and dimensions are resolved
**before** the transaction, as `postInventoryAdjustment` does
(inventory.service.ts ~L24240–24300). `getCurrentAccountingPeriod` commits
its own short transaction. Inside, `assertPostingStatusUnchanged` runs first.

**At request time** receipts no longer block. `requestPurchaseOrderForceDelete`
refuses early only on what approval would refuse anyway:

- shipments, invoices or prepayments (unchanged);
- a receipt whose stock was already used (the same read as step 2, read-only).

## UI

`PurchaseOrderForceDelete.tsx`:

- **Request modal:** the "never touches the ledger" bullet becomes the list of
  the order's receipts with "Approving reverses these receipts: their stock
  is removed and their postings reversed." The route loader passes the
  receipts (`getPurchaseOrderForceDeleteBlockers` already reads them).
- **Banner and the approve confirm:** "Approving and deleting also reverses
  RE… ".
- **Success toast:** "PO… was force deleted; RE… reversed".

Translations: new strings through `lingui:extract`, filled with `/translate`.

## Files

- `apps/erp/app/modules/purchasing/purchasing.server.ts`: request and decide
  flows above.
- `apps/erp/app/modules/purchasing/purchasing.service.ts`: building blocks:
  - `reverseReceiptsForForceDelete(trx, …)` (step 2);
  - receipt reads;
  - the blockers split into hard blockers (shipments, invoices, prepayments)
    and receipts.
- `apps/erp/app/modules/purchasing/purchasing.models.ts`:
  - pure `planReceiptReversal` (the on-hand plan and the "already used"
    refusal);
  - messages;
  - updated `purchaseOrderForceDeleteBlockerMessage`.
- `apps/erp/app/modules/purchasing/purchasing.models.test.ts`: planner and
  message tests.
- `apps/erp/app/modules/inventory/inventory.service.ts`: export the two
  refusal message constants (moved-stock text; the cutover one is already
  `INVENTORY_VOID_BEFORE_CUTOVER_ERROR` in shared.service.ts). No change to
  the void itself.
- `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderForceDelete.tsx`
  and `apps/erp/app/routes/x+/purchase-order+/$orderId.tsx` (loader passes
  the receipts).
- `apps/erp/app/modules/purchasing/AGENTS.md`: the force delete paragraph.
- `.ai/plans/2026-11-10-force-delete-reverses-receipts.md`: this plan, copied
  on execution.

Reused as is: `bookAdjustment`, `valueMovement`, `lockPostedReceipt`,
`documentJournalLines`, `journalPostingStatus`, `getDefaultPostingGroup`,
`getCurrentAccountingPeriod`, `assertPostingStatusUnchanged`, `invokePosting`
plus `postReceipt` (void).

## Verification

1. `vitest` for `purchasing.models.test.ts`: planner cases.
   - on-hand enough in the same bin;
   - stock split across bins after a put-away;
   - tracked serial moved;
   - short, which refuses;
   - message text.
2. ERP typecheck (`pnpm run typecheck` in apps/erp, only when no other large
   `tsc` is running), and Biome.
3. E2E in Chrome on the worktree ERP (localhost = Test, 127.0.0.1 = Second
   Admin):
   - **Void path:** PO000020 (Posted receipt RE000009). Request, approve, PO
     deleted, RE000009 Voided, journals reversed (check `journalLine` VOID
     rows).
   - **Moved-stock fallback:** receive a Draft PO (PO000021), post it, move
     the stock to another bin (stock transfer). Void refuses "moved", so
     force delete adjusts it out from the new bin. Check: itemLedger negative
     rows with documentId = receipt, offset journal on GRNI, PO deleted,
     on-hand back to the pre-receipt value.
   - **Before-cutover fallback:** set a test receipt's `postingDate` before
     the company's cutover in `wt_app`, then the same check with the variance
     account.
   - **Used stock:** after receiving, issue part of the stock. The request is
     refused with the "already used" message, and the PO is untouched.
   - Regressions: invoices and shipments still block; reject and cancel are
     unchanged; the toasts show.
4. `pnpm db:check:datasets` through the commit hook. Commit per task via
   `/check-and-commit`.
