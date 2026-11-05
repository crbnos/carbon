# Project Accounting for Fixed Assets Research: Best Practices Survey

## Summary

This survey asks how ERPs and accounting rules treat project cost that relates to a fixed asset. The trigger is Carbon's **Add Purchase Order** on a task. Its Fixed Asset line debits the asset's account and writes no `projectLedger` row. So a task can show a large purchase with no project cost. The accounting in that line is correct for an asset the company keeps. The gap is visibility: SAP shows the same purchase on the project as a statistical line that settlement ignores. Carbon needs that line, and it needs one guard on Capitalize projects. A purchase that builds the project's asset or that the contract pays for in full must be project cost, not a Fixed Asset line.

## Competitors Surveyed

- **SAP S/4HANA** — the reference for statistical postings and for Assets under Construction (AuC, SAP's term for CIP). Most SAP text in this survey comes from releases 4.6C and 4.7. This survey did not confirm the same behavior in S/4HANA.
- **Oracle Fusion Cloud** — the most complete documented capital project flow. Sources cover releases 25C to 26B. One source covers E-Business Suite (EBS) and says so.
- **Microsoft Dynamics 365 Finance** — Investment projects, and elimination of WIP to an asset.
- **NetSuite** — a mid-market accounting reference, with the Fixed Assets Management SuiteApp (FAM).
- **Acumatica** — a mid-market ERP with an account group model and equipment rates. Vendor pages include MYOB Acumatica, a rebranded edition.
- **Epicor Kinetic** — a discrete manufacturing reference. EpicWeb needs a login, so most findings come from forum posts.
- **Deltek Costpoint** — the reference for government contractors.
- **Rules** — ASC 360, ASC 835-20, ASC 340-40, IAS 16, IAS 23, FAR, CAS. This research informs product design and is not accounting advice.

## Key Consensus Patterns

### 1. One cost has one real cost object

- **SAP**: A purchase on category `A` debits the asset. The WBS element gets a statistical line only [S1, S2].
- **Oracle**: Routing prevents the double count. A capital project cost goes to Project Costing, and only nonproject receipts go to Assets [O1, O2].
- **Dynamics 365**: Microsoft documents a fixed asset path and a project path [M1, M3]. Third-party sources say one line cannot use both [D1, D2].
- **Rationale**: Two real debits overstate the books, so each product picks one owner for the cost.

### 2. A capital project collects cost first and moves it later

- **SAP**: A WBS element or order is the "primary account assignment object". It settles periodically to the asset [S3].
- **Oracle**: The purchase becomes project cost. Asset lines then move it to Oracle Assets [O3, O4, O5].
- **Dynamics 365**: An Investment project holds cost in WIP. Elimination moves it to a fixed asset, a ledger account or a new project [M1].
- **Rationale**: The project owner needs one view of everything the asset costs before it is in service.

### 3. A capital project also holds cost that is not capitalized

- **SAP**: Settlement type `PRE` sends the cost that cannot be capitalized to a cost center. The AuC receives the remainder [S4].
- **Oracle**: Task and transaction controls set the capitalizable status. Together both shares give "the total cost of your project" [O1].
- **Dynamics 365**: An Investment line property with capitalization off posts to profit and loss [M4].
- **Rules**: ASC 360 and IAS 16 expense G&A and general overhead [R1, R2].
- **Rationale**: A capital project always includes spend that the standards refuse, such as administration.

### 4. Company asset use reaches a project through a rate

- **SAP**: A user enters a sender cost center, an activity type and a receiver WBS element. Activity prices give the cost [S5].
- **Oracle**: The "Usages" class needs a nonlabor resource. Nonlabor rate schedules give the cost and the bill amounts [O6, O1].
- **Acumatica**: The Equipment form holds Run, Setup and Suspend rates, a per-project grid and a Fixed Asset link [A1].
- **Deltek**: Manage Unit Usage records equipment usage for per-unit billing [C1].
- **Rationale**: The company keeps the asset across projects, so no single project should carry the full price.

## Answers to Research Questions

**1. A purchase on a project task buys a fixed asset. Where does the cost show?**

| Product | Real debit | Project shows |
|---|---|---|
| SAP, category `A` with a linked WBS element | Asset | Statistical commitment, then statistical actual [S1, S6] |
| Oracle, capital project | Project first, asset later | Project cost [O1, O3] |
| Dynamics 365, Investment project | WIP, asset after elimination | Project cost [M1] |
| Dynamics 365, fixed asset PO | Asset | UNVERIFIED |
| Acumatica, account in an Asset-type group | Asset account | Project balances, not the Cost Budget tab [A2] |
| Deltek, project-owned combination | Asset | UNVERIFIED; the asset carries a project tag [C2] |
| NetSuite, Epicor | UNVERIFIED | UNVERIFIED |

SAP is the only product here that documents Carbon's case. SAP avoids the double count in two ways. It refuses to settle a statistical order or WBS element. On an investment measure with an AuC, it ignores the "statistical" value type, so "there is no duplication of the clearing" [S1]. One SAP KBA reports a conflict: a real WBS element on an `A` line does not reach the FI entry or the budget [S7]. The KBA preview gives no cause.

**2. Building an asset vs buying a named asset for a project.**

- SAP calls the second case "direct capitalization". It has no under-construction phase [S2].
- Oracle says capital assets are "being built, installed, or acquired". It routes all 3 through the project [O1].
- Dynamics 365 Internal and Cost projects can hold a fixed asset number. It is an association only, and a write-up "isn't created automatically" [M2].
- A Dynamics 365 Cost project cannot capitalize [M1]. In Oracle, a project type not enabled for capitalization gives no capitalizable cost [O1].
- This survey found no SAP document specific to a customer or overhead project that buys an asset.
- The rules decide on control, not on project type. See question 6.

**3. How do project reports show capitalized cost, commitments and budget?**

- Oracle has the clearest report: "capitalizable cost, noncapitalizable cost, expenses, budgeted cost" [O1].
- SAP compares statistical amounts with budget and commitment [S1, S3].
- Dynamics 365 Cost control shows actual, committed, remaining budget and total cost. Project statements add a WIP tab [M1].
- NetSuite's Project Cost Budget vs. Actual shows labor, expense, supplier and committed cost. This survey found no capitalized column [N1].
- No accounting or FAR rule found here requires capital spend beside expense on a project report. Vendors offer it as a control.
- After settlement, one SAP page says the project still shows the cost as statistical cost under the settlement cost element [S8]. Forum posts disagree on which reports include it [S9, S10].

**4. Place in service, splitting and late costs.**

| Topic | SAP | Oracle | Dynamics 365 |
|---|---|---|---|
| Move to asset | Settlement, type `FUL`, receiver `FXA` [S11] | Generate Asset Lines, Transfer Assets, Post Mass Additions [O3] | Eliminate to Fixed asset [M5] |
| Several assets | Percent or equivalence numbers, totalling 100% per ledger [S12, S13] | Actual Units, Current Cost, Estimated Cost, Standard Unit Cost, Spread Evenly [O1, O7] | Each phase, task or subproject can link to its own asset; that text covers the association only [M2] |
| Late cost | UNVERIFIED | Adjustment asset lines [O1] | Posts directly to profit and loss [M4] |
| Reversal | Latest settlement first, in an open period [S14] | Reverse Capitalized Asset: negative lines, the asset stays at zero value [O1] | Reverse elimination [M6] |

Mid-market products document less:

- NetSuite shows no native capital project. Users keep one CIP account per project, then make a journal entry [N2]. The NetAsset add-on selects project transactions and makes 1 or many assets [N3].
- Acumatica has an Under Construction class and Transfer Assets [A3]. Forum posts from 2024 and 2025 say that project-to-asset conversion is absent or does not work [A4, A5].
- Epicor users post invoices to a CIP account, then make an Asset Addition [E1]. This survey found no capital project concept in public sources.

**5. Charging a contract project for asset use.**

- See pattern 4 for usage rates.
- Depreciation mostly stays indirect. A Microsoft employee says that allocating it to a project "requires a system modification" [D1].
- Deltek depreciation debits combinations through an allocation code, and it can reach billing on a billable project [C3].
- SAP's depreciation run posts to CO objects assigned to the asset [S15]. SAP's event-based settlement refuses this on investment projects [S16].
- This survey found no product that derives a usage rate from depreciation.

**6. What do the rules require?**

| Fact | Treatment | Source |
|---|---|---|
| Self-built asset | Capitalize cost necessary to reach intended condition and location | ASC 360 [R1]; IAS 16 [R2] |
| Depreciation start | In-service stage (ASC); available for use (IAS 16 para 55, search excerpt only) | [R1, R2] |
| Capitalized interest | Base is average accumulated expenditure on a cash basis | ASC 835-20 [R3]; IAS 23 [R4] |
| Company keeps dedicated equipment | Topic 360, as with the Codification's data center hardware | ASC 340-40 [R5] |
| Customer controls an uninstalled good | Contract cost; revenue can equal cost under 4 conditions | ASC 606 Example 19 [R6] |
| Material usable only on that project | Fulfillment cost | ASC 340-40 [R7] |
| Special tooling or special test equipment | Direct to the contract it was bought for | FAR 31.205-40 [R8] |
| Other capital item charged in full | Needs contract coverage; DCAA reportedly questions it otherwise (secondary source, DCAA text not read) | [R9] |
| Reimbursed direct item on a cost-type contract | Title passes to the Government on vendor delivery | FAR 52.245-1 [R10] |

**CAS change:** A final rule removes and reserves CAS 404 and CAS 409, effective August 7, 2026 [R11]. It conforms them to GAAP. The rule moves 4 retained provisions to `9904.405-40(g)`. It states no dollar capitalization threshold, and it does not name CAS 414 or CAS 417. FindLaw and Cornell still show the old text. FAR 31.205-11 still cites CAS 409 [R12]. This survey found no conforming FAR change.

Costs "necessarily incurred", control transfer, contract coverage and the capitalization policy each need a judgment by the company's accountant.

## Competitor-Specific Details

### SAP S/4HANA

- **Terms**: investment measure, investment profile, direct capitalization, statistical, settlement rule, settlement profile, capitalization key, line item settlement, event-based settlement.
- **Statuses**: `CRTD`, `REL`, `TECO`, `FNBL`, `CLSD`, `DLFL` [S17]. `TECO` means work is finished and postings still run. `CLSD` stops direct postings to the WBS element.
- **Limit**: Down payments and settlements get no automatic statistical posting [S1].
- **Event-based settlement** (S/4HANA Cloud) settles each posting 100% to the AuC and does not support `PRE` [S18].

### Oracle Fusion Cloud

- **Asset type**: "Estimated" receives no cost. "As-built" does [O1].
- **Asset line**: `TransferStatus` is Pending, Rejected or Transferred. `AssetLineType` is Capital or Retirement. Each line detail holds `ExpenditureItemId` and `CIPCost` [O8].
- **Grouping**: "CIP grouping" uses All, Expenditure Category, Expenditure Type, Expenditure Organization or Expenditure Item [O7].
- **Retirement**: A "retirement adjustment asset" collects Cost of Removal and Proceeds of Sale [O1].
- **EBS only**: On a contract or indirect project, Payables posts to asset clearing. The cost can reach both Projects and Assets [O9]. This survey did not verify a Fusion equivalent.

### Microsoft Dynamics 365 Finance

- **Project types**: Investment, Cost, Internal, Fixed-price, Time and material [M1].
- **Capitalizing other types**: A "Balance" project group plus "Capitalize cost" posts to the balance sheet [M4].
- **Limits**: Investment projects cannot link to quotations or contracts [M5]. The project type locks after the first transaction [M5].
- **Maximum capitalization**: This setting is optional [M1]. This survey did not verify how it treats the excess.

### NetSuite

FAM proposes assets from transactions that post to a fixed asset account [N4]. A proposed asset takes its Project from the transaction or proposal [N5]. Project supplier cost comes from approved vendor bills with project item lines [N1]. So one bill can feed both, by inference. This survey found no control against that double count.

### Acumatica

An account decides the project effect. A project transaction exists only if the account maps to an account group [A6]. Users report the release error "Project is Required but was not specified" when a fixed asset account sits in a group [A5, A7]. This is the model closest to Carbon's visibility goal, and it shows a risk: a statistical line must not block the asset posting.

### Epicor Kinetic

One user says the WBS Phase Job is the "ONLY way" to collect project cost [E2]. Build Project Analysis rolls cost up the WBS [E3]. Advanced Project Accounting compares transactions and commitments with budgets [E4]. That source is a reseller page.

### Deltek Costpoint

An asset's ownership is an account-organization-project combination: balance sheet, project or expense [C2]. Costpoint builds Asset Master records from Purchasing, Receiving and Accounts Payable. It also tracks Contractor-Acquired Property [C4]. The `BAL` function code links a project-required account to the balance sheet, and the Project Status Report does not show that account [C5]. By inference, a reader of that report does not see the purchase there. That matches Carbon's gap.

## Recommended Approach for Carbon

The table states the rule. It is an inference from the patterns and rules above, and it needs an accountant's check in the spec.

| Project | The purchase | Project effect | Line to use |
|---|---|---|---|
| Capitalize | Is part of the built asset | Project cost in CIP, with a `projectLedger` row | Item or G/L Account |
| Contract | Is special tooling, a covered direct item, or under customer control | Direct project cost | Item or G/L Account |
| Any | Is a separate asset the company keeps | Statistical line only; cost arrives through depreciation or usage | Fixed Asset |

1. **Keep the real debit on the asset for a kept asset.** This follows SAP's direct capitalization. The current posting is correct, so do not add a `projectLedger` cost row for it. A cost row would count the money in the asset and in the project.
2. **Show the purchase on the project as a statistical line.** This follows SAP's statistical commitment and statistical actual.
   - Show it on the task and on the Costs page, in its own group, outside project cost.
   - Do not add it to billable items, burden bases, cost relief or earned value.
   - Prefer a read of the Fixed Asset lines over a new row, because that needs no posting change. `projectLedger` already holds memo rows for burden, but readers sum its rows as project cost.
3. **Separate its commitment.** Today `get_project_cost_summary` counts the line as committed until receipt. Then the amount leaves the project's figures with no trace. Move it to the statistical group, so it stays visible after receipt.
4. **Guard the project's own asset.** A Fixed Asset line can name the Under Construction asset of a Capitalize project. A live test showed that it wrote $1,000 of CIP cost and no `projectLedger` row. So project cost and CIP disagree. `chargeNumberError` now refuses this line when it has a charge number. Refuse that line and point the user to an Item or G/L Account line. An Item or G/L Account line writes both rows, as Oracle's route through the project does.
5. **Add a note to the modal, not a new accounting path.** On the Fixed Asset tab, tell the user that the cost goes to the asset and not to the project. On a Contract project, say that a covered direct item uses the Item or G/L Account tab.
6. **Treat asset use as a later phase.** Follow Oracle's nonlabor resource and Acumatica's equipment rates. Use a rate per asset and a usage entry that writes a `projectLedger` row with cost type `Machine`. `fixedAssetUsageLog` holds Units of Production input today and has no project column, so it does not cover this.
7. **Keep what already matches.**
   - Carbon's late cost debits the in-service class and raises `acquisitionCost`. That is closer to Oracle's adjustment lines than to Dynamics 365's post to profit and loss.
   - `projectLedger` rows never change at place in service, so the project keeps its total cost, as Oracle's report does.
   - One asset per `isFinalAsset` element covers splitting by structure. Oracle's split by amount is a later option.
   - An element's own cost treatment covers the expensed share by element. It does not cover a share within one line, as SAP's source structure and Oracle's transaction control do.

### Open questions for the spec

1. Resolved in `.ai/specs/2026-11-04-project-asset-purchases.md`: a statistical line does not use up the budget.
2. Is one Contractor-Acquired Property record needed? Deltek tracks it, and FAR 52.245-1 passes title on cost-type contracts. Carbon has `governmentFurnished` on a project, but its rules name no property record for an item the contractor buys.
3. Resolved in the same spec: the read covers purchase order lines only, and the Add Invoice work adds the rest.

## Sources

**How far to trust these:** A dagger (†) marks a claim seen as a search excerpt only. For S9, S10, S14 and A-series forum posts, a research tool matched the excerpt to the URL, so check them before you quote them. This survey read the CAS rule R11 and SAP page S1 directly.

**SAP documentation** (H = `https://help.sap.com/saphelp_46c/helpdata/en/`)
- S1 H`2a/f9f5e3493111d182b70000e829fbfe/content.htm`
- S2 H`8a/1a212e4e4211d182be0000e829fbfe/content.htm`
- S3 H`4f/71e156448011d189f00000e81ddfac/content.htm`
- S4 https://learning.sap.com/courses/asset-accounting-processes/maintaining-the-periodic-settlement-of-investment-wbs-elements_c6ce0b01-752d-478c-b8c0-43e259ce478c
- S5 H`fd/45afdf9d6411d189b60000e829fbbd/content.htm`
- S6 H`fd/45b1869d6411d189b60000e829fbbd/content.htm`
- S7 https://userapps.support.sap.com/sap/support/knowledge/en/3420274
- S8 H`51/5829cda44c11d189bf0000e829fbbd/content.htm`
- S11 https://help.sap.com/docs/s4hana-cloud-best-practices/period-end-closing-projects-bna-sg/maintain-settlement-rule-for-final-settlement †
- S12 https://learning.sap.com/courses/asset-accounting-year-end-closing-activities/posting-wbs-element-settlements-for-asset-under-construction-auc-only-for-one-accounting-principle-1-1 †
- S13 https://help.sap.com/docs/SAP_S4HANA_CLOUD/3e5fcf2c768746049b5627bd5a42f720/894dbc43f6d34a7aaf23d5fed6794aad.html †
- S15 https://userapps.support.sap.com/sap/support/knowledge/en/3597674
- S16 https://userapps.support.sap.com/sap/support/knowledge/en/3773861
- S17 H`ee/41f82246ee11d189470000e829fbbd/content.htm`
- S18 https://help.sap.com/docs/SAP_S4HANA_CLOUD/3e5fcf2c768746049b5627bd5a42f720/d5213bfdc97c41c49e136a52c38a975a.html †

**SAP forums**
- S9 https://archive.sap.com/discussions/thread/1118428 †
- S10 https://archive.sap.com/discussions/thread/1974105 †
- S14 https://answers.sap.com/questions/10946901/wbs-partial-settlement-reversal.html †

**Oracle documentation**
- O1 https://docs.oracle.com/en/cloud/saas/project-management/26b/oapjc/using-project-costing.pdf
- O2 https://docs.oracle.com/en/cloud/saas/financials/26a/faalm/using-assets.pdf
- O3 https://docs.oracle.com/en/cloud/saas/project-management/26a/oapjc/automatically-create-project-assets-for-item-receipts.html
- O4 https://docs.oracle.com/en/cloud/saas/project-management/25c/oapjc/automatically-create-project-assets-for-supplier-invoices.html
- O5 https://docs.oracle.com/en/cloud/saas/readiness/erp/25c/ppm25c/25C-ppm-wn-f38562.htm
- O6 https://docs.oracle.com/en/cloud/saas/project-management/25d/oapfm/expenditure-type-classes.html
- O7 https://docs.oracle.com/en/cloud/saas/project-management/26b/oapjc/capitalization-options-for-project-types.html
- O8 https://docs.oracle.com/en/cloud/saas/project-management/25d/fapap/op-projectassetlines-projectassetlineid-get.html
- O9 https://docs.oracle.com/cd/E26401_01/doc.122/e48918/T188094T188100.htm

**Microsoft documentation**
- M1 https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/overview-project-management-accounting
- M2 https://learn.microsoft.com/en-us/dynamics365/finance/fixed-assets/fixed-asset-integration
- M3 https://learn.microsoft.com/en-us/dynamics365/finance/fixed-assets/acquire-assets-procurement
- M4 https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/project-group-categories-line-properties
- M5 https://learn.microsoft.com/en-us/dynamics365/project-operations/project-accounting/project-operations-investment-project
- M6 https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-pma/eliminate-project-estimate

**Dynamics forums**
- D1 https://community.dynamics.com/forums/thread/details/?threadid=0e2541d9-9ef3-4157-8945-d31ef014c0e1
- D2 https://www.dynamicsuser.net/t/new-fixed-asset-check-box-not-enabled-for-purchase-orders-in-ax-2012/49760 (AX 2012, 2013)

**NetSuite** (N = `https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/`)
- N1 N`section_3751160832.html`
- N4 N`section_164689333704.html`
- N5 N`section_164689339824.html`
- N2 https://answers.gurussolutions.com/?p=609 (third party)
- N3 https://www.netgain.tech/blog/netsuite-fixed-asset-roll-forward-report-and-cip-process (third party)

**Acumatica**
- A1 https://help.myob.com.au/advanced/Docs/Published/UserGuide/EP_20_80_00.html
- A2 https://help.myob.com.au/advanced/Docs/Published/UserGuide/Account_Groups_GeneralInfo.html
- A3 https://help.myob.com.au/myobadvancedhelpdraft/Docs/Published/UserGuide/FA__con_Fixed_Asset_Creation_2.html
- A6 https://www.acumatica.com/blog/technical-tuesday-timecard-accounting-projects-acumatica-cloud-erp
- A4 https://community.acumatica.com/construction-120/create-fixed-asset-from-a-project-23792 (forum)
- A5 https://community.acumatica.com/financials-7/how-to-track-costs-on-a-project-for-the-eventual-capitalization-to-fixed-assets-30628 (forum)
- A7 https://community.acumatica.com/construction-120/how-to-resolve-an-issue-in-which-fixed-asset-transaction-that-cannot-be-released-because-it-requires-a-project-32116 (forum)

**Epicor** (forums and a reseller)
- E1 https://epiusers.help/t/capitalizing-fixed-assets-from-c-i-p/137262
- E2 https://epiusers.help/t/capturing-direct-gl-costs-in-project-cost-reporting/42325
- E3 https://epiusers.help/t/project-job-questions/98356
- E4 https://marketplace.platform.softwareone.com/product/epicor-advanced-project-accounting/PCP-5642-1091

**Deltek documentation**
- C1 https://help.deltek.com/Product/Costpoint/8.2/GA/BLMUSAGE.html
- C2 https://help.deltek.com/Product/Costpoint/8.0/GA/FAMASSET_FAQs.html
- C3 https://help.deltek.com/Product/Costpoint/8.0/GA/FAPFAJNL_Contents_of__the_Post_Fixed_Assets_Journal_Screen.html
- C4 https://help.deltek.com/Product/Costpoint/8.1/GA/Fixed_Assets.html
- C5 https://help.deltek.com/PRODUCT/COSTPOINT/7.1.1/GA/pjx_Function_Codes.html

**Rules**
- R1 https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/property_plant_equip/property_plant_equip_US/chapter_1_capitaliza_US/12_accounting_for_ca_US.html
- R2 https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ias16.html
- R3 https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/property_plant_equip/property_plant_equip_US/chapter_1_capitaliza_US/13_capitalized_inter_US.html
- R4 https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2026/issued/ias23.html
- R5 https://asc.understandingaccounting.org/asc/340/40/ (unofficial copy)
- R6 https://www.rsmus.com/content/dam/rsm/insights/financial-reporting/1pdf/revenue-recognition-considerations-for-the-construction-industry.pdf
- R7 https://dart.deloitte.com/USDART/home/publications/deloitte/industry/engineering-construction/materials-purchased-over-time-dise-disclosures †
- R8 https://www.acquisition.gov/far/31.205-40
- R9 https://govcontractassoc.com/direct-versus-indirect-costs/
- R10 https://www.acquisition.gov/far/52.245-1
- R11 https://www.govinfo.gov/content/pkg/FR-2026-07-08/html/2026-13764.htm
- R12 https://www.acquisition.gov/far/31.205-11
