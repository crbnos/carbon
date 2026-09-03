# RMA Journal Entries Research: Best Practices Survey

## Summary
Surveyed how enterprise ERPs post GL journal entries for returns (RMAs) — both
customer sales returns and supplier/purchase returns — to audit Carbon's RMA
postings in the Northspoke Cycles demo. Consensus is strong and consistent across
SAP, NetSuite, QuickBooks, and Dynamics 365: a return is **two decoupled postings**
— a value/AR-or-AP leg and an inventory/COGS leg — and the vendor (purchase) credit
memo **debits Accounts Payable** (reduces the liability), clearing a GR/IR-style
suspense account back to zero. Tax is reversed on credit memos. "Sales Returns &
Allowances" and "Sales Discounts" are distinct contra-revenue accounts with
different meaning.

## Competitors Surveyed
- **SAP S/4HANA** — reference for enterprise GR/IR clearing and returns account determination.
- **NetSuite** — RMA → Item Receipt → Credit Memo; Vendor Return Auth → Bill Credit.
- **QuickBooks Online** — credit memo / vendor credit posting behavior.
- **Microsoft Dynamics 365 F&O / Business Central** — sales return order, vendor return, credit notes.

## Key Consensus Patterns

### 1. A return is two decoupled postings (value leg + inventory leg)
- **SAP**: credit memo (Dr Sales Returns + Dr Output Tax / Cr AR) is separate from
  the returns goods receipt (Dr Inventory / Cr COGS). They are different documents
  and can even be configured so the cost leg does not fire (movement-type 651
  non-valuated "return blocked stock" trap).
- **NetSuite**: RMA header is non-posting; Item Receipt does Dr Inventory / Cr COGS;
  Credit Memo does Dr Revenue (+ tax) / Cr AR. Only physically-restocked goods touch inventory.
- **Dynamics 365 / QBO**: same split; QBO's credit memo does both legs automatically for inventory items.
- **Rationale**: revenue and cost reverse through different subledgers/documents; the
  physical restock is what restores inventory value and reverses COGS.

### 2. Vendor (purchase) return: **Dr AP / Cr Inventory**, via a clearing account
- **SAP**: return movement (MIGO 122/161) = Dr GR/IR clearing / Cr Inventory; vendor
  credit memo (MIRO) = **Dr Accounts Payable / Cr GR/IR clearing**. After both, GR/IR
  nets **back to zero**, mirroring the inbound cycle in reverse.
- **NetSuite**: Vendor Return (fulfillment) = Dr "Purchases Returned Not Credited"
  (clearing) / Cr Inventory; Bill Credit from the VRA = **Dr AP / Cr Purchases
  Returned Not Credited**. Stand-alone vendor credit = Dr AP / Cr Inventory directly.
- **Dynamics 365 / BC**: vendor credit note / purchase credit memo = **Dr AP / Cr
  Inventory** (physical/financial split routes through the purchase-accrual/GR-IR clearing account).
- **Rationale**: a supplier credit *reduces what you owe* — AP must be debited. The
  clearing account bridges the physical return and the financial credit so it clears to zero.

### 3. Tax/VAT is reversed on credit memos
- **SAP/NetSuite/QBO/Dynamics** all reverse output tax proportionally on a return
  credit memo when the original invoice was taxed (Dr Output Tax on the credit memo).
  Omitting the tax leg overstates the tax liability.

### 4. Sales Returns/Allowances vs Sales Discounts are distinct contra-revenue accounts
- **Standard**: *Sales Returns & Allowances* = returned goods or quality/price
  concession; *Sales Discounts* = early-payment term (e.g. 2/10 net 30). Both reduce
  gross sales to net sales but mean different things.
- **ERPs**: none post a dedicated "Sales Returns" account automatically — default is a
  direct reversal of the item's own revenue account; separating returns/allowances/
  discounts is a deliberate account-mapping choice.

## Answers to Research Questions
1. **Customer sales return double-entry** — Confirmed four legs (SAP/NetSuite/QBO/D365):
   credit memo Dr Sales Returns(+tax)/Cr AR; restock Dr Inventory/Cr COGS.
2. **Sales Returns vs Sales Discounts** — Distinct accounts; returns/allowances for
   goods/concessions, discounts for early payment. Use Sales Returns for a goods return.
3. **Tax on credit memos** — Yes, reversed proportionally in all four systems.
4. **Purchase return double-entry** — Return movement Dr GR/IR clearing / Cr Inventory;
   vendor credit memo **Dr AP / Cr GR/IR clearing**. GR/IR nets to zero. AP is debited.

## Recommended Approach for Carbon
1. **Purchase credit memo must Dr AP / Cr GR/IR** (SAP/NetSuite/D365 pattern), not the
   reverse. With the purchase return shipment already doing Dr GR/IR / Cr Inventory,
   the credit memo crediting GR/IR is what clears the suspense account to zero.
2. **Sales credit memo** correctly does Dr Sales Returns / Cr AR — keep it; ensure the
   contra account (Sales Returns 4900 vs Sales Discounts 4020) reflects whether goods
   physically came back (return) vs a pure price concession (allowance/discount).
3. **Add a tax-reversal leg** to credit memos when the original invoice carried tax
   (Dr Output Tax), matching all four reference systems.

## Sources
- https://www.appseconnect.com/blog/how-to-process-a-sales-return-credit-memo-in-sap-erp
- https://sapficoandmore.wordpress.com/2021/01/02/return-order-processing-in-co-pa-in-s-4hana/
- https://userapps.support.sap.com/sap/support/knowledge/en/2478109
- https://community.sap.com/t5/enterprise-resource-planning-q-a/mvt-type-161-122/qaq-p/7150962
- https://erpcorp.com/sap-controlling-blog/sap-controlling/gr-ir-goods-receipt-invoice-receipt-processing
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1460914.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1461991.html
- https://community.oracle.com/netsuite/english/discussion/4474553
- https://blog.prolecto.com/2020/12/19/get-control-over-netsuite-sales-returns-general-ledger-accounting/
- https://quickbooks.intuit.com/learn-support/en-us/other-questions/how-can-i-record-a-customer-credit-memo-that-does-not-restock/00/1036078
- https://quickbooks.intuit.com/learn-support/en-us/taxes/credit-memo-sales-tax-involved/00/137187
- https://quickbooks.intuit.com/learn-support/en-us/other-questions/i-have-returned-an-inventory-part-to-the-vendor-i-want-to-record/00/1360466
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-returns
- https://learn.microsoft.com/en-us/dynamics365/finance/localizations/india/apac-ind-gst-credit-note-against-sales-invoice
- https://dynamics-tips.com/vendor-return/
- https://www.financestrategists.com/accounting/special-journal/sales-returns-and-allowances/
