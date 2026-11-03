# PO approval enforcement (funds gate, approved-PO edits, approver audit)

Last tested: 2026-11-03
Spec: `.ai/specs/2026-11-03-po-approval-enforcement.md`
Routes: `/x/purchase-order/<id>/details`, `/x/purchase-order/<id>/<lineId>/details`,
`/x/receipt/<id>/details`, `/x/purchase-invoice/<id>/details`,
`/x/settings/approval-rules`, `/x/settings/audit-logs`; API `POST /api/v1/<module>/<op>`

## Prerequisites
- Enterprise edition (`CARBON_EDITION=enterprise`); approval rules are commercial.
- Demo company "Carbon Development" (test@carbon.ms) has PO rules at >= 5,000 and
  >= 25,000 with the test user as approver. Supplier "SpaceGrade Fasteners", bought
  part `PCB-BARE-REV3`, location "Manufacturing Plant".
- Serve the ERP on the stack's own `ERP_URL` host (`PORT_ERP`, e.g. 50241). On a
  bare `erp.dev` host the login fails with a CSRF 400 (`allowedActionOrigins` is
  `erp.*.dev`); on 127.0.0.1 the session cookie (DOMAIN) never sticks.
- For API calls: a local `apiKey` row (`keyHash` = sha256 of `crbn_…`, scopes
  `{ "<module>_<action>": [companyId] }`). Send `Authorization: Bearer crbn_…`.
  Delete the row afterwards.

## Steps
### 1. Finalize → Needs Approval
New PO, line 10 × 600 = 6,000, Finalize. Expect Needs Approval and a Pending
`approvalRequest` for 6,000.
### 2. Needs Approval is read-only
Add Line Item disabled, line form fields disabled, Order/Requested date disabled.
API: `updatePurchaseOrderLine`, `createPurchaseOrderLine`, `deletePurchaseOrderLine`,
`updatePurchaseOrder`, `updatePurchaseOrders`, `upsertPurchaseOrderDelivery`
(send `trackingNumber`/`notes` strings), `upsertPurchaseOrderPayment`,
`updatePurchaseOrderExchangeRate` all 422 "waiting for approval";
`inventory_createReceipt` and `invoicing_createPurchaseInvoiceFromPurchaseOrder`
422 "must be approved and released".
### 3. Approve → released (To Receive and Invoice)
### 4. Released edits within the approved amount stay released
Supplier Ref. (saves on blur), price 600 → 500 → 600 (= approved): status unchanged,
no new request. Supplier and currency toggles disabled; API supplier/currency change
422 (resending the same values with another field is 200).
### 5. Raise above the approved amount
Price 650 → total 6,500: saves, Needs Approval, new Pending 6,500; a `carbon/notify`
`approval-requested` event goes to the rule's approvers (check
`localhost:<PORT_INNGEST>/v1/events?name=carbon/notify`).
### 6. Draft receipt then re-approval
Receive while released (Draft receipt), raise the price via API, Post the receipt:
toast "must be approved and released", receipt stays Draft, no `itemLedger`.
Approve, Post again: Posted.
### 7. Line floors
Received 4: quantity 3 → toast "cannot be lower than the 4 already received or
invoiced"; 4 allowed; delete refused. Invoiced 10: quantity 9 refused.
### 8. Shipping card and exchange rate
Shipping Cost 250 (type, Tab, then requestSubmit the card form) → re-approval.
EUR PO: `updatePurchaseOrderExchangeRate` 1 → 0.8 and `updatePurchaseOrders`
`field: exchangeRate` → re-approval at the new base total.
### 9. Funds gate when the settle step failed
Raise `purchaseOrderLine.supplierUnitPrice` in SQL on a released order: invoice Post
and `createReceipt` 422 "totals more than its approved amount". Restore, Post: Open.
### 10. Completed / Closed
Every edit op 422 "completed or closed".
### 11. Approval rules
Settings → Audit Logs → enable. Edit a rule's Minimum Amount: `auditLog_<companyId>`
row `approvalRule` UPDATE with the diff and `actorId`. Without `settings_delete`
(edit `userPermission`, `DEL permissions:<userId>` in the worktree's Redis DB) the
card's Delete Rule is disabled and a POST to `…/<id>/delete` redirects.

## Selector Notes
- Money/number inputs: triple-click, type, Tab (or click another field), then read
  `input[name=…]` before `requestSubmit`; a value that did not commit submits the old one.
- Line form submit: the form holding `input[name=purchaseQuantity]`.
- Finalize / Approve / Post dialogs: confirm button bottom-right of the dialog.

## Common Failures
- Notification rows may not appear locally (Inngest worker); check the event instead.
