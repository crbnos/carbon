# Service, Repair and RMA Postings Research: Best Practices Survey

## Summary

This survey asks how SAP and NetSuite post the general ledger for returns, repairs, warranty work, free replacements and service contracts. It also checks those postings against US GAAP and IFRS. Carbon is replacing the project-based service module with a stand-alone service job. The job has one coverage (Billable, Warranty or Contract), and an RMA line chooses Return to Stock, Return for Service or Return for Warranty.

The 7 findings:

1. A return to stock is valued at its original cost and offsets COGS.
2. A customer's unit sent in for repair or warranty never enters inventory value.
3. Repair labor and parts post as they happen, to an account that the coverage chooses.
4. Warranty cost goes to a warranty account, never to COGS.
5. A free replacement posts to warranty, not to COGS, but neither SAP nor NetSuite does this without extra configuration.
6. Neither system accrues a warranty reserve by itself. Finance posts the reserve as a periodic journal entry.
7. Contract revenue follows the contract's own schedule, and the cost of covered work is expensed as it happens.

Carbon already posts the return to stock correctly. The new work is the coverage routing on the service job and the warranty flag on a replacement shipment.

## Competitors Surveyed

- **SAP S/4HANA** covers Advanced Returns Management, In-House Repair, the classic CS repair order, S/4HANA Service with item-based accounting and event-based revenue recognition, and Warranty Claim Processing. SAP is the enterprise reference.
- **Oracle NetSuite** covers the Return Authorization, Item Receipt with Restock, Field Service Management (FSM), the Warranty and Repairs Management (WRM) SuiteApp and Advanced Revenue Management (ARM). It is the mid-market reference.
- **Accounting standards**: ASC 606, ASC 460, ASC 340-40, IFRS 15 and IAS 37, read through PwC Viewpoint and Deloitte DART. These tell us which posting is correct when SAP and NetSuite differ.

Earlier Carbon research that this file builds on:

- `.ai/research/serial-service-cost-treatment.md`, which covers ownership, NRV and refurbishment.
- `.ai/research/2026-08-07-rma-module.md`, which covers the RMA document.

## Key Consensus Patterns

### 1. A return to stock is valued at its original cost and offsets COGS

- **SAP**: Movement type 653 (to unrestricted stock), 655 (to quality inspection) or 657 (to blocked stock) posts Dr Inventory / Cr the goods-issue offset account at receipt. In standard configuration, that offset account is COGS. Movement type 651 posts no value until the 453 transfer, and SAP blogs advise against it because it breaks the COGS match in CO-PA.
- **NetSuite**: An Item Receipt against a Return Authorization with Restock checked posts Dr Inventory Asset / Cr the item's COGS account. If the RA references the original sale, the cost comes from the original Item Fulfillment.
- **Standards**: ASC 606-10-55-27 values the returned goods at their former carrying amount, less the expected cost to recover them. A damaged unit goes in at NRV or scrap value.
- **Rationale**: The receipt reverses the original shipment's cost. Valuing it at today's cost would leave a gain or loss on a unit that never left the books in substance.

### 2. A credit memo debits a contra-revenue account

- **SAP**: Revenue account determination (VKOA) can map the returns billing type to a sales returns account.
- **NetSuite**: A Credit Memo debits the item's Income account by default. Consultants add a Sales Returns account with SuiteGL Custom GL Lines.
- **Standards**: Most SMBs post Dr Sales Returns & Allowances / Cr AR at the credit memo. They post a returns reserve at period end only when it is material.
- **Rationale**: A separate returns account keeps gross sales and the return rate visible.

### 3. A customer's unit sent in for repair never enters inventory value

- **SAP**: In-House Repair posts the customer's unit into non-valuated customer stock. The receipt makes no accounting document.
- **NetSuite**: NetSuite has no customer-owned stock. WRM tells the user to check Restock on a repair claim. That puts the customer's unit into inventory at return cost. Consultants list this as a known weakness of WRM.
- **Standards**: The customer keeps control of the unit, so the repairer must not record it as inventory.
- **Rationale**: Valuing a unit you do not own overstates inventory and books a false COGS credit.

### 4. Repair cost posts as it happens, to a receiver that the coverage chooses

- **SAP**: Time confirmations post Dr service order / Cr cost center. Goods issue 261 posts Dr service order / Cr Inventory. The accounting indicator on the item picks where the order settles. Billable work goes to cost of sales in CO-PA. Warranty work goes to a warranty cost center or account. Goodwill work goes to sales. Item-based accounting in S/4HANA Service posts cost with its profitability attributes at once, with no separate settlement step.
- **NetSuite**: Parts post Dr COGS / Cr Inventory when the FSM Sales Order is fulfilled. Labor time posts nothing unless the company runs Post Time. Routing a cost to warranty needs Custom GL Lines or a class.
- **Standards**: ASC 340-40-25-8(c) expenses a fulfillment cost that relates to performance already delivered. A repair on a customer's unit is normally satisfied over time (ASC 606-10-25-27(b)), so its cost is expensed and not held as WIP. That second point is an analogy, not text that names repair.
- **Rationale**: The coverage is known before the work starts. Posting to the right account once is simpler than posting to COGS and reclassing later.

### 5. Warranty cost goes to a warranty account, and the reserve is a periodic journal entry

- **SAP**: Warranty work settles to a warranty cost center or account. No standard function accrues a warranty provision at the sale and then uses it up (unverified). Finance posts the provision by a manual or recurring entry.
- **NetSuite**: NetSuite has no warranty accrual and no warranty expense routing. WRM registers warranties and checks claims, but it posts no warranty entries.
- **Standards**: ASC 460-10 and ASC 450-20 require an assurance-type warranty accrual at the sale when a claim is probable and the amount can be estimated. Repair costs are then charged against the liability. Expensing as incurred is a materiality exception. Small manufacturers usually post one monthly entry (sales × historical claim rate) and true it up each quarter. ASC 460-10-50-8 asks for a rollforward: opening balance, accruals, claims paid, changes in estimate and closing balance.
- **Rationale**: The ERP's job is to tag warranty cost correctly. Finance then estimates the reserve from that history.

### 6. A free replacement under warranty is warranty cost, not a sale

- **SAP**: The free-of-charge delivery (order type SD, item category KLN) posts Dr goods-issue offset (COGS by default) / Cr Inventory at goods issue, and bills nothing. Practitioners copy movement type 601 or add an account modifier to send the cost to warranty or goodwill.
- **NetSuite**: A $0 Sales Order still posts Dr COGS / Cr Inventory at fulfillment. A Custom GL Lines plug-in that reads a warranty flag adds Cr COGS / Dr Warranty Expense.
- **Standards**: PwC RR 8.2 treats the exchange of a defective unit as warranty, not a return. It does not reduce revenue, and its cost is warranty cost.
- **Rationale**: Both vendors default to COGS and both communities patch it. Carbon can get it right by design.

### 7. Contract revenue follows the contract, and covered work is expensed

- **SAP**: Event-based revenue recognition spreads the billing plan by month. It posts accrued revenue against a revenue adjustment, and the invoice moves the amount to deferred revenue. The cost of a covered service order stays on the order item and reaches margin analysis.
- **NetSuite**: ARM posts the invoice to Deferred Revenue and releases it by the revenue plan. It reclasses to Unbilled Receivable when revenue runs ahead of billing. NetSuite does not match covered work cost to the contract natively.
- **Standards**: A service contract or a separately priced warranty is a separate performance obligation (ASC 606-10-55-31 to 55-33). Revenue is recognized over the coverage period. The cost of covered work is expensed as incurred under ASC 340-40-25-8(c).
- **Rationale**: Revenue and cost of a contract have separate schedules. Reporting can join them through the contract id.

## Answers to Research Questions

1. **What posts when a return to stock is received, and at what cost?** Dr Inventory / Cr COGS at the original shipment cost (SAP 653/655/657, NetSuite Restock, ASC 606-10-55-27). A damaged unit goes in at NRV or zero, or to a write-off account (NetSuite non-restock).
2. **What posts at the credit memo?** Dr Sales Returns / Cr AR. A restocking fee lowers the credit (SMB practice; SAP through VKOA; NetSuite through Custom GL Lines).
3. **Billable repair of a customer's unit: WIP or expense?** Expense as incurred, to cost of service (ASC 340-40-25-8(c), NetSuite FSM, SAP item-based accounting). SAP's classic repair order holds WIP through results analysis, and only for fixed-price or completed-contract methods. Revenue posts at the invoice. SAP's event-based recognition also accrues revenue at each confirmation. A T&M repair can use the right-to-invoice expedient (ASC 606-10-55-18). A fixed-price repair needs an input measure such as cost-to-cost, or recognition at completion when the open amount is immaterial.
4. **Warranty repair: expense or reserve?** Post the cost to a warranty account as it happens (SAP settlement, standards). The ASC 460 reserve is a separate periodic entry that Finance posts (SAP and NetSuite both work this way). If the company keeps a reserve, the warranty account can be the liability itself.
5. **Free replacement under warranty?** Dr Warranty / Cr Inventory at the shipment, with no revenue (PwC RR 8.2). Both vendors need a configuration patch to avoid COGS.
6. **Service contract coverage?** Revenue moves from deferred revenue to revenue on the contract schedule (SAP event-based recognition, NetSuite ARM). Covered work cost is expensed as incurred (ASC 340-40).
7. **Scrap of returned goods?** Dr Scrap / Cr Inventory (SAP 551, NetSuite inventory adjustment). The unit must have a value first, so a unit received at zero scraps at zero.
8. **Unanswered: how should a service technician's labor be costed?** SAP uses the cost center's activity rate. NetSuite uses the project task's labor cost. Carbon maintenance uses the work center's labor rate, and a service technician has no work center. This question goes to the spec's Open Questions.

## Competitor-Specific Details

### SAP S/4HANA

- **Advanced Returns Management (ARM)** separates the logistics follow-up activities (move to stock, ship to vendor, transfer to scrap) from the refund. If refund control is "Decide Later", ARM delays valuation. This matches the Carbon RMA, where the line decision can change after inspection.
- **Classic CS repair order** (RA/RAS) has the item categories IRRS for repair resources and IRRE for the returned unit.
- **Billing a repair.** For T&M, resource-related billing (DP90) uses a DIP profile to turn the actual cost lines into a billing request. A fixed-price repair uses a billing plan and results analysis.
- **Warranty Claim Processing** has 4 versions:

| Version | Meaning | Posting |
|---|---|---|
| IC | Claim in from the customer | none |
| OC | Credit out to the claimant | Dr Warranty expense / Cr claimant |
| OV | Claim out to the supplier | none |
| IV | Recovery in from the supplier | Dr Supplier receivable / Cr Warranty expense or recovery income |

- **Unverified.** These points did not load from help.sap.com: the In-House Repair movement type and special stock indicator, the scrap account key GBB-VNG, and RAR for service contracts.

### Oracle NetSuite

- **Restock cleared.** The Item Receipt posts Dr Write-Off Account for Returns / Cr COGS. The user cannot clear Restock until that account is set.
- **"Default Return Cost".** This value on the item sets a fixed return cost.
- **WRM repair** builds a "Repaired Item" assembly that has the original unit as a component. It runs through a work order and WIP. This is why the customer's unit enters inventory.
- **FSM van stock** is a location for each technician, filled by Transfer Orders. Consumption posts through a Sales Order and Item Fulfillment from the van. A "billable at $0" consumable still posts to COGS.

## Carbon Today

- **On main:** The RMA receipt posts Dr Raw Materials or Finished Goods / Cr `costOfGoodsSoldAccount`. The cost is the original shipment cost, else `itemCost.unitCost`, else zero when the return reason has `inventoryValueZero`. The credit memo posts Dr `salesReturnsAccount` (else `salesAccount`) / Cr AR.
- **On main:** Maintenance labor posts Dr `maintenanceAccount` / Cr `laborAbsorptionAccount`. Maintenance parts post Dr `maintenanceAccount` / Cr Inventory. The service job copies this shape.
- **On main:** `deferredRevenueAccount` and `contractAssetAccount` exist and are used by contract lines.
- **On this branch only:** `warrantyExpenseAccount`, and the RMA "Repair" receipt that posts no value.
- **Not anywhere:** a warranty reserve, or a warranty flag on a replacement shipment. A replacement shipment posts Dr COGS today.

## Recommended Approach for Carbon

1. **Keep the return-to-stock postings as they are.** Receipt: Dr Inventory / Cr COGS at the original shipment cost. Credit memo: Dr `salesReturnsAccount` / Cr AR. This follows SAP 655, NetSuite Restock and ASC 606-10-55-27. The unit comes back On Hold until inspection, which is the same as SAP 655 (valued quality-inspection stock).
2. **Value nothing for a Service or Warranty line at receipt.** The receipt writes the serial's movement and no `itemLedger` value, no `costLedger` row and no journal. This follows SAP In-House Repair and the standards, and it avoids NetSuite WRM's known flaw. If inspection moves the line to Return to Stock, the value posts at that point, as in SAP's 453 transfer.
3. **Post service job cost as it happens, through one account chosen by the job's coverage.** Copy the maintenance shape:
   - Labor: Dr {coverage account} / Cr `laborAbsorptionAccount`.
   - Parts: Dr {coverage account} / Cr Inventory.
   - Expenses: Dr {coverage account} / Cr AP or the card account.

   This follows SAP's accounting indicator and settlement, and ASC 340-40-25-8(c). Use no WIP, because the customer owns the unit.
4. **Map coverage to accounts with 2 `accountDefault` columns:**

| Coverage | Account | Note |
|---|---|---|
| Billable | new `costOfServiceAccount`, falling back to `costOfGoodsSoldAccount` | keeps service margin apart from product margin |
| Warranty | `warrantyExpenseAccount` | a company that keeps an ASC 460 reserve maps this column to its Accrued Warranty Liability account, and each claim then draws down the reserve |
| Contract | `costOfServiceAccount` | revenue already follows the contract schedule; the job keeps `customerContractId` for margin reporting |

5. **Bill a billable job at the invoice.** Post Dr AR / Cr Sales. A T&M job bills its charges, and a fixed-price job bills the accepted estimate. Recognize revenue at the invoice in v1. That is SMB practice, and it is correct while open jobs at period end are immaterial. A later phase can accrue the unbilled T&M (Dr `contractAssetAccount` / Cr Sales) the way SAP's event-based recognition does.
6. **Post a warranty replacement shipment to warranty.** A replacement sales order raised from a Warranty RMA line carries a warranty flag. Its shipment posts Dr `warrantyExpenseAccount` / Cr Inventory, and the invoice is zero or none. This follows PwC RR 8.2, and Carbon gets it without the patches that SAP and NetSuite need. The defective unit, if kept, goes in at zero or NRV through the return reason's `inventoryValueZero`, or goes to scrap.
7. **Scrap posts Dr `scrapAccount` / Cr Inventory, as today.** A unit received at zero value scraps at zero.
8. **Make warranty cost reportable, not reserved.** Do not build a reserve engine in v1, consistent with the 2026-10-08 decision in `serial-service-cost-treatment.md`. Ship a warranty cost report by item, customer and month, so Finance can set the claim rate and fill in the ASC 460-10-50-8 rollforward.
9. **Leave supplier recovery for later.** SAP's IV claim (Dr Supplier receivable / Cr Warranty expense) is a natural phase 3 item, built on a Carbon supplier return or debit memo.

## Sources

Standards
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_8_practical__US/83warranties_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_8_practical__US/82rights_of_return_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_6_recognizin_US/64measures_of_progre_US/641output_methods_US/6411right_to_invoice_US.html
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-5-step-2-identify-performance/5-5-warranties
- https://dart.deloitte.com/USDART/home/codification/liabilities/asc450-10/deloitte-s-roadmap-contingencies-loss-recoveries/chapter-5-guarantees/5-6-product-warranties
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-8-step-5-determine-when/8-4-revenue-recognized-over-time
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-14-presentation/14-3-refund-liabilities
- https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2023/issued/ias37-ie.html
- https://www.revenuehub.org/article/costs-to-fulfill-a-contract
- https://www.accountingtools.com/articles/warranty-accounting
- https://warrantyhub.com/blog/warranty-reserve-accrual-guide/
- https://www.hubifi.com/blog/journal-entry-return-guide

SAP
- https://learning.sap.com/courses/implementing-in-house-service-processes-in-sap-s-4hana-cloud-public-edition-service/explaining-the-process-steps-for-in-house-repairs_a5ddc919-9c1b-435b-b031-d413d9182f6c
- https://learning.sap.com/courses/cost-object-controlling-in-sap-s-4hana/performing-results-analysis-before-resource-related-billing
- https://learning.sap.com/courses/cost-object-controlling-in-sap-s-4hana/period-end-closing-sales-order-results-analysis
- https://learning.sap.com/courses/implementing-in-house-service-processes-in-sap-s-4hana-cloud-public-edition-service/introducing-warranty-claim-management-supplier-recovery-processing_f276f5b3-cfb9-4115-aab0-0c938b8ee9c1
- https://blog.sap-press.com/principles-of-event-based-revenue-recognition-ebrr-in-sap-s4hana
- https://sapficoandmore.wordpress.com/2021/01/02/return-order-processing-in-co-pa-in-s-4hana/
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/89d896ca9cd64318b1667df5ec00e4b2/7fd9ad1108b94403a2871cf348d4b891.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/36802406aebb4b96b1598246e1d316ee/68e7c353b677b44ce10000000a174cb4.html
- https://community.sap.com/t5/financial-management-blog-posts-by-sap/supported-revenue-recognition-methods-in-sap-s-4hana-service-including-sap/ba-p/14248039
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/through-the-looking-glass-s-4-hana-service-management-transition-to-item/ba-p/13979154
- https://community.sap.com/t5/enterprise-resource-planning-q-a/no-accounting-document-generated-during-return-delivery-pgr/qaq-p/5226778
- https://community.sap.com/t5/enterprise-resource-planning-q-a/automatic-account-determination-of-obyc-gbb-vax-vay-and-wrx/qaq-p/14362183
- https://community.sap.com/t5/enterprise-resource-planning-q-a/account-determitatoin-for-free-of-charge-sale/qaq-p/10324079
- https://community.sap.com/t5/enterprise-resource-planning-q-a/warranty-only-posting-wr-warranty-debit-document-to-both-claimant-and/qaq-p/804335
- https://userapps.support.sap.com/sap/support/knowledge/en/3675873

NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1460914.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1307628.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2199328.html
- https://concentrus.com/gl-impact-of-item-receipt-from-return-authorization-if-restock-preference-is-set-to-no/
- https://blog.prolecto.com/2020/12/19/get-control-over-netsuite-sales-returns-general-ledger-accounting/
- https://blog.prolecto.com/2015/09/27/netsuite-up-close-custom-gl-lines-plug-in-to-reclass-general-ledger-postings/
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4391753773.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4389393717.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4391872321.html
- https://blog.concentrus.com/8-things-to-consider-for-warranty-repairs-management-in-netsuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3751154057.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0824032005.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0902104537.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4331936670.html
