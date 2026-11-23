# Supplier Prepayments and Progress Billing Research: Best Practices Survey

## Summary

This survey covers accounts payable cases that do not follow the path "one purchase order, one supplier invoice, one payment". It covers 6 cases: supplier prepayments, progress billing, blanket purchase orders, partial and installment payments, open payables at go-live, and spend platforms. Each ERP surveyed keeps a supplier prepayment out of the payables balance. Each ERP posts the prepayment to a prepayment asset or a special payables account, and clears it against a later supplier invoice. The ERPs use one of 3 records for the prepayment: a payment, a prepayment invoice, or a request plus a payment. Several supplier invoices per purchase order are normal in every ERP. Business Central deducts the prepayment from each invoice in proportion to the invoiced quantity. NetSuite and Dynamics 365 Finance apply the prepayment oldest-first. Ramp has no prepayment object. Ramp splits one bill into a maximum of 20 payments in its web app only. The Ramp Developer API cannot create a split. The API shows only the first payment of a split bill. Vendor credits are read-only in the API.

## Competitors Surveyed

- **SAP S/4HANA** — the reference model: down payment request, down payment on a special G/L indicator, clearing at invoice verification.
- **Oracle NetSuite** — a mid-market reference: Vendor Prepayment and Vendor Prepayment Application records, with Auto-Apply through the purchase order.
- **Microsoft Dynamics 365 Business Central** — the small and mid-size reference: prepayment invoices posted from the purchase order, with proportional deduction.
- **Microsoft Dynamics 365 Finance (F&O)** — 2 methods side by side: prepayment invoicing and prepayment journal vouchers.
- **Acumatica (MYOB Acumatica)** — a prepayment AP document, and from 2026 R1 an AP prepayment invoice.
- **Odoo 18** — no standard purchase prepayment. Third-party modules fill the gap.
- **Epicor Kinetic** — forum evidence only (advance billing on a purchase order line).
- **Ramp Bill Pay and Developer API** — the bill-pay platform that Carbon uses as its spend platform.
- **BILL (Bill.com)**, **Tipalti**, **Brex** — other spend platforms that sync bills and payments to an ERP.

## Key Consensus Patterns

### 1. A prepayment is an asset, not a debit to payables

- **SAP**: The down payment posts to the supplier account with special G/L indicator A. The alternative reconciliation account is a down payment asset, not the normal payables account. The down payment request (indicator F) is a noted item with no GL value.
- **NetSuite**: The Vendor Prepayment debits a prepayment account and credits the bank. It does not touch Accounts Payable.
- **Business Central**: The prepayment invoice posts to a prepayment account from the General Posting Setup. Microsoft says purchase prepayments "must be recorded in an account for assets until the items are received".
- **Dynamics 365 Finance**: Prepayment invoicing posts to a prepayment account from the inventory posting profile. The prepayment journal voucher posts to a prepayment posting profile.
- **Acumatica**: The prepayment AP document debits the prepayment (deposit) account.
- **Rationale**: Money paid before delivery is a claim for goods. It is not a reduction of a debt that does not exist yet. A separate account keeps the payables aging and the payables tie-out clean.

### 2. Clearing moves the prepayment from the asset to payables

- **SAP**: At invoice verification (MIRO), SAP proposes the open down payments for the purchase order. The clearing posts debit payables, credit the down payment account. S/4HANA can also clear automatically.
- **NetSuite**: The Vendor Prepayment Application debits Accounts Payable and credits the prepayment account. The bill then shows as paid by that amount.
- **Business Central**: The final invoice deducts the prepayment. The deduction reverses the prepayment account, and the amount due falls by the same value.
- **Dynamics 365 Finance**: Applying the prepayment invoice to the standard invoice reverses the prepayment entries.
- **Acumatica**: Releasing the application debits payables and credits the prepayment account.
- **Rationale**: One clearing entry keeps each supplier invoice at its full value, and shows the prepayment as a funding source of that invoice.

### 3. The purchase order links the prepayment to its supplier invoices

- **SAP**: The down payment request carries the purchase order number and item. Without them, the clearing button does not show in MIRO (SAP KBA 2121740 and related KBAs).
- **NetSuite**: A prepayment can link to a purchase order. Auto-Apply works only for linked prepayments, and only for bills made from the purchase order. A stand-alone prepayment needs a manual application.
- **Business Central**: The prepayment lives on the purchase order lines (`Prepayment %`, `Prepmt. Line Amount`).
- **Dynamics 365 Finance**: The prepayment value is defined on the purchase order. Only 1 prepayment definition is allowed per order.
- **Rationale**: The link lets the system propose the right prepayment when the supplier invoice arrives. It also lets the system warn when a purchase order closes with an unapplied prepayment.

### 4. Many supplier invoices per purchase order are normal

- **SAP**: Each MIRO invoice clears part or all of the down payment. The user enters the amount to clear.
- **NetSuite**: Auto-Apply goes oldest bill first and applies the maximum possible amount to each bill.
- **Business Central**: `Prepmt Amt to Deduct` defaults to a share of the prepayment that is proportional to the invoiced part of the line. The user can change the amount before posting. `Prepmt Amt Deducted` tracks the total so far.
- **Dynamics 365 Finance**: Invoice automation applies the whole prepayment to the first imported invoice. If the prepayment is larger than that invoice, the automatic application fails, and a user applies it manually.
- **Rationale**: Suppliers ship and invoice in parts. The prepayment must clear over time, and each invoice must keep its own open balance.

### 5. A partial payment is a payment for less than the open balance

- **NetSuite, Acumatica, BILL, Ramp**: All 4 let one bill have several payments. The bill keeps an open balance until it reaches zero.
- **NetSuite**: Installment payment terms split one bill into installments, and each installment can be paid separately.
- **Business Central**: A separate `Prepmt. Payment Terms Code` sets the due date of the prepayment invoice. The order can block posting until the prepayment is paid (`Check Prepmt. when Posting`).
- **Rationale**: A term like "50% advance, 50% before shipping" is 2 obligations with 2 due dates. ERPs model the first one as a prepayment and the second one as the normal invoice, or as 2 installments of one invoice.

## Answers to Research Questions

1. **What record represents the prepayment?** — There are 3 designs.
   - A payment record with a purchase order link: NetSuite (Vendor Prepayment), Dynamics 365 Finance (prepayment journal voucher), Acumatica (Prepayment document), Odoo (manual workaround).
   - A prepayment invoice on the purchase order: Business Central, Dynamics 365 Finance (prepayment invoicing), Acumatica 2026 R1 (AP prepayment invoice).
   - A request plus a payment: SAP (down payment request F, then down payment A).
2. **What are the GL entries?** — All surveyed ERPs post the same 2 steps.
   1. Payment: debit the prepayment asset, credit the bank.
   2. Clearing: debit payables, credit the prepayment asset.

   Business Central and Acumatica add a step before the payment. The prepayment invoice debits the prepayment account and credits payables. The payment then debits payables and credits the bank. Dynamics 365 Finance (prepayment voucher method) keeps the prepayment inside the vendor balance on a separate posting profile.
3. **How does progress billing deduct the prepayment?** — Business Central deducts in proportion to the invoiced quantity, and the user can change the amount. NetSuite and Dynamics 365 Finance apply oldest-first, up to the invoice amount. SAP lets the user enter the clearing amount for each invoice.
4. **How do blanket purchase orders work?** — Business Central: the blanket order is a non-posting document. `Make Order` creates a normal purchase order from it, and the blanket order tracks the received and invoiced quantities. NetSuite: the Blanket Purchase Order is a non-posting transaction, and its releases are normal purchase orders. In both ERPs, the supplier invoice matches the release, not the blanket order. Neither ERP posts a prepayment against the blanket order itself (not verified for every edition).
5. **How do partial and installment payments work?** — See Pattern 5. Ramp allows a maximum of 20 payments on one bill, in the web app only. BILL lets the user pay less than the bill amount, and the bill stays in the "Bills to Pay" list with its open balance.
6. **How do open payables at go-live work?** — SAP migrates each open supplier invoice as an open item against an initial offset account. The migration object is "FI - Accounts payable open item" (`SIF_OPEN_ITEM_AP`). Later payments clear these open items in the normal way. SAP cannot migrate open down payments and down payment requests through this object without extra steps (KBA 2934405). Ramp imports open bills less than 1 year old from a connected ERP. Ramp does not import a bill when a bill with the same vendor and invoice number already exists in Ramp. A later Ramp payment then syncs to the open ERP bill.
7. **How do spend platforms sync?** — There are 2 directions.
   - The platform pushes: Ramp, Brex, BILL and Tipalti create bills in their own app, then write the bill and each payment into the ERP.
   - The ERP pushes: Ramp imports open bills from its direct integrations. Carbon pushes draft bills to Ramp with `remote_id`.

   BILL syncs a partial vendor-credit application to QuickBooks Online only after the rest of the bill is paid. BILL syncs partially paid bills one way, from BILL to the ERP.

## Competitor-Specific Details

### SAP S/4HANA

- **Records**: The down payment request (F-47, or the Fiori app "Manage Supplier Down Payment Requests") has special G/L indicator F. It is a noted item, so it has no GL value. The automatic payment program pays it, and the payment posts the real down payment on indicator A (F-48 for a manual entry).
- **Purchase order link**: The purchase order can carry a down payment category (`EKKO-DPTYP`), with a percentage or an amount. ME2DP monitors the down payments of purchase orders and creates the requests.
- **Clearing**: MIRO proposes the uncleared down payments of the purchase order. The user clears them with the "Down Payment Clearing" function (F-54 is the FI transaction). Automatic clearing is a configuration option. If automatic clearing is active, the manual clearing in MIRO is not available.
- **Known gap**: In S/4HANA Cloud Public Edition, one KBA says MIRO with a paid down payment does not clear the FI open items. A separate FI clearing step (F1367 or F13E) clears them.
- **Terminology**: down payment, down payment request, special G/L indicator, clearing.

### Oracle NetSuite

- **Records**: The Vendor Prepayment is a posting transaction. The Vendor Prepayment Application (`vendorprepaymentapplication`) applies a prepayment to 1 or more bills. A user makes the application from the prepayment, or REST makes it by transforming the prepayment.
- **Purchase order**: The "Enter Prepayment" button on a saved purchase order prefills payee, amount, currency and subsidiary. Only purchase orders in Pending Receipt or Pending Bill status are available. Many prepayments can link to one purchase order.
- **Auto-Apply**: This preference applies linked prepayments oldest-first to bills made from the purchase order. It does not work for bills entered with "Enter Bills", or for stand-alone prepayments.
- **Discounts**: The prepayment feature ignores vendor discounts.
- **Vendor deposit**: Not found in the NetSuite docs as a separate AP record. The Vendor Prepayment is the record for a supplier deposit (not verified further).
- **Installments**: The Intelligent Payment Automation and Electronic Bank Payments SuiteApps pay each installment of a bill separately.

### Microsoft Dynamics 365 Business Central

- **Setup**: `Prepayment %` defaults come from the vendor, the item, or the purchase header. Each line can carry its own percentage. A user can type a total `Prepayment Amount` in Statistics, and BC spreads it over the lines in proportion to the line amounts.
- **Posting**: "Post Prepayment Invoice" makes a real posted purchase invoice. `Compress Prepayment` merges lines that share the same prepayment account and the same dimensions. `Prepmt. Payment Terms Code` sets its due date.
- **More prepayments**: A user can raise the percentage or add lines. A second prepayment invoice then bills the difference. A prepayment credit memo reverses a prepayment before a line is deleted. In North America, the percentage is locked after the first prepayment invoice, because of sales tax.
- **Deduction**: Each ordinary invoice deducts `Prepmt Amt to Deduct`. By default, this value is proportional to the quantity invoiced.
- **Status**: An order with an unpaid prepayment has status "Pending Prepayment". A job queue entry (codeunit 384) changes it to "Released" when the prepayment invoice is paid.
- **Blanket purchase orders**: `Make Order` makes a purchase order from all lines or from 1 line. The blanket order updates its received and invoiced quantities. When the full quantity of a line is on orders, BC blocks more orders for that line.

### Microsoft Dynamics 365 Finance (F&O)

- **2 methods**:

  | Prepayment invoicing | Prepayment journal voucher |
  |---|---|
  | The prepayment value is on the purchase order | No value on the purchase order |
  | A prepayment invoice, then a final invoice | No prepayment invoice |
  | The prepayment account holds the amount, not payables | The payables account holds the amount (special posting profile) |
  | 1 prepayment per purchase order | Many payments are allowed |

- **Application policy**: "Automatic" marks the prepayment for settlement with the final invoice. "Notification" shows that a prepayment is available. Invoices made through a data entity ignore the policy.
- **Reversal**: "Reverse prepayment application" undoes the application. The prepayment can then go to a different invoice.
- **Finalized order**: An order can close with an unapplied prepayment. The user can apply the remaining amount to invoices of other orders from the same vendor.
- **Tax**: The journal voucher method can calculate tax on the prepayment, because a country can require it.

### Acumatica

- **Classic method**: A Prepayment-type document is entered on Bills and Adjustments (AP301000). A user pays it on Checks and Payments (AP302000), then applies it to bills on the "Documents to Apply" tab. The release posts debit payables, credit the prepayment account.
- **2026 R1 prepayment invoice**: The release posts debit prepayment account, credit payables. A partial payment leaves the document "Pending Payment". A full payment moves it to "Unapplied". A user can apply its balance to many bills. A full application closes it.
- **Purchase order prepayment request**: A community thread reports a defect. After a prepayment request on a purchase order is applied to a bill, the open purchase order balance falls twice (not verified in docs).

### Odoo 18

- **Standard**: Odoo has no purchase order prepayment. The forum workaround is to register an outbound payment, then reconcile it with the later bill. The payment sits on the vendor's payables account as an unreconciled debit, not on a prepayment asset.
- **Modules**: Third-party apps add prepayment bills from the purchase order (percentage or fixed amount) and deduct them on the final bill. This matches the Business Central design.

### Epicor Kinetic

- **Forum evidence only**: An "advance billing" links to a purchase order line. Epicor applies it when the receipt line is added to the AP invoice. A forum post says Epicor does not carry the rest of the advance to later receipt lines (not verified in Epicor docs).

### Ramp

**Product behavior (support articles):**
- **Partial payments**: The user splits a bill into a maximum of 20 payments (the beta allowed 12). The user can schedule the first payment and leave the rest unscheduled. Each partial payment has its own row in the Payments table and its own approval chain. The bill shows the remaining balance and becomes Paid after the last payment.
- **Partial payment limits**: Partial payments work only when the connected ERP supports partial payments. They do not work for draft bills, recurring bills, FX payments, manual payments, automatic card payments, or batch payments. After the first payment starts, the vendor and the bill total are locked.
- **Vendor credits**: A user creates a vendor credit from a paid bill, from a vendor profile, or from a credit memo in the AP inbox. Ramp applies a credit when the bill payment starts. A credit can be 1 split of a partial payment ("Apply available vendor credits"). Direct integrations sync a credit when the user creates it. Edits in the ERP do not flow back to Ramp.
- **Prepayments**: Ramp has no prepayment or deposit object. The support articles do not describe a payment made before an invoice exists.
- **Bill import**: Ramp imports open ERP bills less than 1 year old from its direct integrations (NetSuite, QuickBooks, Xero, Sage Intacct, Acumatica, Zoho Books). The vendor must exist in Ramp. Ramp skips a bill when the same vendor and invoice number already exist in Ramp. Amount changes in the ERP update unpaid imported bills.

**Developer API (`docs.ramp.com`, OpenAPI `developer-api.json`):**
- **Bill create**: `POST /developer/v1/bills` takes 1 `payment_method` and 1 `payment_date`. It has no field for a payment schedule or for installments. Bills created through the API are approved at once. `POST /bills/drafts` plus `/submit` enters the approval workflow.
- **Bill read**: `Bill.payment` is "the first non-vendor-credit payment" of the bill. The `Bill` schema has no list of payments. `Bill.status` is only `OPEN` or `PAID`.
- **Payment sync readiness**: `is_payment_sync_ready` is true when 1 payment of the bill is ready. The docs say it "does not identify which payments are ready". The docs also say that sync "can require all syncable payments to reconcile unless the bill is recorded as paid".
- **Sync status**: `sync_status` is `NOT_SYNCED`, `BILL_SYNCED` or `BILL_AND_PAYMENT_SYNCED`. The integrator reports each export with `POST /accounting/syncs` and a `sync_type` of `BILL_SYNC`, `BILL_PAYMENT_SYNC` or `VENDOR_CREDIT_SYNC`. This call requires an `idempotency_key`.
- **Partial payment sync (unverified)**: The docs do not say which Ramp `id` a `BILL_PAYMENT_SYNC` reports for the second payment of a split bill. They also do not say if the bill moves back from `BILL_AND_PAYMENT_SYNCED` when a new split payment is ready.
- **Payments API (beta)**: `POST /developer/v1/payments` creates and starts an ACH or check payment to a vendor. It takes `vendor_id`, `amount`, `scheduled_date`, `source_bank_account_id`, `external_ref` and `external_invoice_number`, and no bill. `GET /payments` lists payments with `status` and `external_ref`. The guide says the API can cancel only payments made without a bill. The API cannot make a batch payment (1 payment for many bills).
- **Vendor credits**: The API is read-only. It has `GET /vendors/credits`, `GET /vendors/credits/{id}` and `GET /vendors/{vendor_id}/credits`. A credit has `total_amount`, `total_applied_amount`, `remaining_amount`, `applied_bills`, `reference_bill_id`, `accounting_date` and `sync_status`. A bill has `applied_vendor_credits[]` with `id` and `amount`. The API has no endpoint to create a credit or to apply a credit.
- **Duplicate prevention**: `POST /bills` has no idempotency key. The guide tells integrators to save the bill id, and to look for the bill before a retry. `remote_id` is the integrator's key, and `GET /bills?remote_id=` finds it. `remote_id` requires `enable_accounting_sync: true`. The manual "Export" button in the Ramp web app marks objects as synced and does not notify the integrator. The guide tells integrators to train customers never to click it.
- **Purchase orders**: A bill takes `purchase_order_ids`, and returns `item_receipt_ids`. A purchase order has a `billing_status` of `OPEN`, `PARTIALLY_BILLED`, `FULLY_BILLED` or `CLOSED`. `is_withholding_release` marks a retainage release bill.

### BILL (Bill.com)

- **Partial payments**: On the Pay screen, the user enters an amount less than the bill. The bill stays in "Bills to Pay" with its open balance. A user can mark a payment as "paid outside BILL", and can turn off the sync for a payment that the ERP already has.
- **Vendor credits**: A credit that pays part of a bill syncs to QuickBooks Online only after the rest of the bill is paid. If the user applies the credit by hand in QuickBooks, the next payment sync fails. A credit that covers the whole bill syncs with a $0 payment.
- **NetSuite**: Vendor credit applications do not sync from NetSuite to BILL. Partially applied credits sync one way, from BILL.

### Tipalti

- **Partial payments**: Bills with status "Partially paid" sync to NetSuite (third-party copy of Tipalti help). The source does not say how NetSuite records the partial payment.
- **Prepayments**: Tipalti marketing says a user can flag a bill as a prepayment. Tipalti offers this as an alternative to NetSuite's prepayment module (not verified in Tipalti's help).

### Brex

- **Sync**: Brex syncs vendors and bills one way to the ERP when a bill is fully approved. Brex payments sync back and close the open ERP bills. Edits in the ERP do not flow back to Brex.
- **Partial payments, installments, vendor credits**: Not found in Brex docs (unverified).

## Recommended Approach for Carbon

Carbon already has the NetSuite design for supplier prepayments. A `payment` with `purchaseOrderId` posts its unapplied cash to `supplierPrepaymentAccount` (1150, an asset), and it funds only the purchase invoices of that order (`20261105213627_supplier-prepayments.sql`). The recommendations below build on that design.

1. **Keep the prepayment as a payment, not as an invoice.** This follows NetSuite, Acumatica and the Dynamics 365 Finance voucher method. It matches Ramp, where a prepayment is money out with no invoice. Add a prepayment invoice (the Business Central design) only if a customer needs tax on prepayments.
2. **Apply the prepayment with a settlement row.** Each application debits payables and credits 1150, as in NetSuite and SAP. The purchase invoice keeps its full value.
3. **Default the amount to apply from the invoiced quantity, and let the user change it.** This is the Business Central `Prepmt Amt to Deduct` rule. It is fairer than oldest-first when a supplier ships in parts. Oldest-first (NetSuite) is the simpler fallback.
4. **Treat "50% advance, 50% before shipping" as 1 prepayment plus 1 invoice.** Do not treat it as 2 installments of 1 bill. All surveyed ERPs and Ramp support this split. Installment payment terms on one invoice (NetSuite) are a separate feature.
5. **Warn when a purchase order closes with an unapplied prepayment.** Let the user move the balance to another order of the same supplier, or request a refund. This follows Dynamics 365 Finance.
6. **Support several Ramp payments for one bill on the inbound side.** Do not depend on `Bill.payment` alone, because it returns only the first payment. Read `GET /payments`, or the bill again after each `bills.ready_to_sync` event, and key each Carbon `payment` on the Ramp payment id. Confirm this against a Ramp sandbox before the spec is final, because the docs do not say which id `BILL_PAYMENT_SYNC` takes for a split bill.
7. **Make a Ramp prepayment from Carbon in 1 of 2 ways.** Option A: a Ramp bill for the deposit amount, mapped to a Carbon prepayment `payment`. Option B: a bill-less payment through the beta Payments API, with `external_ref` set to the Carbon payment id. Option B needs no fake bill, but the Payments API is beta and supports only ACH and check. Ask Ramp about the accounting sync of bill-less payments.
8. **Read Ramp vendor credits; do not create them.** The API cannot create or apply a credit. Map each `applied_vendor_credits[]` entry to a Carbon settlement against a Carbon debit memo. Report the result with `VENDOR_CREDIT_SYNC`.
9. **Keep `remote_id` and a look-up before every retry for duplicate prevention.** `POST /bills` has no idempotency key. Use the Carbon document id as `remote_id`, and send an `idempotency_key` to every `POST /accounting/syncs` call.
10. **Let open payables at go-live take later Ramp payments.** Carbon opening-balance invoices must accept a Ramp payment like any other open invoice. Ramp import from an ERP exists only for direct integrations, so for Carbon the bill must come from a Carbon push or a Ramp-side entry.

## Open Questions for the Spec

1. Which Ramp `id` does a `BILL_PAYMENT_SYNC` report for the second payment of a split bill? Does the bill leave `BILL_AND_PAYMENT_SYNCED` when a new split payment is ready? (Not in the docs. Test in a sandbox or ask Ramp.)
2. Does Ramp allow partial payments for an API (custom) accounting connection? The support article says only that the ERP must "support partial payments".
3. Do bill-less payments from the Payments API appear in the accounting sync, and with which `sync_type`?
4. Does Carbon need prepayment invoices for tax on prepayments, or only prepayment payments?

## Sources

- Ramp — Partial payments on Ramp Bill Pay: https://support.ramp.com/hc/en-us/articles/49845051950739-Partial-payments-on-Ramp-Bill-Pay
- Ramp — Vendor credits on Ramp Bill Pay: https://support.ramp.com/hc/en-us/articles/21321389409683-Vendor-credits-Credit-memos-on-Ramp-Bill-Pay
- Ramp — Importing bills from your accounting provider: https://support.ramp.com/hc/en-us/articles/33844303915539-Importing-bills-from-your-accounting-provider
- Ramp Developer API — full docs (Bill Pay, Bill Payments, ERP Integrations guides; Bills, Payments, Vendors, Accounting Syncs references): https://docs.ramp.com/llms-full.txt
- Ramp Developer API — OpenAPI spec: https://docs.ramp.com/openapi/developer-api.json
- SAP — Down Payment Clearing (MIRO): https://help.sap.com/doc/ea71b6531de6b64ce10000000a174cb4/1610%20002/en-US/4f3b902bd8ed1616e10000000a42189b.html
- SAP — Special G/L Accounts for Down Payments: https://help.sap.com/saphelp_globext607_10/helpdata/en/01/a9c7d0455711d182b40000e829fbfe/content.htm
- SAP — Entering Down Payment Requests: https://help.sap.com/SAPHelp_46c/helpdata/EN/6e/12183e9f0411d189b80000e829fbbd/content.htm
- SAP Learning — Creating Purchase Orders with Down Payments: https://learning.sap.com/courses/detailing-procurement-of-direct-materials/creating-purchase-orders-with-down-payments_c2ead69a-8fbd-4c62-9432-a8b8a2409b52
- SAP Learning — Executing a Down Payment Clearing: https://learning.sap.com/courses/detailing-down-payments-execution/executing-a-down-payment-clearing
- SAP KBA 2121740 (clearing in MIRO): https://userapps.support.sap.com/sap/support/knowledge/en/2121740
- SAP KBA 3547892 (Public Cloud clearing gap): https://userapps.support.sap.com/sap/support/knowledge/en/3547892
- SAP KBA 3776794 (migrated down payment clearing): https://userapps.support.sap.com/sap/support/knowledge/en/3776794
- SAP KBA 2934405 (special G/L items in AP open item migration): https://userapps.support.sap.com/sap/support/knowledge/en/2934405
- UN Umoja — Creating and clearing down payments (F-54): https://umoja.un.org/sites/umoja.un.org/files/fi_creating_and_clearing_downpayments_v1.0.pdf
- NetSuite — Vendor Prepayments Overview: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156378588624.html
- NetSuite — Entering Vendor Prepayments From a Purchase Order: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157311209466.html
- NetSuite — Applying Vendor Prepayments With Auto-Apply: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157372109804.html
- NetSuite — Vendor Prepayment Application record: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157968523091.html
- NetSuite — Partial and Installment Payments: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0606092901.html
- NetSuite — Installment Payment Support: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156455440863.html
- NetSuite — Creating a Blanket Purchase Order: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4083950023.html
- NetSuite — Releasing Items on a Blanket Purchase Order: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4083950994.html
- Business Central — Invoice prepayments: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-invoice-prepayments
- Business Central — Create prepayment invoices: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-to-create-prepayment-invoices
- Business Central — Set up prepayments: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-set-up-prepayments
- NAV 2016 — Prepmt Amt to Deduct field, Purchase Line: https://learn.microsoft.com/de-de/previous-versions/dynamicsnav-2016/hh178781(v=nav.90)
- Business Central — Blanket sales and purchase orders: https://learn.microsoft.com/en-CA/dynamics365/business-central/sales-how-to-create-blanket-sales-orders
- Dynamics 365 Finance — Prepayment invoices vs. prepayments: https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/prepayments-invoices-vs-prepayments
- Dynamics 365 Finance — Automatically apply prepayments to vendor invoices: https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/apply-prepymnts-overview
- MYOB Acumatica — AP Prepayment Invoices: General Information: https://help.myob.com.au/advanced/Docs/Published/UserGuide/Finance_Prepayment_Invoices_in_AP_GeneralInfo.html
- MYOB Acumatica — To Apply a Prepayment to Bills: https://help.myob.com.au/advanced/Docs/Published/JobAids/APC__HOW_To_Apply_Prepayment_to_Bills.html
- Acumatica Community — PO prepayment request reduces PO balance twice: https://community.acumatica.com/distribution-6/po-prepayment-request-applied-to-ap-bill-reduces-remaining-po-balance-twice-35561
- Odoo Forum — Odoo 18 down payment: https://www.odoo.com/forum/help-1/odoo-180-how-do-i-link-a-downpayment-to-a-purchase-order-265600
- Odoo Apps — Purchase Down Payment module: https://apps.odoo.com/apps/modules/18.0/purchase_down_payment
- Epicor users forum — AP prepayment does not match receipt: https://www.epiusers.help/t/ap-pre-payment-does-not-match-receipt/64734
- BILL — Partial bill payments: https://support.bill.com/hc/en-us/articles/204377825-Partial-bill-payments
- BILL — QuickBooks Online sync, application of vendor credits: https://vendorpayhelp.bill.com/hc/en-us/articles/360007203172-QuickBooks-Online-sync-Application-of-vendor-credits
- BILL — Sync Matrix for Oracle NetSuite: https://vendorpayhelp.bill.com/hc/en-us/articles/360020797152
- Tipalti — Synchronization with NetSuite (third-party copy): https://z3n-ds1-jbrummel.zendesk.com/hc/en-us/articles/10139729887258
- Tipalti — Tipalti + NetSuite: https://tipalti.com/integrations/oracle-netsuite/
- Brex — Syncing your bills: https://www.brex.com/support/syncing-bill-pay
