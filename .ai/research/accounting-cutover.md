# Accounting Cutover Research: Best Practices Survey

## Summary

This survey asks how 7 ERPs move a running business onto a new general ledger. It covers per-document open items, the migration clearing account, the cutover date, and ledgers that record postings that do not count.

All 7 products load open receivables and payables one document at a time, never as one control-account total. A payment after go-live then clears the migrated item like any other open item. SAP and the NetSuite and Dynamics 365 consultants post every load against a migration clearing account, and that account must total zero before go-live. No product has a standard open-item method for received-not-invoiced goods or WIP. Odoo's Invoicing Switch Threshold is the closest match to a provisional ledger. Odoo records journal entries from day one, and a date later decides which entries count.

## Competitors Surveyed

- **SAP S/4HANA (Migration Cockpit)** — the enterprise reference. It has documented migration objects, named clearing accounts and a migration key date.
- **Oracle NetSuite** — the mid-market accounting reference (required for the accounting domain).
- **Microsoft Dynamics 365 Finance & Operations** — enterprise. It has posting layers and period statuses.
- **Microsoft Dynamics 365 Business Central** — mid-market. It has data migration extensions from GP, C5 and QuickBooks Online.
- **Odoo** — open source. Its invoicing-to-accounting switch is the nearest match to Carbon's case.
- **Acumatica** — mid-market. Its migration mode releases sub-ledger documents with no GL effect.
- **QuickBooks Online** — a contrast only. It has one Opening Balance Equity account.

## Key Consensus Patterns

### 1. Open receivables and payables are loaded per document

- **SAP**: the AR and AP migration objects take one line for each open item. SAP: "no documents will be migrated. Only balances and open items."
- **NetSuite**: the team imports each open invoice and bill for the amount still due, with one line on an "Opening Balance" item.
- **Dynamics 365 F&O**: consultants load each open invoice through the General journal, account type Customer or Vendor. The stated reason is that "when the customers pay, we need to apply the cash to the invoices".
- **Business Central**: the GP and C5 migrations create one entry for each open document.
- **Odoo**: the team imports each open invoice, bill and credit note as a document. Its one line holds the amount still due.
- **Acumatica**: each document carries its original amount and its open balance on the migration date.
- **Rationale**: a payment, a credit or an aging report needs the document. A control-account total cannot be paid.

### 2. A migration clearing account must total zero

- **SAP**: Best Practices names 4 offset accounts, one each for AR, AP, other GL and other open-item GL (39914000 to 39917000). SAP: "The total balance of all migration clearing accounts … must be zero."
- **NetSuite**: partners post open documents to an Opening Balance clearing account. The trial balance journal leaves out AR, AP and inventory. After both loads the clearing account "should now have a zero balance".
- **Dynamics 365 F&O**: consultants post each line against a temporary account, for example "Opening Balance Difference Account". That account "should be ideally 'Zero' after posting all the balances".
- **Odoo**: the open documents post to AR Clearing and AP Clearing. The team checks that both accounts are balanced, then changes their type to Off-Balance Sheet.
- **Rationale**: the open documents and the trial balance come from 2 sources. If the clearing account ends at zero, those 2 sources agree.

### 3. A "net zero" variant leaves the GL balance to the trial balance

- **Business Central**: the C5 migration offsets each sub-ledger load against its own control account, so the load adds nothing net to the GL. The GL balance comes from the trial balance load.
- **Acumatica**: migration-mode documents "update the customer balances only; they do not update GL account balances". The trial balance import sets the control accounts. The team then reconciles the sub-ledger against the GL.
- **Dynamics 365 F&O**: consultants call the same pattern "net zero".
- **Rationale**: this pattern needs no clearing account. It still needs a reconciliation of the sub-ledger against the GL. The clearing-account pattern makes that reconciliation one number.

### 4. A migrated open item is paid like any other open item

- **SAP**: a migrated open item is a real FI document with the customer line. A payment clears it.
- **Dynamics 365 F&O**: the journal line creates a normal customer transaction, and the payment settles it.
- **NetSuite**: a migrated invoice is a normal invoice. Optimal Data warns: to reverse one after go-live, "do not use the OPENAR clearing account as the offset".
- **Business Central and Odoo**: the payment applies to the migrated ledger entry or reconciles against the migrated receivable line.
- **Rationale**: the migration posting itself writes the control-account line. A payment has a real line to clear.

### 5. The cutover date is a period boundary, and earlier postings are blocked

- **SAP**: each company code has its own Migration Key Date. SAP fixes the date of every migration document to it. "Postings after this key date are not allowed" for the historical balance object.
- **NetSuite**: partners pick the first day of an accounting period. Oracle closes the periods before it.
- **Dynamics 365 F&O**: consultants use the last closed period end and then set the period to On hold.
- **Odoo**: the documentation recommends the end of the fiscal year. The Lock Everything date blocks earlier entries.
- **Rationale**: if a posting dated before the cutover lands after go-live, the opening balances become wrong.

### 6. Inventory documents from before go-live are never voided

- **SAP**: the inventory migration posts stock only (movement type 561), so no goods receipt from before go-live exists in the new system. A return of that stock uses movement type 161 on a return PO, because movement type 122 needs the original goods receipt. Users can post only in the current and the previous MM period.
- **Dynamics 365 F&O**: the migration loads stock on hand and open orders only. "Cancel" of a product receipt posts on the original date, and inventory close blocks posting into a closed period. A return with no original order takes its cost from "Return cost price", else from the current cost.
- **Business Central**: Undo Receipt and Undo Shipment post on the original date, and a closed inventory period blocks them. Undo also fails when a later posting consumed any of the received quantity.
- **NetSuite**: the go-live load is an inventory worksheet or adjustment, so no item receipt from before go-live exists. Oracle says: "To edit or delete a transaction in a closed period, you need to reopen the closed period." For a wrong receipt cost, the docs say to post an inventory adjustment in the current period.
- **Odoo**: the source code refuses to cancel a done move: "Create a return in order to reverse the moves which took place." A customer return takes the cost of the original delivery's valuation layers.
- **Acumatica**: a released IN Receipt has no Reverse action. The user posts an IN Issue or a negative IN Adjustment. A shipment that updated inventory needs an RC/RMA order.
- **Rationale**: the original cost layer is gone or in a closed period. A forward return or adjustment posts in an open period at a cost the system can still find.

## Answers to Research Questions

1. **Per document or per total?** Receivables, payables, credit memos and unapplied payments go per document in all 7 products. Every other GL account goes as a balance. Inventory goes per item with quantity and value (SAP movement type 561, NetSuite Inventory Worksheet). Fixed assets go per asset with cost and accumulated depreciation.
2. **Clearing account?** SAP, NetSuite partners, Dynamics 365 consultants and Odoo use a clearing account that must total zero. Business Central and Acumatica use the net-zero variant. QuickBooks Online uses one Opening Balance Equity account, which the user clears to retained earnings.
3. **Paying or voiding a pre-go-live document?** A payment clears the migrated open item in every product. A reversal after go-live must post to the real revenue or expense account, not to the closed clearing account (NetSuite, Optimal Data). Dynamics 365 refuses to reverse a settled transaction, and asks for a new date when the period is closed.
4. **Cutover date?** A period start, or the last closed period end (SAP, NetSuite, Dynamics 365). The products block earlier postings with a closed period or a lock date. Implementation guides load the documents created between the cutover date and go-live as a "delta load".
5. **Ledgers that do not count?** No product promotes a provisional entry to a posted entry. The nearest mechanisms:
   - **Odoo**: the Invoicing Switch Threshold cancels every journal entry before a date "to start with a clean general ledger". Older invoices get the "Invoicing App Legacy" payment state.
   - **Acumatica**: migration mode releases documents with no GL batch and marks them "Migrated".
   - **SAP**: the historical balance object posts balances before the key date. SAP reverses them in the key-date period.
   - **Dynamics 365, Business Central and NetSuite**: Dynamics 365 has posting layers, Business Central has statistical accounts, and NetSuite has non-posting transactions.
6. **Received-not-invoiced and WIP?** No product has a standard open-item method. SAP consultants clear received-not-invoiced before the key date. Dynamics 365 forums list 3 workarounds: a plain GL balance, a placeholder PO, or a real PO received again. No source covers WIP; the products load it as a GL balance.

## Competitor-Specific Details

### SAP S/4HANA

- The Legacy Data Transfer Status moves In Preparation → Ongoing → Completed. Migration postings are possible only in Ongoing.
- Fixed assets have their own transfer date. While the asset transfer is open, users cannot post normal asset transactions.
- Simulate Import runs the real posting code and never commits.
- Inventory posts with movement type 561: debit inventory (BSX), credit the initial-stock offset (GBB-BSA).

### Oracle NetSuite

- The equity account "Opening Balance" starts at zero. The Opening Balances page shows an "Out of Balance By" field.
- Partners date every imported document on the day before go-live, so one journal can reverse them all.
- A customer deposit cannot go in through CSV import.

### Microsoft Dynamics 365 Finance & Operations

- Period statuses are Open, On hold and Permanently closed.
- Posting layers are Current, Operations, Tax and 7 custom layers. Financial reports read the Current layer by default.

### Microsoft Dynamics 365 Business Central

- Allow Posting From/To limits posting dates at 3 levels: journal template, user setup and general ledger setup.
- A fixed asset load turns G/L integration off on the depreciation book, posts cost and accumulated depreciation per asset, then turns integration back on.

### Odoo

- The Invoicing app posts journal entries even when the company does not use Accounting. The Invoicing Switch Threshold is a date. On the switch, Odoo cancels every entry before it, and the entries after it stay posted. (Source: a forum thread and a mergebot pull request, not the product docs.)
- Odoo dates the Opening Journal Entry one day before the opening date. An "Automatic Balancing Line" puts any difference on Undistributed Profits/Losses.
- The Hard Lock date cannot be undone.

### Acumatica

- Migration mode is a switch per module (AR, AP, Projects). Migrated documents "cannot be edited or released when migration mode is deactivated".
- Inventory and fixed assets load with Update GL cleared. The value in the GL comes from the trial balance import.

## Recommended Approach for Carbon

1. **Write one opening line per open document.** Use this for receivables, payables, credit memos and unapplied credits. It follows the consensus of all 7 products. Each line carries the document link, so the existing payment lookup finds a control line to clear.
2. **Post every opening line and the trial balance against one Migration Clearing account.** Refuse to enable until it totals zero. This follows SAP and the NetSuite partners. It turns the sub-ledger-to-GL reconciliation into one number that a person can check before go-live.
3. **Keep the provisional ledger as Odoo does.** Record the journal entries while accounting is off. At the switch, entries before the cutover date stop counting, and entries on or after it count. Carbon goes one step further than Odoo: it uses the provisional entries to compute the per-document opening amounts.

   **What the spec chose:** Carbon keeps the provisional ledger, but receivables and payables do not open from it. Each opening amount is the document's total minus the settlements in effect on the day before the cutover date, in base currency (`getReceivableAndPayableItems`, `packages/database/src/accounting-cutover/open-items.ts`). The read refuses when that amount differs from the AR and AP aging readers. An unapplied payment credit opens from the payment's journal line, else from the payment and its settlements. Most invoices dated before the cutover date have no journal, because the reset deleted it.
4. **Make the cutover date a period start, and block earlier postings after enable.** This follows SAP's key date, NetSuite's closed periods and Odoo's lock date.
5. **Reverse a pre-cutover document against real accounts, never against the clearing account.** This follows the NetSuite guidance. After enable, the clearing account must stay at zero.

   **What the spec chose:** Carbon refuses to void an invoice dated before the cutover date, because no builder rebuilds a whole invoice posting. The sales invoice void tells the user to issue a credit memo. The purchase invoice void tells the user to record a debit memo (`refuseVoidBeforeCutover`, `packages/server-functions/src/lib/cutover-void.ts`). A user can still void a payment or a memo dated before the cutover date. That void rebuilds the posting, negates it, and refuses any line on Migration Clearing (`assertNoMigrationClearing`). The void of a charge or a reimbursement dated before the cutover date refuses too.
6. **Treat received-not-invoiced and WIP as a decision for Carbon.** No product has a standard method. Carbon has the per-receipt and per-job provisional entries, so it can compute both per document. SAP's alternative: the company clears both before cutover.

   **What the spec chose:** both open per document. Received-not-invoiced opens per PO line on the GR/IR account (`getReceivedNotInvoicedItems`, `packages/database/src/accounting-cutover/open-items.ts`). The amount is the receipts before the cutover date at their receipt cost, less what the invoices before the cutover date cleared. The receipt cost is the receipt's GR/IR journal line, else its cost layers, else quantity × unit price. A purchase invoice dated on or after the cutover date finds the opening line by its `receipt:<poLineId>` reference. WIP opens per job from the job's lines on the WIP account dated before the cutover date (`getWorkInProgressItems`).
7. **Refuse to void an inventory document dated before the cutover.** Point the user to a return or an inventory adjustment. All 6 products with inventory do this (pattern 6). Carbon already refuses a sales return receipt void once its layer is consumed (`post-receipt/index.ts:436`).

## Sources

- SAP — Migration Objects for SAP S/4HANA (PDF): https://help.sap.com/doc/69dd0f1ef0034261ab6e617e0b2beb21/1909.latest/en-US/MigrationObjects_OP_EN.pdf
- SAP — FI AR open item: https://help.sap.com/docs/SAP_S4HANA_CLOUD/d5699934e7004d048c4801b552f3b013/c633ded541d44facae2a4938fd3c2e3c.html
- SAP — Migration Key Date: https://www.linkedin.com/pulse/posting-date-migration-key-sap-s4-hana-alon-gilady
- SAP — Entering legacy asset data: https://learning.sap.com/courses/configuring-asset-accounting-in-sap-s4hana/entering-legacy-data
- SAP — Migration Cockpit guide: https://community.sap.com/t5/technology-blog-posts-by-members/a-comprehensive-guide-to-data-migration-with-the-sap-s-4hana-migration/ba-p/14224541
- SAP — GBB-BSA for movement type 561: https://ganeshsapscm.com/2019/09/23/what-is-the-transaction-key-and-account-grouping-for-the-credit-ve-account-entry-during-initial-entry-of-stock-posting-with-561-movement-in-sap-mm/
- SAP — Reconciliation guide: https://datavapte.com/blog/sap-data-reconciliation-migration-guide/
- NetSuite — Historical balances in OneWorld: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1442160.html
- NetSuite — Opening balances: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1441761.html
- NetSuite — Period locks: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_164201094029.html
- NetSuite — Non-posting transactions: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452887.html
- NetSuite — Statistical journal entries: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3863545249.html
- NetSuite — Fixed asset CSV import: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2148181.html
- NetSuite — Techfino opening balances, AR: https://www.techfino.com/blog/opening-balances-part-3-accounts-receivable
- NetSuite — Techfino opening balances, AP: https://www.techfino.com/blog/opening-balances-part-4-accounts-payable
- NetSuite — Techfino opening balances, inventory: https://www.techfino.com/blog/opening-balances-part-2-inventory-management
- NetSuite — Optimal Data, open AR: https://optimaldataconsulting.com/resources/how-to-import-open-ar-transactions-into-netsuite
- NetSuite — Fowlers, AR and AP balances: https://netsuite-data-migration-guide.fowlersconsulting.co.uk/loading-the-data/ar-and-ap-balances
- NetSuite — Concentrus upload tips: https://blog.concentrus.com/open-balance-open-transaction-uploads-tips
- NetSuite — Houseblend cutover testing: https://www.houseblend.io/articles/netsuite-data-migration-cutover-testing
- Dynamics 365 F&O — Import general journals: https://learn.microsoft.com/en-us/dynamics365/guidance/resources/import-general-journals
- Dynamics 365 F&O — Inventory journals: https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-journals
- Dynamics 365 F&O — Fixed asset transactions: https://learn.microsoft.com/en-us/dynamics365/finance/fixed-assets/enter-fixed-asset-transactions
- Dynamics 365 F&O — Posting layers: https://learn.microsoft.com/en-us/dynamics365/finance/fixed-assets/post-fixed-asset-transactions-posting-layers
- Dynamics 365 F&O — Financial reporting: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/analytics/financial-reporting-intro
- Dynamics 365 F&O — Reverse journal posting: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/reverse-journal-posting
- Dynamics 365 F&O — Cannot reverse a transaction: https://learn.microsoft.com/en-us/troubleshoot/dynamics-365/finance/general-ledger/cant-reverse-transactions
- Dynamics 365 F&O — Mass financial period close: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/tasks/mass-financial-period-close
- Dynamics 365 F&O — Prepare to go live: https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/prepare-to-go-live
- Dynamics 365 F&O — Lopez-Coll posting logic: https://lopez-coll.com/blog/migrate-financial-opening-balances-the-posting-logic
- Dynamics 365 F&O — Opening balance approach: https://community.dynamics.com/blogs/post/?postid=4f63b14a-6b9e-4d0b-857a-f0eaaef51067
- Dynamics 365 F&O — Sub-ledger opening balances: https://community.dynamics.com/blogs/post/?postid=ab900a06-2977-41b9-8102-f73ce0b159ab
- Dynamics 365 F&O — Jay Dave, opening balance migration: https://www.linkedin.com/pulse/opening-balance-migration-dynamics-ax-2012d-365-fo-ca-jay-dave
- Dynamics 365 F&O — Western Computer, migrate balances: https://www.westerncomputer.com/resources/blog/how-to-migrate-financial-balances-to-dynamics-365-ax-a-step-by-step-guide
- Dynamics 365 F&O — GRNI migration: https://www.dynamicsuser.net/t/migrating-open-purchase-orders-from-legacy-system-to-d365-is-there-a-status-on-po-line-to-indicate-that-line-item-is-received-but-has-not-yet-been-invoiced-grni/66937
- Business Central — C5 data migration: https://learn.microsoft.com/en-us/dynamics365/business-central/ui-extensions-c5-data-migration
- Business Central — Migrate Dynamics GP data: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/migrate-dynamics-gp
- Business Central — QuickBooks Online migration: https://learn.microsoft.com/en-us/dynamics365/business-central/ui-extensions-quickbooks-online-data-migration
- Business Central — Fixed assets setup: https://learn.microsoft.com/en-us/dynamics365/business-central/fa-how-setup-general
- Business Central — Limit the posting period: https://learn.microsoft.com/en-us/dynamics365/business-central/localfunctionality/belgium/how-to-limit-the-posting-period
- Business Central — Statistical accounts: https://learn.microsoft.com/en-us/dynamics365/business-central/bi-use-statistical-accounts
- Business Central — Preview posting: https://learn.microsoft.com/en-us/dynamics365/business-central/ui-how-preview-post-results
- Odoo — Accounting get started: https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started.html
- Odoo — Year-end closing and lock dates: https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html
- Odoo — company.py (opening move): https://github.com/odoo/odoo/blob/17.0/addons/account/models/company.py
- Odoo — Invoicing switch threshold pull request: https://mergebot.odoo.com/odoo/odoo/pull/98496
- Odoo — Invoicing switch threshold forum thread: https://www.odoo.com/forum/help-1/all-outgoing-invoices-suddenly-marked-as-cancelled-312415
- Odoo — Opening entry import checklist: https://www.odoo.com/forum/help-1/accounting-opening-entry-import-checklist-186010
- Acumatica — Processing in migration mode: https://help.acumatica.com/(W(3))/Wiki/Print.aspx?pageid=5345482e-402e-4d46-9b3d-6a48a37021a8
- Acumatica — Migration general information: https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_DataMigration&PageID=72cd782c-da16-4784-8f01-84b9974fa6a4
- Acumatica — Predefined import scenarios: https://help.acumatica.com/(W(4))/Wiki/Print.aspx?pageid=eb0b41ab-c0fc-46d8-b8b6-b2c99fbc007f
- Acumatica — Asset migration: https://help.acumatica.com/(W(8))/Wiki/Print.aspx?pageid=65a866ca-40ec-43f7-8684-fed5d4076488
- Acumatica — Trial balance import: https://help.acumatica.com/(W(312))/Wiki/ShowWiki.aspx?pageid=0c7e3994-c4dd-4abe-94d1-d609b7c25a94
- QuickBooks Online — Opening Balance Equity: https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/opening-balance-equity-account-issue/00/1008128
- SAP — Material inventory balance migration object: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/476cf31fd1e046a0889bc3ef8da325c3.html
- SAP — Cancellations, return deliveries and returns: https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/posting-cancellations-return-deliveries-and-returns
- SAP — Movement types 122 and 161: https://community.sap.com/t5/enterprise-resource-planning-q-a/difference-between-122-and-161-movement-type/qaq-p/7473882
- Dynamics 365 F&O — Return cost price: https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/return-cost-price-and-return-lot-id
- Dynamics 365 F&O — Inventory costing FAQ: https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/inventory-costing-faq
- Business Central — Item application: https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-item-application
- Business Central — Inventory periods: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-to-work-with-inventory-periods
- NetSuite — Voiding, deleting, or closing transactions: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N563543.html
- NetSuite — Item return costing: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2199328.html
- Odoo — Returns and refunds: https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/returns.html
- Odoo — stock_move.py (17.0): https://github.com/odoo/odoo/blob/17.0/addons/stock/models/stock_move.py
- Acumatica — Reverse an IN receipt: https://community.acumatica.com/distribution-6/reverse-an-inventory-receipt-document-20739
- Acumatica — Correct an updated shipment: https://community.acumatica.com/distribution-6/how-to-correct-a-shipment-that-had-been-updatein-12140
