# Force delete for invoices, receipts and payments

## Context

PO force delete (#2189) lets one Admin ask, with a reason and the typed
number, to delete a purchase order that the normal delete refuses. Another
Admin approves it, and the approval deletes the order. The user wants the same
override, with the same approval, for:

- purchase invoices;
- sales invoices;
- receipts;
- payments (one table, so customer and supplier payments both).

Today each of these deletes only while it is Draft. Purchase and sales invoices
also have a DB interceptor that refuses the delete (`prevent_posted_*_invoice_deletion`).
A Posted document can only be voided, and a Voided one stays forever. The
override's job: **void it if it is Posted (the existing void reverses its
postings exactly), then delete the row**. User decisions:

- invoices means purchase and sales;
- **one shared table** for the new types; the PO table stays as is.

Work is on the new branch `dane/force-delete-documents` (worktree
`/Users/dane/Code/carbon/eloquent-archimedes`), cut from the PR #2193 fix.

## Approach

### Database (one migration, plus the generated RLS migration)

- `ALTER TYPE "approvalDocumentType" ADD VALUE 'documentForceDelete'`.
- `CREATE TYPE "forceDeleteDocumentType" AS ENUM ('purchaseInvoice', 'salesInvoice', 'receipt', 'payment')`.
- Table `forceDeleteRequest`, shaped like `purchaseOrderForceDeleteRequest`
  (id `id('fdr')`, the same Pending/Executed/Rejected/Cancelled enum
  `purchaseOrderForceDeleteStatus`, reused). It has these columns:
  - `documentType`, `documentId`, which is TEXT with no FK, because the
    document is deleted;
  - `documentReadableId`, `documentStatus` (TEXT);
  - `reason` (with the length check), `requestedBy`/`decidedBy`, and the
    audit columns.
  - It has a unique partial index on `(companyId, documentType, documentId)`
    WHERE Pending, plus the FK indexes.
- `approvalRequests` view: add a `documentForceDelete` arm (readable id is
  `documentReadableId`, description is `reason`).
- Bypass the two invoice delete interceptors only under a transaction-local
  GUC, `app.force_delete = 'on'`. This copies `app.inspection_release`:
  `CREATE OR REPLACE` `prevent_posted_purchase_invoice_deletion` and
  `prevent_posted_sales_invoice_deletion` with an early `RETURN`.
  - `prevent_invalid_deposit_refund` already lets a Voided payment be
    deleted, so it is not changed.
- authz manifest: `forceDeleteRequest: serviceOnly()`. Then run
  `pnpm --filter @carbon/database authz migration` and
  `pnpm run generate:types`.
  - Shared DB rule: apply the migration to `wt_app` with `pnpm db:migrate`
    from the worktree, never `crbn migrate`.
- `@carbon/ee` approvals: add `documentForceDelete` to `approvalDocumentType`,
  its label, and `adminApprovedDocumentTypes`. It is then Admin-approved, and
  the generic approve and reject are refused, as for POs.

### Server: one set of service functions in the `shared` module

`apps/erp/app/modules/shared/shared.server.ts` gets
`requestDocumentForceDelete`, `decideDocumentForceDelete` and
`cancelDocumentForceDelete`.

- Each takes `documentType`. `permission` is a keyed rule
  (`{ by: "documentType", rules: { purchaseInvoice: { delete: "invoicing" }, salesInvoice: …, payment: …, receipt: { delete: "inventory" } } }`),
  the same pattern as `actionTaskRule`.
- The Admin check (`isCompanyAdmin`) and the flow copy the PO functions:
  1. Request: the caller must be an Admin and type the readable id. Run a
     pre-check, insert the request and its `approvalRequest`, then audit and
     notify.
  2. Approve, step 1 (before the transaction): if the document is Posted, run
     its existing void through `invokePosting`. A refusal stops the approval
     with `"<id> could not be voided: <message>"`, and the request stays
     Pending.
  3. Approve, step 2 (`ctx.transaction`): lock the request and its approval,
     and lock the document. Refuse if it is still Posted or Pending (being
     posted). Then set `app.force_delete` local, delete the document and its
     dependents, mark the request Executed and the approval Approved.
  4. Reject and cancel behave as for POs.

Per-type adapters go in `shared.service.ts`, as one table of
`{ read, void, delete }` per document type:

| Type | Read (readable id, status) | Void (step 1) | Delete (step 2) |
|---|---|---|---|
| purchaseInvoice | `invoiceId`, status | `postPurchaseInvoice` void (the same as `voidPurchaseInvoice`). Paid/Partially Paid refuses: "void or force delete its payments first" | `deletePurchaseInvoiceReleasingLeases` (lease rows go back to Pending) |
| salesInvoice | `invoiceId`, status | `postSalesInvoice` void | `deleteSalesInvoiceReleasingRentals` |
| payment | `paymentId`, status | `postPayment` void | delete the payment (settlements cascade) |
| receipt | `receiptId`, status | `postReceipt` void. On the moved-stock or pre-cutover refusals, fall back to `reverseReceiptsByAdjustment` (purchasing.service.ts), as the PO force delete does. An `invoiced` receipt refuses: "force delete its purchase invoice instead" | delete the receipt (lines cascade) |

What each void leaves, and how step 2 handles it (from the code):

- **Invoice settlements.** Neither invoice void touches `invoiceSettlement`.
  Rows with `targetPurchaseInvoiceId`/`targetSalesInvoiceId` are ON DELETE
  RESTRICT.
  - Settlements whose source (payment or memo) is **Voided** are inert, so
    they are deleted in step 2.
  - A source that is Posted or Draft refuses, at request and again at approval:
    "Void or force delete these first: PAY…, CM…".
  - This replaces the purchase void's "payments applied" check. That check
    reads the base `status`, which is never set to Paid, so it never fires.
- **Purchase invoice receipts.** Voiding a purchase invoice reverses the
  stock it received, but its `invoiced` receipts stay Posted. Step 2 sets those
  receipts (`sourceDocumentId = invoiceId`, `invoiced`) to Voided.
- **Sales invoice void.** It already reverses shipments, rentals, contracts
  and service jobs. `deleteSalesInvoiceReleasingRentals` refuses non-Draft
  invoices. Split its Draft check from the release-and-delete body, which the
  force delete calls under lock. Do the same for
  `deletePurchaseInvoiceReleasingLeases`.
- **Payment void.** It keeps the payment's own settlements, which cascade
  when the payment is deleted.
  - `prevent_invalid_deposit_refund` lets a Voided payment be deleted, so it
    needs no bypass.
  - Rows naming it as `sourcePaymentId`/`targetPaymentId` (RESTRICT) refuse:
    "remove its applications from PAY… first".
- **Receipt.**
  - The void restores PO line `quantityReceived` and the PO status.
  - The adjust-out fallback (`reverseReceiptsByAdjustment`) does not, since it
    was written for a PO that gets deleted. For a receipt on its own, add
    `restorePurchaseOrderReceived(db, {receiptId})` to
    `purchasing.service.ts`. It subtracts the received quantities, sets
    `receivedComplete`, and sets the header from `getPurchaseOrderStatus`
    (only while the status is in `PURCHASE_ORDER_RELEASED_STATUSES`), as the
    void does at inventory.service.ts L14914–15303.
  - `invoiced` receipts refuse: "force delete its purchase invoice instead".
- Refusals that stay, given as `"<id> could not be voided: <message>"`. There
  is no fallback for these:
  - invoices posted before the cutover;
  - recognized revenue;
  - a capitalized asset;
  - a payment's funding-source or deposit-refund refusals.
- Pre-check at request time: refuse early on the settlement, application and
  `invoiced` refusals above, so a doomed request is never opened.
- Rule errors, such as a DB `RAISE`, map through `raisedMessage`, as in the PO
  code.
- Generalize the PO helpers rather than copying them. In
  `purchasing.models.ts`, the reason validator, the approval and withdraw
  refusals, and `isPurchaseOrderForceDeleteConfirmed` become
  document-agnostic functions in `shared.models.ts`. The PO code imports them.
  The messages say "force delete" without naming the document type.
  - `notifyForceDelete`/`auditForceDelete` get a document variant in
    `shared.service.ts`.

### Notifications

- `packages/jobs/.../notifications/content.ts`: a `documentForceDelete`
  branch reads `forceDeleteRequest` by id (documentId is
  `"<documentType>:<documentId>:<requestId>"`).
- `apps/erp/app/utils/notification-target.ts`: open the document. When
  approved, open the type's list (`path.to.purchaseInvoices`,
  `salesInvoices`, `receipts`, `payments`).

### UI: one shared component, wired into four headers

- `apps/erp/app/components/ForceDelete/DocumentForceDelete.tsx` (new) has the
  generic `DocumentForceDeleteModal`, `DocumentForceDeleteBanner` and
  `ForceDeleteMenuItem`. It copies `PurchaseOrderForceDelete.tsx`, including
  the `onOpenAutoFocus` fix.
  - It takes `documentType`, `documentId`, `readableId`, a status-specific
    bullet ("Approving voids it first: its postings are reversed" when
    Posted), and the route-data path.
  - The PO component stays as it is.
- Route `apps/erp/app/routes/x+/force-delete+/$documentType.$documentId.tsx`
  is an action only. It copies `$orderId.force-delete.tsx`: it redirects to
  the document's details page, or to the list once Executed, with the flash
  messages. It adds `path.to.documentForceDelete(type, id)`.
- Each document's layout loader
  (`purchase-invoice+/$invoiceId.tsx`, `sales-invoice+/$invoiceId.tsx`,
  `receipt+/$receiptId.tsx`, `payments+/$paymentId.tsx`) adds `isAdmin` and
  `forceDeleteRequest` (`getPendingForceDeleteRequest(db, {companyId, documentType, documentId})`).
  Each page renders the banner above its content.
- The headers (`PurchaseInvoiceHeader`, `SalesInvoiceHeader`, `ReceiptHeader`,
  `PaymentHeader`) get the "Force Delete (Admin)" menu item, shown only to
  Admins and disabled while a request is pending.
- Pending approvals: the purchasing dashboard row works for POs only. The
  approvals list (`approvalRequests` view) shows the new type. Add a row to
  the invoicing dashboard's approvals if one exists; otherwise skip it.
- Run `lingui:extract`. English only; suggest `/translate` afterwards.

### Docs

- `apps/erp/app/modules/invoicing/AGENTS.md` and `inventory/AGENTS.md`: one
  paragraph each.
- `.ai/plans/2026-11-10-force-delete-documents.md`: this plan, copied on
  execution.

## Verification

1. vitest for the generalized model functions (refusals, confirmation, adapter
   message text), plus the existing `purchasing.models.test.ts` (still 123).
2. Biome. Scoped ERP typecheck only when no other large `tsc` is running.
   Conformance gate (`pnpm --filter @carbon/checks` `run.test.ts`).
3. E2E in Chrome on the worktree ERP. localhost is Test Admin; 127.0.0.1 is
   the Second Admin (`test+admin2@carbon.ms`). For each of the 4 types:
   - **Draft:** request, approve, deleted. The toast shows, and the list no
     longer has it.
   - **Posted:** request, approve. It is voided (check the journal VOID
     rows/status in `wt_app`), then deleted.
   - **Refusals:**
     - a Paid purchase invoice refuses, naming the payments;
     - an invoiced receipt refuses;
     - the requester cannot approve;
     - a non-Admin sees no menu item.
   - **Reject and cancel:** the request closes and the document stays.
   - **Receipt with moved stock:** the adjust-out fallback.
4. Commit via `/check-and-commit`, then push and open a PR.
