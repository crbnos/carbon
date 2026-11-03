# Purchase Order Approval Enforcement: Funds Gate, Approved-PO Edits, Approver Audit

> Status: in-progress
> Author: Claude (with Dane Albaugh)
> Date: 2026-11-03
> Ticket: TCK-36 and TCK-34 (children of TCK-31). Siblings: TCK-33 (short-close guard, PR #2114), TCK-35 (Data API lockdown).

## TLDR

Three changes make the purchase order approval rule hold for every caller (UI, HTTP API, MCP, workflows):

1. **Funds gate.** Receiving, invoicing and posting an invoice against a purchase order is refused until the order is released. When the order has an approved request, its approved amount must cover the order's current total.
2. **Approved-PO edits.** A released order that is not yet complete stays editable. An edit saves without re-approval when the new total is equal to or lower than the approved amount. An edit that takes the total above it saves, moves the order back to Needs Approval, and opens a new approval request for the new total. Supplier and currency stay locked. An order in Needs Approval is read-only.
3. **Approver audit.** Approval rules stay managed by holders of settings update (already enforced). Every change to a rule and its approvers is now recorded in the audit log.

## Overview diagram

```
            finalize ──(rule matches)──► Needs Approval ──approve──► Released
               │                           (read-only)                │
               └──(no rule)─────────────────────────────────────────►│
                                                                      ▼
   receipt / invoice / invoice post ◄── funds gate: released AND (no approved
                                         request OR approved amount ≥ total)
                                                                      │
   edit (lines, header, delivery, payment, exchange rate) ────────────┤
        new total ≤ approved amount ─────────────► stays Released     │
        new total > approved amount AND a rule ──► Needs Approval + new request
```

## Problem Statement

- The approval rule is checked only at finalize. Server operations that move money do not check it: `createReceipt`, `postReceipt`, `createPurchaseInvoiceFromPurchaseOrder`, `createPurchaseInvoiceLine` (with a purchase order line) and `postPurchaseInvoice` accept a Draft, Needs Approval or Rejected order. All are MCP tools. Only the purchase order header buttons block them.
- `postPurchaseInvoice` then writes the order's status from its lines (To Receive / To Invoice / Completed), so posting an invoice against an unapproved order releases it.
- A released order is fully locked. The only way to correct it (a description, a date, a price that does not change the total) is Reopen, which cancels nothing approved but sends the order back through approval and restarts the workflow.
- The lock lives in the routes. Six MCP tools (`createPurchaseOrderLine`, `updatePurchaseOrderLine`, `deletePurchaseOrderLine`, `upsertPurchaseOrderDelivery`, `upsertPurchaseOrderPayment`, `updatePurchaseOrderExchangeRate`) skip it.
- A Needs Approval order can be edited. Approval then releases whatever the lines total, which can exceed the amount the approver saw (`approvalRequest.amount`).
- Approval rule changes leave no record.

## Proposed Solution

### Definitions (`purchasing.models.ts`)

| Name | Statuses | Meaning |
|---|---|---|
| `PURCHASE_ORDER_RELEASED_STATUSES` | To Receive, To Receive and Invoice, To Invoice, Completed | Funds may move against the order |
| `PURCHASE_ORDER_AMENDABLE_STATUSES` | To Receive, To Receive and Invoice, To Invoice | Released and still editable under the total rule |
| `PURCHASE_ORDER_EDIT_LOCKED_STATUSES` (`isPurchaseOrderEditLocked`) | Needs Approval, Completed, Closed | Read-only |

`PURCHASE_ORDER_LOCKED_STATUSES` / `isPurchaseOrderLocked` do not change. They still decide Reopen (the `delete` permission), revisions and the delete menu.

Draft, Planned, To Review and Rejected stay editable with no total rule, as today.

The order total is the `purchaseOrders` view's `orderTotal`: base currency, line tax, line shipping and header shipping included. It is the same number finalize sends to the approval rule. The approved amount is the `amount` of the order's latest `Approved` approval request.

### 1. Funds gate

`purchaseOrderFundsRefusal` (pure, `purchasing.models.ts`) answers for one order:

- not released → refused ("must be approved and released").
- released, with an approved request, and `total > approvedAmount + EPSILON` → refused ("total is above the approved amount; it needs approval again").
- otherwise → allowed. An order released with no request (no rule matched at finalize, or the planning bypass) is allowed.

`getPurchaseOrderFundsRefusal(client, companyId, purchaseOrderIds)` (`purchasing.service.ts`) reads the orders (status, total) and their latest approved request in two queries and returns the first refusal. It is called by:

| Operation | Orders checked |
|---|---|
| `inventory.createReceipt` (source Purchase Order) | `sourceDocumentId` |
| `inventory.postReceipt` (source Purchase Order) | `sourceDocumentId` |
| `invoicing.createPurchaseInvoiceFromPurchaseOrder` | `purchaseOrderId` |
| `invoicing.createPurchaseInvoiceLine` / `updatePurchaseInvoiceLine` with a purchase order line | that line's order |
| `invoicing.postPurchaseInvoice` | every order its lines name |

Payments are not gated: a payment applies only to a posted (Open) invoice, and posting is gated.

### 2. Approved-PO edits

Every purchase order write operation runs two building blocks (`purchasing.service.ts`):

- `amendPurchaseOrder(ctx, purchaseOrderId, write, options)` runs both steps around the write for every operation.
- **Before the write:** `getPurchaseOrderEditRefusal(client, companyId, purchaseOrderId, { supplierId, currencyCode })` → the pure `purchaseOrderEditRefusal(status, …)`, plus the total before the edit. Refused in Needs Approval, Completed and Closed; supplier and currency changes refused in an amendable status. In any status, a line cannot go below its received or invoiced quantity, and a line with anything received or invoiced cannot be deleted (`purchaseOrderLineAmendRefusal`). A reopened or rejected order keeps its receipts and invoices.
- **After a line write:** when the order is amendable, `restatePurchaseOrderStatus` sets the status from the lines again (`getPurchaseOrderStatus`), as receipt and invoice posting do. A line cut to what was received moves the order to To Invoice. An order with no line other than a comment keeps its status.
- **After the write:** `settlePurchaseOrderAmendment(db, system, { companyId, userId, purchaseOrderId, previousTotal })`. When the order is amendable, it reads the new total and the approved amount. Total ≤ approved amount → nothing. With no approved request, the baseline is the total before the edit, so only an increase can need an approval. Otherwise, when `isApprovalRequired(total)`, one Kysely transaction moves the order to Needs Approval (only from an amendable status) and inserts a Pending request for the new total; the rule's approvers are notified after commit. When no rule applies to the new total, nothing changes. The planning bypass does not apply here: every amendment is an edit by hand, so a planning order released through the bypass goes to approval when an edit raises its total into a rule.

Approval of the new request (`approveRequest`) already sets the status from the lines, so a partly received order returns to To Receive and Invoice, To Invoice, and so on.

The write and the settle are two steps. When the settle fails after the write, the order stays released with a total above its approved amount; the funds gate refuses it until it is approved again.

Operations covered: `createPurchaseOrderLine`, `updatePurchaseOrderLine`, `deletePurchaseOrderLine`, `updatePurchaseOrder`, `updatePurchaseOrders`, `updatePurchaseOrderDelivery`, `upsertPurchaseOrderDelivery`, `upsertPurchaseOrderPayment`, `updatePurchaseOrderExchangeRate`, and the routes that call the building blocks directly (`$orderId.new`, `$orderId.$lineId.details`, `$orderId.$lineId.delete`, `$orderId.payment`, `$orderId.exchange-rate`).

`insertPurchaseOrder` (API and MCP) takes only `Draft` or `Planned` as `status`. Before this, a caller could create an order that was already released and skip finalize.

The UI reads `isPurchaseOrderEditLocked` for read-only state, so lines, delivery, payment and the header (supplier and currency disabled) become editable on an amendable order, and every form is read-only in Needs Approval.

### 3. Approver management

- Create and edit require settings update, delete requires settings delete (unchanged). The rule card's Delete button now needs settings delete, as the route does.
- `approvalRule` is added to `auditConfig` (entity `approvalRule`), so threshold, approver and default approver changes are logged for companies with the audit log on. Its attachments entry gets `events: true`, shipped by `20261103170119_approval-rule-audit-events.sql`. A company that already has the audit log on gets the new subscription from `syncAuditSubscriptions` when Settings → Audit Logs next loads.
- The line date rule follows the edit lock: a requested date stays editable on a released order and is locked in Needs Approval, Completed and Closed.

### Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Funds gate checks released AND approved amount ≥ total | User choice. SAP / Oracle release strategy: value increase after release resets release. |
| D2 | Orders with no approved request pass the gate | Keeps orders released before rules existed, and the planning bypass, working. The edit rule closes the gap for later increases. |
| D3 | Edit tolerance = total ≤ approved amount | User choice. A decrease never needs approval. |
| D4 | Increase → auto re-submit, not refuse | User choice. Receiving and invoicing block until approved again. |
| D5 | Supplier and currency locked on a released order | User choice. Changing who you buy from is a new order. |
| D6 | Completed and Closed stay locked | Nothing is left to receive or invoice; Reopen exists. |
| D7 | Needs Approval is read-only | User choice. Closes "edit after the approver looked". The requester or an approver reopens to edit. |
| D8 | Payments not gated | Posting the invoice is the gate; a posted invoice can be paid. |
| D9 | Approver permissions and RLS unchanged; audit added | User choice. Settings update already gates create and edit. |
| D10 | No database guard on `status` (TCK-34) | User choice: business rules live in the service code, not in triggers or SQL functions. The audit below found no app path that skips approval. |

## Status Writer Audit (TCK-34)

Every app path that writes `purchaseOrder.status` goes through an operation, a posting or an approval decision. Each one writes over the direct Kysely connection.

| Writer | Path |
|---|---|
| Finalize, reopen, close, short-close | `purchasing.server.ts` operations (`setPurchaseOrderStatus`, `submitPurchaseOrderForApproval`, `reopenPurchaseOrderAsRevision`, `shortClosePurchaseOrderLine`) |
| Approve, reject | `approveRequest` (`packages/ee/src/approvals/service.ts`) |
| Receipt post and void, invoice post | the posting bodies in `inventory.service.ts` and `invoicing.service.ts` |
| Accounting sync (Xero, QuickBooks) | the provider entity writers in `packages/ee/src/accounting/providers/` |
| New orders | `insertPurchaseOrder`: every caller passes `Draft` or `Planned` |

One gap stays open. The `purchaseOrder` UPDATE policy checks only `purchasing_update`, and no database rule guards `status`. So a direct PostgREST write (a session token or an API key) can release an order. The Data API lockdown (TCK-35) owns that gap.

## Data Model Changes

None. `approvalRule` joins `auditConfig` (`packages/database/src/audit.config.ts`).

## API / Service Changes

- New pure helpers in `purchasing.models.ts`: `PURCHASE_ORDER_RELEASED_STATUSES`, `PURCHASE_ORDER_AMENDABLE_STATUSES`, `PURCHASE_ORDER_EDIT_LOCKED_STATUSES`, `isPurchaseOrderReleased`, `isPurchaseOrderAmendable`, `isPurchaseOrderEditLocked`, `purchaseOrderEditRefusal`, `purchaseOrderLineAmendRefusal`, `exceedsApprovedAmount`, `purchaseOrderFundsRefusal`. Pinned by `purchasing.approval.test.ts`.
- New building blocks in `purchasing.service.ts`: `getPurchaseOrderApprovalStates`, `getPurchaseOrderFundsRefusal`, `purchaseOrderFundsGate`, `getPurchaseOrderEditRefusal`, `amendPurchaseOrder`, `getPurchaseOrderLineForAmendment`, `settlePurchaseOrderAmendment`.
- The five PO routes that wrote through building blocks (`$orderId.new`, `$orderId.$lineId.details`, `$orderId.$lineId.delete`, `$orderId.payment`, `$orderId.exchange-rate`) now call the operations through `carbon(request)`.
- `submitPurchaseOrderForApproval` takes optional `fromStatuses`.
- No input schema changes; refusals are `rule` errors.

## Closest Sibling

Not a new record type. The pattern copies `finalizePurchaseOrderAndNotify` (rule match, `submitPurchaseOrderForApproval`, notify after commit).

## UI Changes

- PO page: amendable orders show editable lines, delivery, payment and header (supplier, currency disabled). Needs Approval orders are read-only.
- Approval rule card: Delete needs settings delete.

## Acceptance Criteria

- `createReceipt`, `postReceipt`, `createPurchaseInvoiceFromPurchaseOrder`, `createPurchaseInvoiceLine` and `postPurchaseInvoice` return a `rule` error for a Draft, Planned, Needs Approval, To Review, Rejected or Closed order, and for a released order whose total exceeds its approved amount.
- An edit on a To Receive order that keeps the total ≤ approved amount saves and the order stays To Receive.
- An edit that raises the total above the approved amount, with a matching rule, saves; the order is Needs Approval with a Pending request for the new total; approvers are notified.
- Any edit on a Needs Approval, Completed or Closed order is refused; a supplier or currency change on a released order is refused.
- Approval rule changes appear in the audit log.

## Risks

- Approval rules are configured per company: a company with no rules sees only the status checks.
- Write and settle are two steps (see section 2); the funds gate covers the gap.
- An order released before any rule existed (no approved request) needs approval on its first edit that raises the total into a rule's range.
- PR #2114 also edits `purchasing.server.ts` / `purchasing.service.ts`; a small merge overlap is expected.
- A direct PostgREST write can still set `purchaseOrder.status` (see the audit). The funds gate does not catch it: the order looks released with no approval request. TCK-35 closes it.
- The Ramp bill sync posts purchase invoices through the `post-purchase-invoice` posting, not the `postPurchaseInvoice` operation, so it skips the funds gate. Out of scope by user choice.

## Open Questions

- [x] Scope of requirement 1 in this ticket — **Answer:** service guards here; short-close in TCK-33, database trigger in TCK-34.
- [x] What must hold before funds move — **Answer:** released and, with an approved request, approved amount ≥ current total.
- [x] When may an approved order be edited without re-approval — **Answer:** new total ≤ approved amount.
- [x] What happens when an edit raises the total — **Answer:** auto re-submit (Needs Approval + new request).
- [x] Which parts are editable — **Answer:** all but supplier and currency; quantities never below received/invoiced.
- [x] Edits while Needs Approval — **Answer:** locked.
- [x] Approver management hardening — **Answer:** audit rule changes only; permissions and RLS unchanged.

## Changelog

- 2026-11-03: Spec written with all questions resolved.
- 2026-11-03: Implemented. `PURCHASE_ORDER_LOCKED_STATUSES` kept (it also drives Reopen and revisions); a separate edit-lock list added. The no-approval baseline is the pre-edit total.
- 2026-11-03: End-to-end test fixes. The planning bypass no longer applies to edits, `insertPurchaseOrder` refuses a released status, the line floor holds in every status, and a line edit restates a released order's status.
- 2026-11-03: TCK-34 joined this spec. The status writer audit is recorded above. No database guard, by user choice (D10).
