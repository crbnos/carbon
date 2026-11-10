# Chart of Accounts Remap Research: Best Practices Survey

## Summary

This survey looks at how an ERP replaces its delivered chart of accounts with the customer's own chart. It covers Odoo (v16–v18) and NetSuite in depth, and SAP S/4HANA briefly. All three rename and renumber the delivered accounts in place. All three keep the default posting roles on the record id, so a rename never breaks a role. No product deletes an account that has postings. NetSuite and Odoo 18 can merge accounts, and both rewrite history to do it. SAP has no merge outside a paid conversion project. No product removes the accounts that an import leaves out. In all three, the specialist deactivates them by hand.

## Competitors Surveyed

- **Odoo** — the user asked for it. It installs a localized chart from a template, and implementers edit that chart in place.
- **NetSuite** — the user asked for it. It creates system accounts per feature and imports the customer's chart with the CSV Import Assistant.
- **SAP S/4HANA** — the reference product. It delivers one fixed chart (YCOA) and maps the customer's numbers to it.

## Key Consensus Patterns

### 1. Rename and renumber the delivered accounts in place

- **Odoo**: Implementers rename and recode the template accounts and create only the accounts with no template match. Odoo allows a code change on an account with journal items. An export and re-import by External ID updates the template accounts in place.
- **NetSuite**: A user can rename and number the system accounts. NetSuite updates every record that refers to an account when its name or number changes. Implementers keep the account type of a system account when they rename it.
- **SAP**: The "Renumber G/L Accounts" activity renumbers YCOA. SAP allows it only while the account has no postings in production.
- **Rationale**: Every default role points at the account record, not at its number. So a rename keeps every role, every document and every posted line.

### 2. An account with postings is never deleted

- **Odoo**: Odoo refuses with "You cannot perform this action on an account that contains journal items." The user marks the account `deprecated` instead. A deprecated account refuses new journal items.
- **NetSuite**: Delete works only if the account has no transactions and NetSuite does not require it. An inactive account keeps its balance. Help tells the user to move the balance to zero first.
- **SAP**: Cloud cannot delete a G/L account. The user sets "Blocked for Posting". SAP refuses "Not Used" once the account has postings.
- **Rationale**: Posted history must keep its account. Deactivation hides the account and keeps the audit trail.

### 3. Control accounts are protected

- **Odoo**: Odoo refuses to delete an account that a default role, a tax or a fiscal position uses. A company can have only one Current Year Earnings account.
- **NetSuite**: Retained Earnings "can't be deleted or substituted with another account". NetSuite refuses to merge Accounts Receivable, Accounts Payable, Inventory Asset, Cost of Goods Sold, Accrued Purchases (GRNI), Undeposited Funds and Opening Balances.
- **SAP**: Automatic account determination holds the roles (`BSX` inventory, `WRX` GR/IR, `PRD` price difference, `GBB` offsets). A role change affects new documents only.
- **Rationale**: The posting engine needs these accounts. A specialist can rename them. A specialist cannot remove them.

### 4. Merge is rare, and where it exists it rewrites history

| Product | Merge | What happens to posted lines | Restrictions |
|---|---|---|---|
| NetSuite | Actions → Merge on the account | Moves them to the target. Reports then show them on the target. | Same type only. No subaccounts on the source. No summary accounts. No control accounts. Bank merge removes reconciliation. |
| Odoo 18 | "Merge accounts" wizard | Moves every foreign key, including `account_move_line.account_id`, then deletes the source. | Accounts of different companies only. For one company, Odoo says to mass-edit the journal items. |
| Odoo 16–17 | None | — | — |
| SAP | None in standard. A paid SLO "Chart of Accounts Conversion" project does it. | Converted by the project. | Same basic properties. |

- **Rationale**: There is no consensus. The two products that merge rewrite history. SAP and Carbon treat posted lines as immutable.

### 5. The default chart is set before the first posting

- **Odoo**: Onboarding has a Chart of Accounts step with opening balances in the same list. A switch to another localization is possible only before the first journal item.
- **NetSuite**: Implementers load the chart and the master records before they load history.
- **SAP**: Implementers renumber YCOA first, right after SAP provides the development system.
- **Rationale**: Before the first posting, every change is free. After it, only a rename is free.

### 6. Operations always post, and go-live loads balances at one date

- **Odoo**: Odoo always posts. No ledger-less mode exists. The opening move holds one line per account plus an "Automatic Balancing Line" on Current Year Earnings.
- **NetSuite**: Transactions post in real time. Implementers journal in balance-sheet balances as of a period end. They load open AR and AP and cancel the GL impact with a clearing account.
- **SAP**: The migration cockpit loads balances and open items at a key date. Each load posts against a migration account that must net to zero.
- **Rationale**: One opening entry at one date, against a clearing account, gives a clean start. Carbon's activation wizard and Migration Clearing account follow the SAP shape.

### 7. One chart for the whole group

- **Odoo**: Branches use the parent company's chart. v18 shares one account across companies, with one code per company.
- **NetSuite**: All OneWorld subsidiaries share one chart. The Subsidiaries field limits where an account is available.
- **SAP**: All company codes post on YCOA. An optional alternative chart per company code holds local numbers.
- **Rationale**: Consolidation needs one chart. Local numbers are a mapped view, not a second chart.

## Answers to Research Questions

1. **How does each product ship a default chart, and how does an implementer replace it?** Odoo installs a localization template. Implementers edit it in place or import an xlsx that matches on `code`. NetSuite creates system accounts per feature. Implementers import the rest with the CSV Import Assistant and rename the system accounts. SAP delivers YCOA and renumbers it before the first posting.
2. **How do rename, merge, deactivate and delete work for accounts with postings?** All three allow a rename. None allows a delete. Odoo deprecates. NetSuite inactivates. SAP blocks for posting. NetSuite merges and rewrites history. Odoo 18 merges across companies only. SAP does not merge.
3. **How do default roles survive a remap?** In all three, a role refers to the account record. A rename keeps the role. NetSuite and Odoo refuse to delete an account that a role uses.
4. **Do operations post before accounting go-live?** Yes, in Odoo and NetSuite. Neither has a provisional mode. The opening balances go in as one entry at one date.
5. **How is the hierarchy set?** Odoo derives groups from code prefix ranges. Groups with the same prefix length cannot overlap. NetSuite uses "Subaccount Of", with the same type as the parent. Houseblend advises 2 or 3 levels. SAP uses a financial statement version.
6. **Is the chart shared across companies?** Yes in all three, with per-company numbers as an option (Odoo 18 `code_store`, NetSuite Accounting Contexts, SAP alternative chart).

**Unanswered:** No product removes the accounts that an import leaves out. Odoo's import note says "Existing accounts will be updated based on this identifier or the account will be created". It does not mention removal. The closest match is NetSuite's Germany SuiteApp. Before it loads SKR03 or SKR04, it renames each clashing account to `Name_Number` and deactivates it.

## Competitor-Specific Details

### Odoo

- **Templates**: v17+ stores a chart as CSV files under `data/template/`. `template_data` holds the role mapping, for example `property_account_receivable_id: 'receivable'`. Each account gets the xml id `account.{company_id}_{xmlid}`.
- **Localization lock**: v16 refuses a new chart with "Could not install new chart of account as there are already accounting entries existing." v17 and v18 make the package read-only once any journal item exists.
- **Import**: `coa_import_template.xlsx` has the columns `code`, `name` and `opening_balance`. The row matches an existing account on `code`. v18 infers the account type from the account with the closest lower code when the row has none.
- **Default roles**: AR and AP on the partner, income and expense on the product category, stock valuation, input and output on the product category, suspense and FX accounts on the company. All are many2one references to the record.
- **Implementer keep-list**: Steersman lists 17 accounts to rename and never delete. Among them are AR, AP, Stock Valuation, Stock Interim (Received and Delivered), Undistributed Profits, Bank Suspense, and Outstanding Receipts and Payments.
- **Merge (v18)**: The wizard groups accounts by type, currency and reconcile flag. It refuses two accounts of the same company with "Belongs to the same company as %s."

### NetSuite

- **System accounts**: The A/R, A/P, Inventory, Multiple Currencies, Advanced Receiving and Advanced Revenue features each create accounts. If a user account already has the same name, NetSuite adds "(system)" to the system account's name.
- **Import fields**: External Id, Account Number, Account Name, Account Type, Subaccount Of and Subsidiaries. A duplicate account number fails. A parent reference uses "number name", for example "40500 Sales".
- **Import modes**: Add, Update, and Add or Update. A row matches on internal id, external id or name. Help warns that name matching fails more often.
- **Type change**: NetSuite refuses a type change once the account has transactions.
- **Item accounts**: A checkbox can rewrite existing transactions when an item's COGS or Asset account changes. Help warns that the change can cause problems.

### SAP S/4HANA

- **Fixed chart**: Cloud customers post on YCOA. The customer's legacy numbers live in an alternative chart that maps to YCOA.
- **Renumber window**: Only before the first production posting. The conversion needs 2 to 4 hours of downtime on the development system.
- **Go-live**: The cockpit posts each load against migration accounts 39914000–39917000. Each one must net to zero.

## Recommended Approach for Carbon

1. **The import names the delivered account it replaces, and the tool renames that account in place.** This follows the Odoo implementer practice and the SAP renumber activity. The "Carbon account" column plays the role of Odoo's External ID and NetSuite's internal id.
2. **Never delete an account with journal lines. Deactivate it.** This follows all three products. Enforce it in the database with `ON DELETE RESTRICT` on `journalLine.accountId`, as Odoo enforces it in its ORM.
3. **Protect the accounts behind required default roles.** A specialist may rename them or move the role to a compatible account. A specialist may not leave the role empty. This follows NetSuite's no-merge list and Odoo's delete guard.
4. **Refuse a class change on an account with posted lines.** This follows NetSuite's type-change rule.
5. **Merge by re-pointing only where history is not posted.** Re-point Draft and Provisional lines, documents and roles. For posted lines, post a reclass entry and deactivate the source. This follows SAP and Carbon's own immutability rule. NetSuite and Odoo 18 rewrite history instead. Carbon's `check_posted_record_immutable` rules that out.
6. **Retire the delivered accounts that the import leaves out.** No product surveyed does this automatically, so this is a Carbon choice. It is safe only because of rules 2 and 3: retire deletes an unused account, deactivates a used one, and never touches a required role.
7. **Do the chart remap before the first Posted journal.** Odoo, NetSuite and SAP all set the chart before transactions. Carbon's Provisional status gives a window for this that the surveyed products do not have. The remap still works after cutover, because a rename is always safe.
8. **Keep the group tree and set the parent from a Group column.** This follows NetSuite's "Subaccount Of". Odoo's prefix ranges need a numbering scheme that customer charts do not always follow.
9. **Keep one chart per company group.** This follows all three products.

## Sources

Odoo:
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/chart_template.py
- https://github.com/odoo/odoo/blob/16.0/addons/account/models/chart_template.py
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_account.py
- https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_account.py
- https://github.com/odoo/odoo/blob/16.0/addons/account/models/account_account.py
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/company.py
- https://github.com/odoo/odoo/blob/18.0/addons/account/wizard/account_merge_wizard.py
- https://github.com/odoo/odoo/blob/18.0/addons/account/static/xls/coa_import_template.xlsx
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/onboarding_onboarding_step.py
- https://github.com/odoo/odoo/blob/18.0/addons/stock_account/models/account_chart_template.py
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/chart_of_accounts.html
- https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html
- https://www.odoo.com/documentation/18.0/applications/essentials/export_import_data.html
- https://www.odoo.com/odoo-18-release-notes
- https://steersman.works/a/723-migrating-accounting-to-odoo-guide
- https://apaa.io/en/blog/odoo-update-chart-of-accounts
- https://www.odoo.com/forum/help-1/what-are-the-sacred-accounts-taxes-andor-journals-in-the-us-chart-of-accounts-which-ones-cant-i-edit-change-delete-because-they-are-referenced-by-other-things-170782

NetSuite:
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4078513386.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1440518.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1443248.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1444958.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1442914.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1443085.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1442743.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N357847.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N345294.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1387022.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2172688.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1441761.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1442160.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541684823.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4640155582.html
- https://blog.prolecto.com/2021/08/28/understand-netsuite-systems-accounts/
- https://blog.prolecto.com/2016/07/25/how-to-build-and-upload-a-netsuite-chart-of-accounts/
- https://netsuite-data-migration-guide.fowlersconsulting.co.uk/loading-the-data/chart-of-accounts
- https://www.houseblend.io/articles/netsuite-chart-of-accounts-best-practices
- https://optimaldataconsulting.com/resources/load-financials-and-open-transactions-from-quickbooks-to-netsuite

SAP:
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/32ed3c6435ea46afb4dbab6839fabe8e.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/91344a60732b4a3d9b227df75e104f20.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/d6e9d110ab4242308a50f9a9c9792f8a.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/2592d7531a4d414de10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/d5699934e7004d048c4801b552f3b013/fe27b4c6a02546d98bece37b89712d00.html
- https://help.sap.com/docs/SAP_LANDSCAPE_TRANSFORMATION/d60cfd6859ba457fb5c8b4436c942388/af31c15839904ef2af96d3e94447a2ed.html
- https://eursap.eu/blog/configure-and-adapt-a-pre-delivered-chart-of-accounts-to-your-business-needs-in-sap-s-4hana-public-cloud
- https://learning.sap.com/courses/cross-functional-customizing-in-sap-s-4hana-materials-management/describing-automatic-account-determination
