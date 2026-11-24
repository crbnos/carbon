# Post a pre-cutover purchase invoice to the GL + lock posted invoice lines in the API

Worktree: `/Users/dane/Code/carbon/app/.claude/worktrees/post-pre-cutover-invoice-gl`
Branch: `fix/post-pre-cutover-invoice-gl` (from `origin/main` d7d4046c55, no upstream)

## Context

A purchase invoice posted before a company's accounting cutover at $0 had its
posted lines repriced after the cutover through the API/MCP. That path has no
posted check. The subledger now holds the new total with no GL entry, and the
opening journal has no AP line for the invoice. The payment poster then refuses with "Target is
missing its original control account" (`invoicing.service.ts:15086`). Nothing
in the app can fix this today:
- Voiding a pre-cutover invoice is refused.
- A manual journal entry cannot key AP to an invoice.
- Repricing again writes no journal.

The goal has two parts:
1. **"Post to GL"** on such an invoice. It books what Carbon's own purchase
   posting would book for each line, given the receipts, GR/IR and cost
   layers as they are now. It credits AP keyed to the invoice, so payments
   post, and it keeps the inventory and fixed-asset subledgers tied to the GL.
2. **Close the hole.** Creating or updating lines on a posted purchase invoice
   is refused in the service functions, so it is refused through the API and
   MCP, not only in the route.

## Part 1: "Post to GL"

### Eligibility (one predicate, used by server and loader)
`purchaseInvoiceLedgerGap(trx, companyId, invoiceId)` in `invoicing.service.ts`
reports why an invoice is eligible or refused. An eligible invoice meets all
of these:
- Its status is `Open`, with nothing applied (balance = total). Paid,
  Partially Paid, Voided, Draft and Pending are refused.
- `postingDate < cutoverDate` (`readAccountingCutoverDate`, `isBeforeCutover`).
- It is not in `accountingCutoverIgnoredInvoice`.
- It has no payable control line: `readTargetControlLines` + `foldTargetControls`
  (INV:13831/13883) find none. This is the same test the payment poster uses,
  so it also makes the action idempotent.
- Its total is not 0.
- Out of scope for v1, each refused with a plain message:
  - lines with a tax code (recoverable tax);
  - direct item lines (no PO line, received with the invoice);
  - project charges, lease lines, an intercompany supplier;
  - Standard-cost items;
  - a Construction in Progress class asset.

### Facts (catch-up loader)
`loadCatchUpPostingFacts`, in `invoicing.service.ts`, is modelled on
`buildLegacyPurchaseInvoiceJournals` (`accounting.service.ts:18962`). It builds
`BuildPurchaseInvoicePostingLinesInput` for the posted invoice. The rule
behind every read: show the engine the PO line as it was before this invoice,
and the receipts and layers as they are now. The engine's own readers get
three things wrong on an invoice that is already posted, and the loader avoids
each:
- **`quantityInvoiced`:** it already includes this invoice, so the loader
  passes `invoicedBefore` instead (as the legacy builder does, ACC:19274).
- **Receipt journals for each PO line:**
  - It takes GR/IR lines keyed `receipt:<poLineId>` in Posted journals,
    which covers receipts on or after the cutover (`documentJournalLines`
    excludes Superseded journals).
  - It adds the opening journal's GR/IR line for the PO line, if the cutover
    left one.
  - It keeps every PO line with any receipt, not only lines with
    `received > invoiced`.
- **Cost layers:**
  - **Received on or after the cutover:** that receipt's own layers.
  - **Received before the cutover, or never received:** the item's opening
    layer (`documentId` null, `postingDate` = cutover, `adjustment` false).
    The units come from the layer's remaining quantity, less what earlier
    lines in the same run took, oldest invoice first. The engine can find
    these layers because the loader supplies them as coverage.
- **Value already in the opening balance:** units drawn from an opening layer
  that carries a cost were
  already valued in the opening inventory against Migration Clearing. The
  loader passes that value as the line's receipt cost, cleared against an
  **offset account** instead of GR/IR. The default offset is the Migration
  Clearing account the cutover used, and the accountant can choose another in
  the modal. The engine treats only the rest as variance, split between the
  layer's write-up and PPV. A layer at $0 has nothing to offset, so the result
  is exactly what the tested SQL produced.
- **Fixed assets:** `fixedAssetReceiptCost` reads the asset's post-cutover
  receipt GR/IR, which a post-cutover asset receipt holds. It must be exported
  (INV:17635), and `receiptGroups` too (INV:17612).

### Build and write (one transaction)
`postPurchaseInvoiceToLedger(ctx, { invoiceId, postingDate, openingOffsetAccountId? })`
is a building block. It runs these steps in one transaction:
1. Computes `journalPostingStatus` before the transaction.
2. Locks the invoice `FOR UPDATE`, re-runs the eligibility predicate, and
   calls `assertPostingStatusUnchanged`.
3. Requires `ctx.can({ update: "accounting" })`, like rounding.
4. Checks `postingDate >= cutoverDate`, then locks the period `FOR UPDATE`
   and requires it to be Open (`lineAccountChangePeriodRefusal` and
   `resolveAccountingPeriod(…, "historical")`, as in
   `postPurchaseInvoiceRoundingJournal`).
5. Calls `buildPurchaseInvoicePostingLines(facts)` (pure, INV:16435).
   - The engine's GR/IR clearing line for the opening-value part is swapped to
     the offset account.
   - The engine's "unreceived → GR/IR accrual" branch must not be reached; the
     loader treats those units as opening-layer units, and an assertion
     refuses the run if the branch is reached anyway.
6. Inserts one journal:
   - `sourceType` "Purchase Invoice", status `postingStatus`, dated
     `postingDate`, `getNextSequence(trx, "journalEntry")`.
   - The description reads "Purchase Invoice <number> (posted after cutover)".
   - Lines through `allocateJournalLineIds`, with dimensions through
     `journalLineDimensionRows`.
7. Applies only these subledger side effects:
   - adjustment `costLedger` rows (with `appliesToCostLedgerId`);
   - `applyAverageCostChanges` for Average items;
   - `fixedAssetWrites`, which set `acquisitionCost` to the line total;
   - for a Draft asset only: Draft → Active, with the acquisition and
     depreciation start date set to `postingDate`.
8. Skips everything the original posting already did: receipts, `itemLedger`,
   PO `quantityInvoiced` and status, invoice status, posting date, due date,
   the funds gate and tax ledger rows. The engine's catch block that resets
   the invoice to Draft is never reached.
9. Returns the journal id, its number and the totals for each account.

`previewPurchaseInvoiceLedgerPosting(ctx, { invoiceId, postingDate, openingOffsetAccountId? })`
runs the same loader and builder without writing anything. It returns the
lines grouped by account and checks that they balance. Both functions share
one internal `planCatchUpPosting`, so a preview and a post never differ.

### Service functions (`invoicing.server.ts`, beside `adjustPurchaseInvoiceRounding`)
- `postPurchaseInvoiceToLedger`: `permission { update: "invoicing" }`, `@mcp`,
  wrapped in `run(ctx, "post-purchase-invoice-to-ledger", …)`.
- `previewPurchaseInvoiceLedgerPosting`: `@mcp read`.

### UI (copies "Adjust for Rounding" file for file)
- **Route `x+/purchase-invoice+/$invoiceId.post-to-ledger.tsx`:** it validates
  the form, then calls `api.invoicing.postPurchaseInvoiceToLedger`. A GET
  loader serves the preview, or there is a sibling `api+` loader, whichever
  is the existing pattern.
- **`path.to.purchaseInvoicePostToLedger`** in `apps/erp/app/utils/path.ts`.
- **`PurchaseInvoicePostToLedgerModal.tsx`:**
  - a date picker that defaults to the cutover date and allows no earlier
    date;
  - the offset account, shown only when the preview has an opening-value
    part;
  - the preview table (account, debit, credit);
  - a Post button.
  - It uses `useAction` with a success toast.
- **`PurchaseInvoiceHeader.tsx`:** a "Post to GL" menu item, shown only when
  the loader's `ledgerGap.eligible` is true. It is disabled without
  `update:accounting`.
- **`$invoiceId.tsx` loader:** it reads `ledgerGap` (cheap; only for Open
  invoices before the cutover). It reads the cutover date as `lease+/$id.tsx`
  does.
- All strings go through Lingui; run `pnpm lingui:extract` and `/translate`.

## Part 2: lock posted lines in the service functions

In `invoicing.server.ts`, call `service.unlockedPurchaseInvoice(ctx, invoiceId,
"Cannot modify a confirmed purchase invoice.")` first in:
- `createPurchaseInvoiceLine` (:2732), which also updates when given an `id`;
- `updatePurchaseInvoiceLine` (:2858), which reads the line's `invoiceId`
  first so a caller cannot pass a mismatched pair;
- `mapPurchaseInvoiceLines` (:1437), after confirming that no caller maps
  lines on a posted invoice on purpose.

Before adding the guard, grep the internal callers (Ramp bill sync,
`@carbon/jobs`, workflows, `posting()`). If one edits posted lines on purpose,
stop and report it rather than break it. The sales side is already guarded
(:261, :360). It is the model and needs no change.

## Tests
- **`apps/erp/test/database/purchase-invoice-post-to-ledger.test.ts`:** built
  on `activationFixture` and `moveBeforeCutover` (`fixtures/activation.ts`)
  and the `purchase-invoice-rounding.test.ts` layout. It covers these cases:
  1. **The motivating case.** A PO is received before the cutover at $0 and its
     invoice is posted at $0. The enable runs, the line is repriced, and Post
     to GL runs. Expected:
     - AP = the total, keyed to the invoice;
     - the opening layer is written up by its on-hand share and PPV takes the
       rest;
     - Σ adjustment costLedger = the Inventory debit;
     - a payment then posts.
  2. **Received after the cutover at the PO price.** GR/IR is cleared, and
     only the difference goes to Inventory/PPV.
  3. **Received after the cutover at $0.** The full amount goes to the
     receipt layer.
  4. **Fixed asset received after the cutover at the pre-tax price.** GR/IR
     clears, the asset is debited for the tax, and `acquisitionCost` = the
     line total. A Draft, unreceived asset goes Active.
  5. **Opening layer with a cost.** The opening value is cleared to the
     offset account and only the rest is variance.
  6. **Refusals:**
     - a second run (now has a control line);
     - a Paid or Partially Paid invoice;
     - an invoice after the cutover;
     - a closed period;
     - a date before the cutover;
     - an ignored invoice;
     - no `update:accounting` permission;
     - each v1 out-of-scope line type.
  7. **Preview = post.** The preview lines equal the journal lines written.
- **`apps/erp/test/purchase-line-tax-operations.test.ts`:** create and update
  on a non-Draft invoice return a `rule` error and write nothing. The same for
  `mapPurchaseInvoiceLines`.

## Docs
- `docs/content/docs/reference/invoices.mdx`: a "Posting a pre-cutover invoice
  to the GL" section next to "Changing a posted line's account", and a
  troubleshooting entry for "Target is missing its original control account".
- `apps/erp/app/modules/invoicing/AGENTS.md`: list the two operations, and
  state that posted line create, update and map are refused in the service
  functions.
- A changelog entry through `/changelog-entry`.
- `.ai/lessons.md`: a route-only lock guard is not a lock, because the API
  and MCP call the service function. The rule: guard in the service function.

## Verification
1. `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`, and the
   scoped vitest runs for the new and changed test files (main agent only for
   the heavy checks).
2. Run the database tests above against the worktree's local DB
   (`crbn up` / `pnpm db:migrate`; no schema change is expected).
3. **Parity with a hand-computed posting.** On a local restore that has an
   affected invoice, run the preview and compare it, line by line, with a
   posting computed by hand from the same receipts, GR/IR and layers. Explain
   any difference before going on.
4. Browser check with `/test`: the menu item appears only on an eligible
   invoice, and the preview, post and toast work. Afterwards a payment posts,
   and the menu item is gone.
5. `/self-review`, then commit with `/check-and-commit`. Pushing and the PR
   wait for your go-ahead.
6. **Rollout, after deploy.** The affected company's accountant runs Post to
   GL on each affected invoice, then posts the payments. Verify through
   read-only production reads.
