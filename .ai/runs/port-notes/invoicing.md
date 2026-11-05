# Port notes: invoicing (plan Phase 4)

Agent `invoicing`. Worktree `kelowna-port`. Nothing committed.

## Carried (carry-list line → new home)

- [x] `packages/server-functions/src/post-purchase-invoice/project-charges.ts` → new plain file
  `apps/erp/app/modules/invoicing/project-charges.ts`. Body unchanged. Imports:
  `../lib/project-posting` → `~/modules/projects/project-posting`; `../lib/stock-stripes` →
  `@carbon/api/stock-stripes`; `Kysely` type from `@carbon/database/client` (not `kysely`).
  SPDX header: the fixer reports it correct (AGPL).
- [x] `post-purchase-invoice/posting-lines.ts` → `invoicing.service.ts`
  (`InvoicedPurchaseOrderLine.planningGroupId`, `glAccount.projectElementId`,
  `BuildPurchaseInvoicePostingLinesInput.projectCharges`, new `PurchaseInvoiceProjectDraft`,
  `PurchaseInvoicePosting.projectDrafts`, and every hunk of `buildPurchaseInvoicePostingLines`:
  receipt-charged lines lose their layers, `ProjectElement` dimension, Non-Inventory direct
  lines and services debit the project account, member-stripe Material Variance on planning
  group PO lines, the receipt-charged PPV goes to the receipt's project account, the
  Charge-at-receipt-into-project-stock variance draft, G/L lines take the project account).
- [x] `post-purchase-invoice/index.ts` → `postPurchaseInvoice` in `invoicing.service.ts`.
  Void: reversing item-ledger and cost-ledger rows (plain, adjustment-child counter rows,
  self-heal mirror rows) copy `projectId`; reversing journal line ids come from
  `allocateJournalLineIds` (`~/modules/shared/shared.service`) so `reverseProjectLedgerRows`
  gets `reversalLineIds`; then `reverseProjectCipRows`. Post: `ProjectElement` dimension
  loaded, receipt layers carry `projectId`, `loadInvoiceProjectCharges` before the lease
  facts, `planningGroupId` and `projectElementId` on the posting lines, `projectCharges` to
  the builder, the direct-invoice item ledger and cost layer go into
  `projectCharges.stockStripe(line)` (null for Non-Inventory), adjustment children carry
  their layer's stripe, the self-heal layer carries the line's stripe, and after the
  intercompany block the `projectLedger` rows (`insertProjectLedgerRows` +
  `buildProjectLedgerRow`, journal line id by `journalLineIndex`) and CIP rows
  (`writeProjectCipRows` + `buildProjectCipRow`). Body variables (`db`, `companyId`,
  `userId`) already existed in main's body, so the hunks applied as written.
- [x] `post-sales-invoice/index.ts` → `postSalesInvoice` in `invoicing.service.ts`:
  `billedServiceLineIds` (one `projectBillableItem` query) gives those lines no COGS pair
  (`directCost` → null), no shipment/ledger, and keeps them out of the direct-COGS loop;
  direct COGS is `calculateCOGS(..., projectId: null)` and its cost ledger row writes
  `projectId: null`; item ledger rows go through `withStripe(rows, null)`
  (`@carbon/api/stock-stripes`); void reversals copy `projectId`; void sets billed
  `projectBillableItem` rows back to Unbilled with `voidedSalesInvoiceId`.
- [x] `post-payment/journal-input.ts` → `paymentKind` in `invoicing.service.ts`: a payment
  with `customerContractId` is a deposit.
- [x] `apps/erp/app/modules/invoicing/invoicing.server.ts` (branch hunks: `getDepositDocuments`
  loads contracts as `customerContract` deposit documents; `checkDepositDocument` checks a
  contract deposit) → main moved both into `invoicing.service.ts`; replaced both bodies with
  the branch's.
- [—] `apps/erp/app/modules/invoicing/reimbursement.server.ts`: the branch did NOT change it
  (`git diff 23bd5d6e0b 50c4309a9c` is empty). Nothing to carry.
- [x] Branch's `invoicing.service.ts` / `invoicing.models.ts` / UI hunks: the merge had already
  carried them (verified: reimbursement `projectElementId`, contract deposit scope in
  `getOpenInvoicesForParty`, `depositContract` on-account sources, `customerContractId` in
  `upsertPayment`, the validators, `DepositDocument.kind`).
- [x] `x+/payments+/new.tsx` → the `linkFinancingPayment` call moved into the `createPayment`
  operation (`invoicing.server.ts`): new optional input `financingRequestId`; after the insert,
  when the payment has `customerContractId`, it links the request (`ctx.asCaller.supabase`,
  `ctx.asSystem.pg`); a failure is logged and the payment kept, as on the branch. The route
  passes `financingRequestId` from the form. The unused `getLogger` import was removed.
- [x] `x+/payments+/$paymentId.post.tsx` → `markFinancingRequestsPaid` moved into the
  `postPayment` operation, after a successful post (logged on failure, as on the branch). The
  route needs no change. Behaviour note: every caller of the operation (API/MCP too) now
  marks the requests Paid, not only the route button.
- [x] `x+/purchase-invoice+/$invoiceId.new.tsx` and `$invoiceId.$lineId.details.tsx`: the merge
  kept the branch's `chargeNumberError` calls and loader but dropped the imports; added
  `chargeNumberError` (`~/modules/projects/projects.server`) and `getLineChargeNumber`
  (`~/modules/projects/projects.service`). These routes call `upsertPurchaseInvoiceLine`
  directly on main too (not an operation), so the route check stays for the field error.
  The same check is also added to the `createPurchaseInvoiceLine` / `updatePurchaseInvoiceLine`
  operations (input gains `projectId`, `projectElementId`), so the API/MCP path is refused too
  (`validation` error).
- [x] `x+/reimbursements+/$reimbursementId.edit.tsx` → the `chargeNumbersError` check moved into
  the `saveReimbursement` operation, first thing (so also `saveAndPostReimbursement`, which
  calls it). One ordering difference: on the branch the charge check ran before the totals
  guard; `saveAndPostReimbursement` now checks the totals first. The toast is the same
  (`stay` shows `result.error.message`). `toClientLines`' `projectElementId` was already merged.
- [x] `x+/sales-invoice+/$invoiceId.tsx`, `x+/payments+/$paymentId.tsx`: merged cleanly, nothing
  to do. `x+/memos+`: the branch changed nothing.
- `calculatePurchasePostingAmounts`: the branch did not change `purchase-posting-amounts.ts`;
  nothing to carry.

## Not carried

- Tests (Phase 8): `post-purchase-invoice/project-invoice.test.ts`,
  `posting-lines.test.ts` (+1), `post-sales-invoice/post-sales-invoice.test.ts`,
  `post-reimbursement-transaction.test.ts`, `apps/erp/test/database/post-purchase-invoice/*`.
- `x+/settings+/invoicing.tsx` (carry-list line 69) is not under my route dirs; its typecheck
  errors (`serviceLaborItemValidator`, `Item`) belong to its owner.
- post-charge / post-reimbursement bodies (accounting agent).

## Requests for other owners

- **projects owner (Phase 6 split):** `invoicing.server.ts` and the two purchase-invoice routes
  import `chargeNumberError` / `chargeNumbersError` from `~/modules/projects/projects.server`.
  When those helpers move to `projects.service.ts`, repoint these three imports.
- **orchestrator:** operation inputs changed (`createPayment.financingRequestId`,
  `createPurchaseInvoiceLine` / `updatePurchaseInvoiceLine` `projectId` + `projectElementId`);
  regenerate the MCP tool metadata if it is pinned (`pnpm run generate:mcp`).
- **docs (low):** `apps/erp/app/modules/accounting/AGENTS.md` lines 60 and 62 are two versions of
  the "Customer deposits" bullet (branch + main); keep 60 (it names contracts) and fix its
  `getDepositDocuments` path to `invoicing/invoicing.service.ts`.

## Verification

- ERP `npx tsgo --noEmit`: no errors in `modules/invoicing/**` or the payments,
  purchase-invoice, reimbursements, sales-invoice and memos routes (213 lines of errors
  elsewhere, other owners' files and tests).
- `biome check --write` on the 7 files: clean except two pre-existing
  `suppressions/unused` warnings in the purchase-invoice routes (also on main).
- License header fixer: `project-charges.ts` correct AGPL.
