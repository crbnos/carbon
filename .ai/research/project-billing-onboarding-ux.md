# Project Billing Onboarding UX Research: Best Practices Survey

## Summary

This survey asks how project-accounting products make billing, cost posting,
budgets and government contracting clear to a first-time user. It covers 4
topics: setup readiness, where the contract money shows, the names of the
numbers, and a preview before posting. No surveyed product has an in-app
checklist that lists the billing prerequisites and links each one to its fix.
Unanet and Stripe come closest, with a static list that links each step.
Every product that serves government contractors brings the contract money
together on ONE project view: Unanet's Project Control Panel, Costpoint's
Project Status Report, Odoo's Profitability panel. Most products give a
review step before a post. Unanet's Billing & Revenue Post List tab and D365's
Simulate posting show the amounts or the GL lines before the post.

## Competitors Surveyed

- **SAP S/4HANA Cloud**: the Accounting row's required product. Customer projects, event-based revenue recognition, project billing.
- **NetSuite (SuiteProjects)**: the Accounting row's second product. Charge-based billing.
- **Deltek Costpoint**: the market leader for government contractors.
- **Deltek Vantagepoint and Ajera**: Deltek's products for professional services.
- **Unanet GovCon**: the second leader for government contractors.
- **Microsoft Dynamics 365 Project Operations and Business Central**: a mid-market ERP with a project billing backlog.
- **Acumatica Projects**: a mid-market ERP with an implementation checklist.
- **Odoo Projects**: an open-source ERP with a project profitability panel.
- **Productive, Harvest, Stripe, Linear**: modern tools that are known for their onboarding.

## Key Consensus Patterns

### 1. Setup is a list that links each step; no product checks it for you

- **Unanet**: "Getting Started → Initial Data Setup" is a numbered list. Each step links to its setup screen (Accounts, Fiscal Years, Cost Elements, Cost Structures, Cost Pool Groups, Posting Groups). The list shows no status.
- **Acumatica**: an Implementation Checklist page marks steps Mandatory, Recommended or Workflow. It has no item for GL accounts, rate tables or billing rules.
- **Costpoint**: the help topic for the project setup screens gives an order ("You must set up at least one account group before you enter a project"). The product does not check it.
- **Stripe**: the account checklist deep-links each item to the Dashboard page that fixes it.
- **Productive**: a "Quick Start" guide in the top bar with a progress ring. A missing cost rate blocks time tracking, and the product shows no warning for it.
- **SAP, NetSuite, D365**: setup is scope items or feature checkboxes, and the dependencies are prose in the docs.
- **Rationale**: the prerequisites live in several modules, so a product shows the order. No surveyed product goes the next step: it does not check each prerequisite and show which one fails.

### 2. The contract money shows together on one project view

- **Unanet**: the project Accounting tab holds Total Value and Funded Value. The Project Control Panel shows Revenue, Billed, Budget, Funded Value (amount, remaining, % used), Total Value and the A/R balance on one page.
- **Costpoint**: the money is entered on separate screens (Manage Modifications, Manage Revenue Information, Manage Total Ceilings, Project Budgets/EACs). The Project Status Report brings it together: contract and funded values, cost, revenue, budget, billed and open receivables.
- **Odoo**: the project dashboard's Profitability panel has 3 columns (Expected, To invoice, Invoiced) beside the costs, and a Budget section.
- **Harvest**: Project analysis shows budget, budget remaining, internal costs and the uninvoiced amount.
- **SAP**: Project Control has a Billing tab with the billed amount, the unbilled amount and the recognized revenue.
- **D365**: the money is split. The contract holds funding limits, and the billing backlog holds billed and unbilled amounts.
- **Rationale**: the project manager asks "how much is funded, how much did we spend, bill and earn". A government contracting product answers it on one page.

### 3. A small set of plain names, and the acronyms only where an auditor needs them

| Concept | Unanet | Costpoint | D365 | Odoo |
|---|---|---|---|---|
| Maximum contract amount | Total Value | Value | Not-to-exceed | none |
| Authorized money | Funded Value | Funding | Funding limit | none |
| Cap | Ceiling Amount | Ceiling (per Cost, Fee, Total) | Not-to-exceed | none |
| Billed and unbilled | Billed, Unposted Billings | Billed | Billed and Unbilled sales actual | Invoiced, To invoice |
| Earned value | BCWS, BCWP, ACWP | ITD Budget, ITD Earned Value, ITD Incurred | Cost performance, Schedule performance, EAC | none |

- **Rationale**: every product keeps one name per number. Costpoint and D365 use plain earned value names on screen. Unanet's Earned Value Report uses the acronyms.

### 4. A review step before a post; a few products show the GL lines

- **Unanet**: the Billing & Revenue Post List tab is "a preview of the projected amounts that will be posted". A Cost Pool Calculation can be recalculated many times before the post.
- **D365 Finance**: "Simulate posting" runs the full posting without posting. Hour forecasts have a "General ledger preview".
- **Business Central**: "Preview Posting" works in journals and documents.
- **Vantagepoint**: the "Review GL Details on Accept" option shows the GL lines before an invoice posts.
- **Costpoint**: every posting step prints an edit report first (the timesheet edit report, the revenue journal report "without posting to the G/L", the allocation journal edit report before Post Pool Journals).
- **SAP**: event-based revenue recognition can simulate a revaluation. Classic settlement has a test run.
- **Rationale**: a post writes the GL and is hard to undo. The user wants to see the debits and credits first.

### 5. The billing review is a queue with few statuses

- **NetSuite**: charges are Ready, Hold or Processed.
- **D365**: unbilled actuals are Ready to Invoice or Not Ready to Invoice; the proforma invoice moves Draft → In review → Confirmed.
- **Vantagepoint**: each transaction is Bill, Hold, Write-off or Delete.
- **SAP**: billing elements are To Bill, Unbilled or Billed; the specialist can Write Off, Postpone or Adjust.
- **Costpoint**: bills are Selected, Unselected, Hold or Reverse/Void.
- **Rationale**: the reviewer only decides bill, hold or write off. The queue stays short.

### 6. A feature shows when it is turned on

- **NetSuite**: Enable Features adds subtabs and fields. P&L and Budget appear only with Job Costing and Project Budgeting.
- **Odoo**: Profitability appears only on a billable project. Budget appears only when budgets are on; its empty state is "Add Budget".
- **D365**: the Public sector configuration key adds the government screens.
- **Unanet**: Advanced Costing stays hidden until an admin turns it on.
- **Costpoint**: government contracting is the base design. Single options are opt-in.

## Answers to Research Questions

1. Do products offer a project billing setup checklist that links each fix? — No surveyed product checks the prerequisites in the app. Unanet (a numbered list with links), Acumatica (an implementation checklist) and Stripe (deep links) show the pattern without a status per project.
2. Where does a project's contract money live? — Government contracting products show it on one project view (Unanet Project Control Panel, Costpoint Project Status Report). D365 splits it between the contract and the billing backlog.
3. What names do they use? — Total Value, Funded Value and Ceiling (Unanet); Value, Funding and Ceiling (Costpoint); Billed and Unbilled everywhere. Costpoint and D365 show earned value in plain words; Unanet shows the acronyms.
4. Do they preview the GL before a post? — Unanet previews the amounts. D365, Business Central and Vantagepoint can show the GL lines. Costpoint prints an edit report before each post.
5. How is billing review named? — A queue of unbilled items with Ready, Hold and Write-off decisions (NetSuite, D365, Vantagepoint, SAP).
6. How are government features disclosed? — A switch or a license adds them (D365 Public sector key, Unanet Advanced Costing, NetSuite Enable Features).

## Competitor-Specific Details

### SAP S/4HANA Cloud
Manage Project Billing lists billing elements as To Bill, Unbilled or Billed. A billing request goes through an optional approval with amount thresholds. Event-based revenue recognition nets contract assets and contract liabilities.

### NetSuite
Charge rules create charges at a midnight run or with Generate Charges. A billed charge cannot change. The Project 360 dashboard shows unbilled hours and open invoices per project.

### Deltek Costpoint
The standard bill sequence is Calculate, Manage, Print, Post. Indirect rates go through Compute/Print Pool Rates, the Allocation Journal Edit Report, then Post Pool Journals. The Projects Over x% Funding dashpart shows funding and revenue side by side.

### Unanet
At most one Draft invoice per project. Approving it sets Completed and posts the journal. "Limit Billing To Funded Value" and "Limit Revenue To Funded Value" sit next to the funded value on the project's Accounting tab.

### Dynamics 365
An actual whose Not-to-Exceed status is Failed cannot be marked Ready to Invoice. Business Central's checklist aims at about six tasks of under five minutes each, and the tasks complete on their own.

### Acumatica
The Revenue Budget line holds budget, actual, draft invoice and pending invoice amounts on one grid. Use T&M Revenue Budget Limits adds the limit columns only when it is on.

### Odoo, Productive, Harvest
Odoo's Profitability columns are Expected, To invoice and Invoiced. Productive hides the financial snapshots by permission. Harvest names the open amount "Uninvoiced amount".

## Recommended Approach for Carbon

1. Check the billing prerequisites per project and show each failing one with a link to its fix. This is one step past Unanet and Stripe, which list the steps but check nothing. Reuse the accounting activation `ReadinessChecklist` rows.
2. Bring the contract money together on the project, as Unanet's Project Control Panel and Costpoint's Project Status Report do. Use the existing `FundingBar`.
3. Keep one name per number: Budget, Cost, Funded, Ceiling, Billed, Unbilled, Revenue. Show plain earned value names with the acronym as a hint, as Costpoint and D365 do.
4. Show the debits and credits before a run posts, as D365 Simulate posting and Unanet's post preview do. Reuse `LeaseJournalPreview`.
5. Keep billing review a short queue (bill, hold, write off), as it is today. Make it easy to find.
6. Keep government screens behind their existing switch (`useGovernmentContracting`), as D365 and Unanet do.

## Sources

- https://help.deltek.com/Product/Costpoint/8.2/GA/Standard_Bills.html
- https://help.deltek.com/product/Costpoint/8.1/GA/pjx_Setting_Up_the_Project_Setup_Control_Menu_Screens.html
- https://help.deltek.com/PRODUCT/COSTPOINT/7.1.1/GA/pjmbasic_Mods_Subtask.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/PrjStatRep.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/Projects_Over_x_Funding_Dashpart.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/BPQBETC_Contents_of_the_View_ETC_and_Earned_Value_Screen.html
- https://costpoint.asrcfederal.com/cpweb/helpfiles/costpoint/PJPPOSTR.html
- https://et.norc.org/cpweb/helpfiles/costpoint/PJPPOSTP_Contents_of_the_Post_Pool_Journals_Screen.html
- https://help.deltek.com/product/costpoint/8.2/SMB/GA/prx_Processing_The_Payroll.html
- https://help.deltek.com/Product/Vantagepoint/7.2/st_bill_contents_billing_session_options_db.html
- https://help.deltek.com/Product/Vantagepoint/7.2/projreview_Billing_Tab_of_Project_Review.html
- https://help.deltek.com/product/vantagepoint/6.0/ACT_Activation_and_Setup.html
- https://help.deltek.com/product/ajera/8/content/About_billing_review.htm
- https://unanet.quantum-intl.com/unanet/docs/getting_started/initial_data_setup.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/financials/invoicing___posting/billing_revenue_post.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/financials/invoicing___posting/list_invoices.htm
- https://unanet.quantum-intl.com/unanet/docs/unanet_menu/reports/project_accounting_reports/summary/project_control_panel_report.htm
- https://finance.ccsso.org/unanet/docs/unanet_menu/reports/project_accounting_reports/summary/project_earned_value_report.htm
- https://unanetuniversitycontent.unanet.com/uu_content/GC%20Setting%20Up%20Contracts%20and%20Projects/GC_SettingUpContractsandProjects_FINAL.pdf
- https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/project-funding-limits
- https://learn.microsoft.com/en-us/dynamics365/project-operations/proforma-invoicing/manage-billing-backlog
- https://learn.microsoft.com/en-us/dynamics365/project-operations/proforma-invoicing/manage-proforma-invoice
- https://learn.microsoft.com/en-us/dynamics365/project-operations/psa/project-tracking
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/general-journal-processing
- https://learn.microsoft.com/en-us/dynamics365/finance/public-sector/public-sector-functionality
- https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/onboarding-checklist
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3752833114.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3752834264.html
- https://netsuite.folio3.com/blog/netsuite-project-360-empowers-project-managers/
- https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=f5e5cf75-b160-4797-b23b-fb11a6b9a745
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/29cf986299714386847f4d4c9bb86994/66e931dfc2e5427c8d3eebe491ed04f7.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/an-introduction-to-event-based-revenue-recognition-with-customer-projects/ba-p/13410880
- https://www.odoo.com/documentation/18.0/applications/services/project/project_management/project_profitability.html
- https://help.productive.io/en/articles/10206762-quick-start-learn-how-to-use-productive-with-ease
- https://help.productive.io/en/articles/2179644-understanding-and-setting-up-cost-rates-in-productive
- https://support.getharvest.com/hc/en-us/articles/360048181412-Project-analysis
- https://docs.stripe.com/get-started/account/checklist
