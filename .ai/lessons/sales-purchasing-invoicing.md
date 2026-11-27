# Sales, purchasing and invoicing lessons

Quotes, orders, invoices, memos, payments, contracts and rentals as documents, conversions, totals, voids.

## A posting that restates a document's status can release it past its approval

```scope
id: a-posting-that-restates-a-document-s-status-can-release-it-p
paths: ["apps/erp/app/modules/purchasing/purchasing.service.ts","apps/erp/app/modules/invoicing/invoicing.service.ts"]
triggers: ["PURCHASE_ORDER_RELEASED_STATUSES"]
```

**Context:** Purchase order approval enforcement (TCK-36). Receipt and invoice postings set the order's status from its lines: Completed, To Receive, To Invoice or To Receive and Invoice.
**Problem:** The postings were gated, but their voids were not, and none of the four writes checked the status they replaced. Voiding an invoice on an order waiting for re-approval set it to a released status with no approval, and posting an invoice against a Closed order reopened it.
**Rule:** A write that derives a document's status from its lines matches the statuses it may replace in its own `WHERE` (`.where("status", "in", PURCHASE_ORDER_RELEASED_STATUSES)`). Audit the voids and reversals along with the posts.
**Applies to:** Every posting and void that writes `purchaseOrder.status`, `salesOrder.status` or a similar derived header status.

## Sales-order Paid Amount uses invoice-target principal

```scope
id: sales-order-paid-amount-uses-invoice-target-principal
paths: []
triggers: ["getSalesOrderInvoicePaymentsByIds","invoiceSummary","sourceAmount"]
```

**Context:** Summarizing linked sales-invoice payments on a sales order.

**Problem:** `invoiceSettlement.sourceAmount` is principal in the payment funding source's currency, so it does not represent the amount applied to the invoice. Using it for the order's Paid Amount disagrees with the invoice Payments panel and can mix currency semantics.

**Rule:** Sales-order Paid Amount sums posted payment `appliedAmount` (company base) per invoice, then converts it with that invoice's exchange rate into the matching order currency. Do not use `sourceAmount` for this summary. There is no legacy `baseStatus === "Paid"` fallback that counts the full invoice total — every payment flows through `invoiceSettlement`, so a fully-paid invoice's settlements already sum to its total.

**Applies to:** `getSalesOrderInvoicePaymentsByIds`, the sales-order loader's `invoiceSummary`, and any UI summarizing cash applied to invoice targets.

## A force delete treats the void's refusal as a fallback, not a stop

```scope
id: a-force-delete-treats-the-void-s-refusal-as-a-fallback-not-a
paths: ["apps/erp/app/modules/invoicing/invoicing.service.ts","apps/erp/app/modules/invoicing/invoicing.server.ts"]
triggers: ["decideDocumentForceDelete","reverseDocumentByJournal","unapplyForceDeleteSettlements","rebuildPaymentJournal"]
```

- **Context:** the Admin force delete of invoices, receipts and payments (`decideDocumentForceDelete`).
- **Problem:** The first version refused whenever the document's own void refused, or when payments, memos or other documents still held it. Force delete exists for emergencies where a user error has broken that normal process, so those refusals left the Admin stuck.
- **Rule:** In a force delete, a void's rule refusal is the trigger for `reverseDocumentByJournal`: negate its postings, adjust its stock back, restore its sources. Anything applied to the document is unapplied first (`unapplyForceDeleteSettlements`). To change a posted payment's journal, build it again with and without the change (`rebuildPaymentJournal`) and post the difference, rather than hand-building reversal lines.
- **Applies to:** `invoicing.service.ts` force delete blocks, any future force delete type.

## A new row reusing a readable id must qualify it — `externalLink` is UNIQUE per document

```scope
id: a-new-row-reusing-a-readable-id-must-qualify-it-externallink
paths: ["apps/erp/app/modules/production/production.service.ts","apps/erp/app/modules/sales/sales.service.ts"]
triggers: ["externalLink","quoteToQuote","deleteQuote"]
```

**Context:** "Create Quote Revision" failed with a generic "Failed to duplicate quote". The real error was only in the server log of the `get-method` edge function: `duplicate key value violates unique constraint "externalLink_documentId_documentType_unique"`.

**Problem:** `externalLink` is `UNIQUE (documentId, documentType, companyId)` (`20250711000000_customer-portal-links.sql`). A quote revision deliberately keeps the same readable `quoteId` as its source, and the `quoteToQuote` branch of `get-method` (since ported to `getMethod` in `production.service.ts`) inserted a share-link row keyed on that bare id — so every revision collided with the original's link and rolled back the whole copy transaction. Worse, `deleteQuote` deletes only the `quote` row (the FK points quote→link, so nothing cascades), leaving orphan link rows that re-collide when the same revision number is issued again.

**Rule:** Any new row that reuses an existing readable id must qualify it (`Q000001-1`), and any insert into a table whose unique key can be orphaned by a delete needs `onConflict(...).doUpdateSet(...)` rather than a bare insert. When a user-facing action reports a generic failure, read the server log before theorising — the route's flash message hides the Postgres error code.

**Applies to:** `getMethod` in `apps/erp/app/modules/production/production.service.ts` (`quoteToQuote`), `apps/erp/app/modules/sales/sales.service.ts` (`deleteQuote`), any insert into `externalLink`.

## A memo's `direction` means OPPOSITE things on AR and AP

```scope
id: a-memo-s-direction-means-opposite-things-on-ar-and-ap
paths: ["apps/erp/app/modules/purchasing/purchasing.service.ts","apps/erp/app/modules/sales/sales.service.ts","apps/erp/app/modules/invoicing/invoicing.service.ts"]
triggers: ["buildMemoJournal","createPurchaseReturnOrderCredit","createSalesReturnOrderCredit","debitMemo","direction: \"Credit\""]
```

**Context:** Supplier returns settle through an AP `memo`. The RMA spec and
`createPurchaseReturnOrderCredit` both used `direction: "Credit"` — the same
value the (correct) customer-side credit uses.

**Problem:** `direction` alone decides the CONTROL side for both parties
(`buildMemoJournal`): a Credit memo CREDITS the control account, a Debit memo
DEBITS it. On AR (an asset) a credit REDUCES the balance — right for a customer
refund. On AP (a liability) a credit INCREASES it — so returning goods made
Carbon show we owed the supplier MORE, and the reason leg re-debited GR/IR
instead of clearing what the return shipment had debited, leaving a permanent
2x residual in a suspense account. Every entry still BALANCED, so no guard
fired, and it survived four review rounds. The rest of invoicing already
assumed the opposite (`getAvailableCredits` selects supplier memos with
`direction = 'Debit'`), so the memos were also invisible to "Apply Credit".

**Rule:** A vendor return is a **Debit** memo (`debitMemo` `DR-` sequence); a
customer return is a **Credit** memo. Never reason about `direction` without
naming the party — write out which way the control account moves and whether
that account is an asset or a liability. Balanced ≠ correct: when a posting has
a suspense account (GR/IR), assert the CYCLE nets to zero, not just that each
entry balances.

**Applies to:** `apps/erp/app/modules/purchasing/purchasing.service.ts`
(`createPurchaseReturnOrderCredit`), `apps/erp/app/modules/sales/sales.service.ts`
(`createSalesReturnOrderCredit`), `apps/erp/app/modules/invoicing/invoicing.service.ts`,
any new `memo` writer.

## A nullable column added by migration needs a reader that tolerates NULL

```scope
id: a-nullable-column-added-by-migration-needs-a-reader-that-tol
paths: ["packages/utils/src/payment-funding.ts"]
triggers: ["invoiceSettlement","sourceAmount"]
```

**Context:** The accounting corrections release added `invoiceSettlement.sourceAmount` (document-currency principal) without backfilling rows written before it, and the migration comment explicitly declared legacy NULLs valid.

**Problem:** The shared TypeScript reducer that computes an invoice's remaining balance and a payment's remaining funding threw "Settlement is missing its document principal" on any NULL. Every invoice with a pre-release partial payment or credit became unpayable: the New Payment loader seeded from such an invoice returned a 500, and posting a payment for that party would have failed the same way. The schema and the code disagreed about what a valid row is.

**Rule:** When a migration adds a nullable column and leaves existing rows NULL, every reader added in the same change must define what NULL means and handle it, or the migration must backfill. Keep the throw only where a DB constraint already guarantees the value (source-linked rows). Derive legacy values from the columns that did exist (`appliedAmount` at the applicable exchange rate) and cover the NULL case in the pure-function tests.

**Applies to:** `payment-funding.ts` reducers, any future column added to `invoiceSettlement`, `journalLine`, or other high-volume tables where a backfill is skipped.

## A schedule computed live has no row ids until the first edit writes it

```scope
id: a-schedule-computed-live-has-no-row-ids-until-the-first-edit
paths: ["apps/erp/app/modules/sales/ui/Contracts/ContractInvoiceGrid.tsx","apps/erp/app/modules/sales/ui/Contracts/ContractAmountsModal.tsx","apps/erp/app/modules/sales/ui/Contracts/ContractRevenueGrid.tsx","packages/database/src/contract-schedule.ts"]
triggers: ["planned:","customerContractInvoice","edit-schedule"]
```

**Context:** An unedited Draft contract has no `customerContractInvoice` rows. The loader computes the invoice schedule from the lines with the pure planner (`@carbon/database/contract-schedule`). The first edit writes the rows (plan decision 2).

**Problem:** The page sent the edit with the ids of computed rows that were not in the database. The server function wrote the schedule, then looked up those ids, found nothing, and refused the edit. So the first edit of every Draft failed. No test covered an edit from the computed state.

**Rule:** When a page shows rows that the server computes and does not store, give each row a reference by position, not an id. Contracts use `planned:<invoiceDate>` for an invoice and `planned:<invoiceDate>:<lineId>:<periodStart>[:adjustment]` for a row. The server writes the rows first, then resolves each reference against them. Test the first edit from the computed state with a database test, not from stored rows (`contract-lifecycle.test.ts`, fix commit `56fa0f7b8e`).

**Applies to:** `post-customer-contract` `edit-schedule`, `ContractInvoiceGrid` / `ContractAmountsModal` (and `ContractRevenueGrid` for the revenue plan), and any future editable preview that persists on first edit.

## Count invoices by the status the list shows, from its view

```scope
id: count-invoices-by-the-status-the-list-shows-from-its-view
paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"]
triggers: ["baseStatus","from(\"purchaseInvoice\")","from(\"salesInvoice\")"]
```

**Context:** The purchasing dashboard's Open Purchase Invoices card counted `purchaseInvoice` rows by status, and its link opens the Purchase Invoices list filtered on the same statuses.

**Problem:** The list reads the `purchaseInvoices` view, which derives `Partially Paid`, `Paid` and `Overdue` from settlements and the due date. The table stores the posted status (`Open`, or `Submitted` on sales) and keeps it once the invoice is paid. Counting the table missed every posted bill, and adding `Open` to the table filter would have counted paid bills too.

**Rule:** Count, filter or badge invoices by status from `salesInvoices` / `purchaseInvoices`, the views the lists read. Read the table's `status` (the views' `baseStatus`) only for a rule about the stored state, such as whether the invoice is posted.

**Applies to:** dashboards, KPIs and cards that count sales or purchase invoices by status.

## Document totals helpers guarded on truthy qty/price silently drop shipping- or tax-only lines

```scope
id: document-totals-helpers-guarded-on-truthy-qty-price-silently
paths: ["packages/documents/src/utils/*.ts","packages/documents/src/pdf/blocks/**","packages/documents/src/email/*Email.tsx"]
triggers: ["getLineTotal","getLineSubtotal","getLineTaxableSubtotal"]
```

**Context:** Adding line-level shipping cost display to the purchase order PDF (`packages/documents/src/pdf/blocks/purchaseOrder/`). A PO line with a 0.00 unit price and a 30.00 `supplierShippingCost` rendered Total and Subtotal as 0 on the PDF.

**Problem:** The totals helpers in `packages/documents/src/utils/` (`purchase-order.ts` `getLineTotal`/`getTotal`, and the same pattern in `sales-order.ts`/`sales-invoice.ts` `getLineSubtotal`/`getLineTaxableSubtotal`) wrapped the whole formula in `if (line?.qty && line?.unitPrice)` — so any line whose value was only shipping, add-on, or tax contributed 0 to the document, even though those amounts were displayed elsewhere on the page and included in posting math.

**Rule:** Compute document money formulas unconditionally with `?? 0` per term — never gate the whole formula on one term being truthy. Also keep a document's Subtotal semantics identical to that module's in-app summary (PO PDF Subtotal = qty × price + line shipping, matching `PurchaseOrderSummary.tsx`), and lock the helpers with unit tests (`packages/documents/src/utils/document-totals.test.ts`).

**Applies to:** `packages/documents/src/utils/{purchase-order,sales-order,sales-invoice,quote}.ts`, PDF Summary/LineItems blocks, `email/{PurchaseOrder,SalesOrder,SalesInvoice}Email.tsx`, and any new document totals code.

## Every sales invoice needs an opportunity

```scope
id: every-sales-invoice-needs-an-opportunity
paths: ["apps/erp/app/modules/sales/sales.service.ts"]
triggers: ["insertInto(\"salesInvoice\")","insertInto(\"salesOrder\")","insertInto(\"quote\")","opportunityId"]
```

**Context:** A sales invoice's documents, including the PDF written when it is posted,
live under `{companyId}/opportunity/{opportunityId}/`. `insertSalesInvoice` and
`upsertSalesInvoice` mint an opportunity and `convert` copies the sales order's, but
`salesInvoice.opportunityId` is nullable.

**Problem:** Rental billing inserted invoices with `opportunityId: null`. The invoice's
documents card crashed on `opportunity.id` (shown as "Couldn't load documents", since
`DeferredFiles` catches render errors too), and posting wrote the PDF to a literal
`opportunity/null/` folder.

**Rule:** Any new code path that inserts a `salesInvoice` (or `salesOrder` / `quote`)
creates an opportunity for it in the same transaction. Nullable in the schema does not
mean optional in the app.

**Applies to:** `apps/erp/app/modules/sales/sales.service.ts`, any Kysely/server-function writer
of `salesInvoice`; backfilled by `20261006220901_sales-invoice-opportunity-backfill.sql`.

## An edit that empties a stored draft makes it read as unedited

```scope
id: an-edit-that-empties-a-stored-draft-makes-it-read-as-unedite
paths: ["apps/erp/app/modules/sales/ui/Contracts/ContractInvoiceGrid.tsx", "packages/database/src/contract-schedule.ts"]
triggers: ["validateScheduleEdit"]
```

**Context:** A Draft contract's invoice schedule is planned live until its first edit stores it.

**Problem:** Deleting the last stored planned invoice left the same state as an unedited Draft, so the schedule returned to the live plan while the dialog said the amounts became residuals.

**Rule:** A draft that is stored on its first edit refuses an edit that would leave nothing stored, or stores a state that says it was emptied.

**Applies to:** Contract and revenue schedule editors, and any "stored once edited" draft.
