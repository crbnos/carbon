# Force delete: clean up instead of refusing (PR #2197)

## Context

PR #2197 (draft, branch `dane/force-delete-documents`, worktree
`/Users/dane/Code/carbon/eloquent-archimedes`) gives purchase invoices, sales
invoices, receipts and payments the Admin-approved force delete that purchase
orders already have. Approving it voids a posted document, then deletes it.
Today it **refuses** whenever something still holds the document, or when the
void refuses.

The user's direction: force delete is for emergencies, when a user error has
broken the normal process. It must get the document out and clean up what is
related to it, **across the board**. Decisions:

- **Paid invoice:** unapply its payments and memos. Each payment stays Posted
  as unapplied credit, and can then be force deleted on its own.
- **A void refuses** (partial inspection, credit memo on a return, used stock,
  deposit funding, cutover):
  - reverse **by journal**: negate the document's own journal lines;
  - reverse its stock by adjustment;
  - release its holds, restore source quantities, then delete it.
- **Before the accounting cutover:** an invoice gets a write-off of its open
  amount (AR/AP against the write-off account). A receipt keeps the existing
  write-down to inventory adjustment variance.
- **Downstream postings:** reverse them too.
  - recognized revenue: this invoice's part of its posted recognition runs;
  - a capitalized asset: this invoice's part of the asset's value.
- **Deposit and advance applications:** the `prevent_invalid_deposit_refund`
  trigger steps aside under `app.force_delete`.

Code review of #2197 found 8 issues; Task 1 fixes them first.

## Approach

All new building blocks go in `invoicing.service.ts`, beside the existing
force delete blocks. The operations stay in `invoicing.server.ts`.

### Task 1: review fixes (#2197)

1. **Claim the request before step 1's void.** The force delete is approving
   when the void starts. Add status `Approving` to
   `purchaseOrderForceDeleteStatus`; both request tables use it.
   - Approve: lock the request, check that it is Pending, and set it to
     Approving in its own short transaction. Then void.
   - Cancel and reject: refuse an Approving request.
   - If step 2 refuses: set the request back to Pending, so the Admin can
     approve again.
   - Apply the same claim to `decidePurchaseOrderForceDelete`.
2. **Receipt posting date.** `forceDeleteReceipt` carries the receipt's real
   `postingDate`, so a receipt from before the cutover offsets to variance, not
   GRNI. Read `postingDate` in `getForceDeleteDocument`.
3. **Batch the order line updates.** `restorePurchaseOrderReceived` uses one
   batched `updateRowsById` (`@carbon/database/rows`), not a loop.
4. **Reuse the void's quantity logic.** Extract it from the receipt void
   (inventory.service.ts around L14925–15130) into an exported pure helper:
   - new received quantity per line (`receivedComplete`);
   - projected PO status.

   The void and `restorePurchaseOrderReceived` both call it, so there is no
   drift between them.
5. **Dashboard:** the purchasing dashboard's "Assigned to Me" lists
   `documentForceDelete` approvals too, linking to the document.
6. **Remove the `as never` cast.** Widen `reverseReceiptsByAdjustment` to
   `Kysely | KyselyTx`.
7. **Loaders run in parallel.** The receipt, payment and sales invoice loaders
   fetch `getDocumentForceDeleteData` in their `Promise.all`.
8. **Migration comment:** point it at `invoicing.server.ts`.

### Task 2: unapply settlements (paid invoices, payments)

New `unapplySettlements(trx, {companyId, userId, settlementIds, reason, reversal})`.

- **Memo settlement:** delete the row. Applying a memo books no GL.
- **Payment settlement (cash or prior credit):** one journal per payment,
  `sourceType: "Payment"`, every line with `documentType: "Payment"` and
  `documentId: paymentId`. It is built the way `build-payment-journal.ts`
  books an application:
  - **Invoice-tagged lines:** negate every line in the payment's posted
    journal whose `documentLineReference` is the invoice. That covers the
    control, discount and write-off lines.
  - **FX:** reverse each settlement's `fxGainLossAmount` on the account of the
    payment's posted "Realized FX Gain" / "Realized FX Loss" line.
  - **Released cash:** rebook `applied ± fx`.
    - Current cash goes to the payment's on-account line account
      (`readSourceControlLines`). If there is none, use
      `paymentControlAccount`. A deposit payment uses its prepayment account
      with `depositDescription`.
    - Prior credit (`sourcePaymentId`) reverses its "(credit applied)" line on
      the source's account.
  - **Dimensions:** use `paymentDimensions`.
  - **Delete the settlement rows.**
- **Before the cutover:** the payment's journal is Superseded, so no GL is
  booked. Delete the rows; `rebuildPaymentJournal` on a later void reflects
  the change.
- **Widen the payment void** (`postPaymentTransaction` void branch, ~L13452).
  It reverses every Posted or Provisional `journalLine` with
  `documentType: "Payment"` and `documentId = paymentId`, not only
  `payment.journalId`. That way an unapply journal is reversed too.
- **Callers:**
  - **Invoice force delete:** every settlement whose target is the invoice.
  - **Payment force delete:** settlements of other payments whose
    `sourcePaymentId`/`targetPaymentId` is this payment are unapplied from
    those payments first. They stay Posted. Then this payment is voided and
    deleted.
- **Guard bypass:** `prevent_invalid_deposit_refund` returns early on
  `app.force_delete`. Edit its handler file, then run
  `authz migration force-delete-deposit-bypass`.
- **Remove the refusals:** the settlements, applications and "marked Paid"
  refusals come out of `getForceDeleteRefusal`. The modal and banner name the
  payments and memos that will be unapplied.

### Task 3: reverse by journal (any void refusal)

New `reverseDocumentByJournal(trx, {companyId, userId, document, reversal})`.
Step 1 calls it when the document's void refuses with a rule error (< 500); a
5xx error still stops the approval. It runs in step 2's transaction, before the
delete.

1. **Holds** (`withInspectionRelease` around everything that moves stock):
   - cancel the receipt's open, partial and rejected inspections;
   - `removeUnpickedPutAways`;
   - move rejected-unit stock back. These are "Direct Transfer" rows whose
     `documentId` is an inspection id; reverse them.
2. **Journal:**
   - Lines: `documentJournalLines(trx, {documentId, documentType})`. A sales
     invoice also includes its rental and contract legs (by `journalId` +
     `journalLineReference`, as its void does).
   - Negate them with the purchase invoice void's mapping, under one header
     (`createAdjustmentJournal` with the document's `sourceType`,
     "FORCE DELETE <id>").
   - Then `allocateJournalLineIds` and `copyJournalLineDimensions`.
3. **Stock:** net every `itemLedger` row of the document by item, location,
   storage unit, tracked entity and project.
   - `bookAdjustment(..., accounting: null)` for `-net`, so the journal is not
     booked twice. Negative on-hand is allowed.
   - Run `applyAverageCostChanges` first.
   - True-up: put the difference between the cost the adjustments relieved
     and the negated inventory line on `inventoryAdjustmentVarianceAccount`,
     in the same journal. This is the `trueUpGoodsReceivedNotInvoiced` idea.
   - A consumed serial or batch posts untracked, with no phantom serial.
     Tracked entities go to 0 / Consumed, except Scrapped and Rejected, with a
     `trackedActivity`.
4. **Sub-ledgers:**
   - `reverseProjectLedgerRows` and `reverseProjectCipRows`;
   - purchase order received quantities (Task 1's helper);
   - purchase and sales order invoiced quantities (`getInvoicedPurchaseQuantityAfterVoid`);
   - a sales return's lines, then `refreshSalesReturnOrderStatus`;
   - lease payments back to Pending;
   - rental periods and charges, contract lines, billable items and service
     jobs. These are already released by `deleteSalesInvoiceReleasingRentals`;
     the voided path goes through it too.
5. **Before the cutover (no lines to negate):**
   - Invoice: one journal for its open amount, AR/AP control against
     `customerWriteOffAccount` / `supplierWriteOffAccount`.
   - Receipt: the existing variance write-down.
   - Payment: `rebuildPaymentJournal`, then negate it (as its void does).

### Task 4: downstream postings

- **Recognized revenue** (sales invoice, Posted schedule rows):
  - For each `revenueRecognitionRunLine` of this invoice's schedules, post
    one reversing journal of just those amounts: Dr revenue / Cr deferred, on
    the schedule's accounts and dimensions.
  - Delete the run lines (RESTRICT) and the schedule rows.
  - The run stays Posted, smaller by this invoice. Its other lines are not
    touched.
- **Capitalized asset** (purchase invoice CIP cost on a capitalized asset):
  - Post Cr fixed asset / Dr CIP for the invoice's `fixedAssetCipCost`
    amount. Its own reversal then nets CIP.
  - Lower the asset's `acquisitionCost` and delete the CIP rows.
  - Depreciation already posted on that cost stays. The request modal says
    so, and names the asset.

### UI and docs

- **Modal bullets:** they say what approving will do, from what was read at
  request time:
  - "unapplies PAY…/CM…";
  - "reverses recognized revenue in RUN…";
  - "takes $X off asset FA…";
  - "voids it, or reverses it by journal if the void refuses".
- **AGENTS.md:** update the invoicing and inventory force delete paragraphs.
  Add a `.ai/lessons.md` entry: a void's refusal is a fallback trigger here,
  not a stop.
- **Translations:** `lingui:extract` + `lingui:clean`, then fill the strings
  with `/translate`.

## Files

- `apps/erp/app/modules/invoicing/invoicing.service.ts`:
  - `unapplySettlements`, `reverseDocumentByJournal`, and the downstream
    reversals;
  - `getForceDeleteRefusal` slimmed down;
  - the payment void widened.
- `apps/erp/app/modules/invoicing/invoicing.server.ts`:
  - the Approving claim;
  - the fallback in step 1/2.
- `apps/erp/app/modules/purchasing/purchasing.server.ts` and
  `purchasing.service.ts`: the PO claim, batched restore, widened types.
- `apps/erp/app/modules/inventory/inventory.service.ts`: the extracted
  receipt-void quantity helper.
- `packages/database/src/event-system/handlers/prevent_invalid_deposit_refund.sql`,
  plus a migration for the `Approving` enum value, plus the generated
  authz migration.
- `apps/erp/app/components/ForceDelete/DocumentForceDelete.tsx`, the loaders,
  `routes/x+/purchasing+/_index.tsx`.
- Tests:
  - `shared.models.test.ts`;
  - a pure test for the receipt quantity helper;
  - a pure test of the unapply line builder, if it is extracted as pure
    (planned).

## Verification

1. vitest:
   - the new pure builders: unapply lines balance per currency, and the FX
     sign;
   - the quantity helper;
   - the existing `purchasing.models.test.ts` and `shared.models.test.ts`.
2. Biome, ERP/jobs/ee typecheck (one at a time, memory), conformance gate.
   `db:check:datasets` runs in the commit hook.
3. **Chrome E2E** (localhost = Test, 127.0.0.1 = Second Admin), on the
   worktree ERP at :53150:
   - **Paid purchase invoice** (AP000006 Partially Paid / AP000003): approved.
     - The payment stays Posted, and its on-account credit appears.
     - The invoice is deleted.
     - In `wt_app`: an unapply journal on the payment, and the AP tie-out
       balanced (`get_ap_tie_out`).
   - **The now-unapplied payment:** force delete it; it is voided and
     deleted.
   - **Paid sales invoice** (AR000004 / AR000005): the same checks.
   - **The earlier void refusals** go through by journal and are deleted:
     - RE000009 (partial inspection): stock adjusted out, inspection
       cancelled, PO quantities restored;
     - RE000001 (return with credit memo);
     - RE000005.
   - **AP000002** (base status "Paid"): reversed by journal and deleted.
   - **Race:** approve, and cancel during the void. The cancel is refused
     (Approving).
   - **Downstream:** recognized revenue and a capitalized asset, if
     `wt_app` has one. Otherwise set one up through the UI. These may need
     data setup; report what could and could not be exercised.
   - **Regressions:** the PO force delete still works, and Draft/Voided
     documents are deleted directly.
4. After each task, commit on the branch and push to #2197 (draft).
