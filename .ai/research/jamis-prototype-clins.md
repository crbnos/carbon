# Prototype CLINs Research: Best Practices Survey

## Summary

This survey asks how government contracting ERPs handle a CLIN for a hardware
or prototype deliverable. It covers how the CLIN links to the project, how a
production order collects cost, how the part ships, and how it bills. It also
asks how much training each design costs. It feeds section 10 of
`.ai/specs/2026-10-21-project-contracts.md` (Build, Deliver, invoice on the
CLIN).

All four products link the CLIN to a project billing node, and a production
order to the same node. All four also make the user choose when the order's
cost reaches the contract: as it is incurred, or when the part ships. A separate
setting holds that choice, and it is the main training cost. Carbon can derive
it from the CLIN's billing method instead. JAMIS publishes little: no public
source shows how it links a production order to a job, or how it ships and bills
a hardware CLIN.

## Competitors Surveyed

- **JAMIS Prime** — Brad's reference. A mid-market government contracting ERP
  built on Acumatica, with Acumatica's Manufacturing module. Its help wiki is
  closed to direct fetch, so most JAMIS facts come from indexed excerpts.
- **SAP S/4HANA** (Project System, engineer-to-order, PMMO) — the enterprise
  reference for project-linked production and project stock.
- **Deltek Costpoint** (Projects, Manufacturing, Materials, Billing) — the
  market leader for large defense manufacturers, with native DD250 printing.
- **Unanet GovCon** (with the AIM add-on) — the mid-market alternative that
  reviewers call simpler than Costpoint.

In this file, "billing node" means the project object that a CLIN bills from:
a WBS billing element (SAP), a project (JAMIS, Unanet), or a project with its
CLIN (Costpoint). Carbon's term is the billing element.

## Key Consensus Patterns

### 1. A CLIN maps to one billing node

- **SAP**: one sales order item links to one WBS billing element. Every WBS
  element and order below it belongs to that billing structure. Event-based
  revenue recognition requires the 1:1 link.
- **JAMIS**: "Government CLIN" is a field on the Project, which also holds the
  billing type, revenue method, funded cost, funded fee and ceilings. So one
  CLIN is about one JAMIS project. Cost collects on Direct Jobs below it.
- **Costpoint**: CLINs are set up by project (Manage CLIN Information). Most
  implementers build the project tree so that one node matches one CLIN or SLIN.
- **Unanet**: if a CLIN bills on its own invoice line, the guidance is to make
  it its own project.
- **Rationale**: funding, ceiling, billing and revenue all apply to the CLIN, so
  they need one cost scope to read.

### 2. A CLIN can name a part

- **Costpoint**: the CLIN's Item Linkage subtask links one or more parts, each
  with a unit price, a quantity ceiling, quantity sold to date and an inventory
  account. A sales order line carries the CLIN.
- **SAP**: the sales order item names the material that is delivered.
- **JAMIS**: not found. A JAMIS project carries the CLIN number, but no source
  shows it carrying an item.
- **Rationale**: a hardware CLIN is a quantity of a part at a price. The
  delivery and the invoice count units of it.

### 3. The production order charges the same node

- **SAP**: MRP plans the deliverable on the WBS element's stock. The planned
  order and the production order carry the WBS element, and the finished part
  goes into project stock (special stock Q).
- **JAMIS (Acumatica base)**: a production order has Project and Task fields.
  They post nothing unless the user ticks **Update Project** and uses the `PJ`
  order type. Neither defaults on, and Acumatica has no setting to default it.
- **Costpoint**: a manufacturing order (MO) links to a project only through its
  build-to inventory abbreviation. The abbreviation cannot change once the MO
  has charges.
- **Unanet AIM**: work orders post journal entries by the item's expense type
  and the project.
- **Rationale**: the order is where shop floor cost is recorded. The project
  needs that cost for billing, funding and revenue.

### 4. One setting decides when the order's cost reaches the contract

Every product has the same two outcomes and makes the user pick one in a
separate setting.

| Product | Cost as incurred | Cost when the part ships | Where the user sets it |
|---|---|---|---|
| SAP | Non-valuated project stock: the order settles to the WBS element | Valuated project stock: the order settles to stock; the goods issue posts the cost | One flag per project definition |
| Costpoint | Build-to abbreviation type Expensed | Build-to abbreviation type Asset | The inventory abbreviation |
| JAMIS (Acumatica base) | `PJ` order type with Update Project: WIP shows on the project as material and labor post | A plain order: the part goes to stock, then an Inventory Issue charges the project | The order type and a checkbox on each order |
| Unanet AIM | The item's expense type | The item's expense type | The item |

- **Rationale**: cost-type CLINs bill cost as incurred, so cost must reach the
  project at once. A delivered fixed price unit is cost of goods sold when it
  ships, so cost waits in stock.
- SAP's own "Decision Help" page for this one choice lists 9 constraints.
  Acumatica community threads show users who missed the Update Project checkbox
  and saw no project cost.

### 5. The fixed price hardware CLIN bills at delivery or at a milestone

- **Costpoint**: "When a finished good is shipped or delivered, you must
  produce a delivery invoice." The delivery invoice uses the CLIN unit price and
  liquidates progress payments. A sales order invoice defaults its quantity to
  shipped less invoiced. Milestone percent bills are a separate screen.
- **SAP**: a milestone billing plan date stays blocked until a project milestone
  is confirmed. A goods issue does not release it. To bill on delivery, SAP uses
  a delivery-related item category instead.
- **JAMIS**: the Fixed Amount Based revenue method follows "a fixed milestone
  schedule". No source ties a delivery to a JAMIS invoice.
- **Rationale**: the customer pays for an accepted unit. The receiving report is
  the evidence of acceptance.

### 6. Cost-type CLINs bill material as incurred

- **SAP**: resource-related billing (DIP profile) builds billing lines from
  actual cost line items, material and labor included.
- **Costpoint**: project costs, expensed material included, flow to Open
  Billing Detail as they post. Standard bills price them by formula.
- **JAMIS**: project billing rolls job cost transactions into summaries by labor
  category or cost element.
- **Rationale**: on a T&M or cost-plus CLIN, the contract pays for cost, not for
  a delivered unit.

## Answers to Research Questions

1. **How does a CLIN link to the cost-collecting entity for a hardware
   deliverable?** — Through a billing node. The CLIN maps to one billing node,
   and the production order charges the same node or one below it (SAP,
   Costpoint, JAMIS through Acumatica). No product links the production order
   to the CLIN directly; Costpoint links it through an inventory abbreviation.
2. **How is material handled on cost-type contracts?** — Two models in every
   product: charged to the project at once (SAP non-valuated, Costpoint
   Expensed, Acumatica direct issue) or held as project stock and charged at
   issue (SAP valuated, Costpoint Asset, Acumatica project stock). Acumatica
   project stock "cannot be issued for another project" unless the project
   allows free stock.
3. **How is a hardware CLIN delivered and documented?** — Costpoint is the only
   product with native DD250 support: it prints DD250 packing slips and invoices
   and writes WAWF (iRAPT) flat files, but no EDI. SAP has native IUID but no
   DD250 or WAWF; a partner add-on (Cognitus) claims both. JAMIS: not found.
4. **Does delivery trigger billing on a fixed price CLIN?** — In Costpoint, yes:
   the delivery invoice follows the shipment and liquidates progress payments.
   In SAP, no: a milestone confirmation releases the billing date. JAMIS: not
   found.
5. **How is revenue recognized for a fixed price hardware CLIN?** — SAP:
   completed contract (method 9) or cost-based percent complete; SAP has no
   separate "at delivery" method for a project line. Costpoint: unit revenue
   from unit usage by project, CLIN and item. JAMIS: Fixed Amount Based, on a
   milestone schedule.
6. **What does the user do, and what training does it cost?** — Every product
   is described as hard to set up:
   - SAP's project finance course runs 23.5 hours.
   - A review site estimates 2 to 3 months before a new Costpoint user is
     productive.
   - Employers hire "JAMIS Prime Project Setup Specialists" to turn contract
     awards into the WBS.

   JAMIS answers with a workflow engine that guides users to "the next logical
   steps" (8.0), merged planning and main forms (8.0 Update 7), and in-product
   videos (9.0 Update 6). Reviewers still call the JAMIS menu "just a list of
   nouns".

Not answered: how JAMIS maps a production order to a Direct Job, and how JAMIS
ships and bills a hardware CLIN. Only a JAMIS demo or a help-site login can
answer them.

## Competitor-Specific Details

### JAMIS Prime

- **WBS**: Contract → Invoice → Project → Direct Job. "The job is the only place
  in the JAMIS Prime database that collects cost." Each transaction charges a
  job and a cost element. Indirect jobs collect indirect cost.
- **Project fields**: Government CLIN, Billing Type (Cost Plus by default, T&M,
  Fixed Price), Revenue Method (Cost Based, T&M Based, Fixed Amount Based),
  Ceiling Amount, Fee Ceiling Amount, Funded Cost Amount, Funded Fee Amount.
  Some fields change only through a Change Order.
- **Manufacturing** comes from Acumatica. The production order takes a project
  and task. Labor posts to the order or to the project, not easily to both;
  labor transactions began to reference the project in 2024 R2. Project-specific
  inventory in production orders arrived in 2024 R2. A partner reports a
  conflict between manufacturing WIP and percent-complete project revenue,
  solved with contra-WIP accounts and monthly allocations.
- **Delivery**: no DD250, WAWF, EDI or IUID feature found. Acumatica has no
  native EDI.
- **Usability**: a Software Advice ease-of-use score of 4.6. Reviewers report an
  expensive training program, an implementation "more complicated than
  expected", and project setup that "isn't fully there yet".

### SAP S/4HANA

- The account assignment category on the sales order item sets the special
  stock (E sales order, Q project) and the cost object.
- Valuated project stock: the production order is a full cost collector with
  WIP and variances; the WBS element sees statistical stock cost. Non-valuated:
  "meaningful cost object accounting is only possible at WBS element level".
- Delivery from project: an SD delivery against the sales order item, or
  Delivery from Project (CNS0) against network reservations.
- Event-based revenue recognition posts on time confirmation, goods movements,
  billing and completion. The S/4HANA Cloud engineer-to-order scope item (6GD)
  presets valuated project stock and posts cost to the project in real time.

### Deltek Costpoint

- The CLIN's Item Linkage holds part, revision, sales and inventory account,
  pricing basis, automatic monthly billing quantity, quantity not to exceed,
  quantity sold to date.
- The MO collects labor (timesheet lines of type M), issued components and
  subcontract cost. It can split its build quantity across inventory
  abbreviations of several projects.
- Native: CLIN on the sales order line, a "DD250 invoice" project default,
  DD250 packing slips and invoices, UID-required flags with a warning, and
  WAWF (iRAPT) flat files from sales order invoices and from Billing.
- Revenue: cost-to-cost formulas, unit revenue by project, CLIN and item, and a
  sales order revenue method (Shipment/Sales, Deferred Revenue and 4 others).

### Unanet GovCon

- Billing type per project or task: TM, FP, CP, NB. A CLIN invoiced on its own
  becomes its own project.
- Manufacturing is the AIM add-on (bills of materials, work orders, kitting,
  backflush). No DD250, WAWF or UID feature found.

## Recommended Approach for Carbon

1. **Keep the CLIN mapped to one billing element** (consensus pattern 1). Carbon
   already does this. It matches SAP's one item to one billing element.
2. **Let a project contract line name a part** (pattern 2, Costpoint's Item
   Linkage). Quantity and unit price on a Fixed Price part line follow
   Costpoint's CLIN item fields.
3. **Charge the job to a task under the CLIN's billing element** (pattern 3).
   Section 10's `job.customerContractLineId` adds the direct link that Costpoint
   lacks, so the CLIN can show its jobs.
4. **Derive the cost timing from the billing method, never from a setting**
   (pattern 4). T&M and Cost Plus: consume to project, as SAP non-valuated and
   Costpoint Expensed. Fixed Price: receive to project stock, as SAP valuated
   and Costpoint Asset. Every competitor makes the user choose this, and
   Acumatica does not even default it. Deriving it is the largest training
   saving section 10 can offer (spec D28, D29, D30, D33).
   **Later (Brad, 2026-10-22):** Carbon shows project stock only on a project
   with `projectStock` set, so the Fixed Price branch was dropped. Every
   prototype job consumes to the project, as SAP non-valuated stock and
   Costpoint Expensed inventory do. The choice is still never the user's.
5. **Date the Fixed Price billing event from the delivery** (pattern 5,
   Costpoint's delivery invoice; spec D34). Carbon's contract financing already
   applies liquidation to a delivery invoice (`contract-financing.md`), as
   Costpoint's delivery invoice does.
6. **Print the receiving report from the shipment** (Costpoint's DD250 print).
   This puts Carbon ahead of JAMIS and base SAP. A WAWF flat file, as Costpoint
   writes, and IUID data, as SAP holds, are follow-ups.
7. **Show the CLIN's next step** (JAMIS 8.0's workflow engine). The CLIN shows
   one primary action by state: Build while no job exists, Deliver while a job
   has completed units not delivered, then nothing. This replaces training with
   a prompt.
8. **Accept the revenue gap for now.** Fixed Price with project stock and
   Percent Complete moves revenue when the part ships, because cost reaches the
   project ledger at delivery. That is close to Costpoint's unit revenue. An
   explicit "at delivery" method is not needed for section 10.

## Sources

JAMIS Prime (help pages are search excerpts; the hosts refuse direct fetch):

- https://primehelp.jamisprime.com/(W(2))/Wiki/Print.aspx?pageid=75cceed8-0f8d-4bff-a06e-a4959fff3972
- https://help80.jamisprime.com/Wiki/ShowWiki.aspx?pageid=844ef9d0-5e57-460a-9ae2-5fc6c2497376
- https://help80.jamisprime.com/Wiki/ShowWiki.aspx?pageid=d20c4202-2ea5-48aa-b05e-5f0726e317b9
- https://faqhelp.jamisprime.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_FormReference&PageID=79bd389e-4380-4133-9265-40a93d5143a4
- https://faqhelp.jamisprime.com/Wiki/Print.aspx?pageid=86efdfb8-6cef-4644-b5de-3cf1911ff7ac
- https://faqhelp.jamisprime.com/Wiki/Show.aspx?pageid=fd6be46f-a0c4-4d67-b93d-5701d837b397&HideScript=On
- https://help80.jamisprime.com/Wiki/ShowWiki.aspx?pageid=9a09afb3-6745-4aa2-b375-c49ab6306e4e
- https://jamis.com/contract-and-subcontract-management/
- https://jamis.com/production-costing-w-production-orders-understanding-true-profitability-for-govcon-manufacturers/
- https://jamis.com/billing-and-invoicing-8/
- https://jamis.com/solutions/compliance/
- https://jamis.com/jamis-prime-erp-version-8-realease/
- https://jamis.com/jamis-prime-8-0-update-7-is-available/
- https://cdn.asp.events/CLIENT_NASBA_287596D2_5056_B733_49DFF69B632BDF66/sites/LearningMarket/media/libraries/pdf-brochure/85637-JAMIS-Product-Guide-2023.pdf
- https://www.executivebiz.com/articles/jeff-noolas-and-joe-satlin-of-jamis-discuss-new-manufacturing-solution-and-acumatica-partnership
- https://community.acumatica.com/jamis-prime-user-discussions-301
- https://community.acumatica.com/jamis-prime-user-discussions-301/one-of-the-most-underutilized-personalizations-side-panels-in-jamis-prime-31594
- https://softwareconnect.com/reviews/jamis-prime-erp/
- https://www.g2.com/products/jamis-prime-erp/reviews?qs=pros-and-cons
- https://www.capterra.com/p/196721/JAMIS-Prime-ERP/reviews/
- https://www.jobleads.com/us/job/jamis-prime-project-setup-specialist--united-states--e5788ea035bb6586ac15804bc8ccea389

Acumatica (the JAMIS base):

- https://community.acumatica.com/manufacturing-89/project-manufacturing-setup-no-transactions-generated-17483
- https://community.acumatica.com/manufacturing-89/production-orders-using-material-wizard-to-release-materials-selecting-project-is-not-a-option-21673
- https://community.acumatica.com/manufacturing-89/production-order-maintenance-references-project-update-project-31100
- https://community.acumatica.com/manufacturing-89/tracking-material-and-production-labor-costs-in-projects-in-acumatica-29656
- https://community.acumatica.com/manufacturing-89/engineer-to-order-manufacturing-projects-and-percentage-of-completion-accounting-32860
- https://help.acumatica.com/(W(14))/Wiki/ShowWiki.aspx?pageid=c88fde12-24c2-4b9b-af43-25854318d4f9
- https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=663ebfe5-9cfd-4fbb-997e-c6041759d473
- https://community.acumatica.com/construction-120/2025r1-inventory-source-free-stock-and-project-stock-when-tracking-by-location-in-projects-32467
- https://en-gb.acumatica.com/blog/acumatica-2024-r2-manufacturers/
- https://openuni.acumatica.com/wp-content/uploads/2017/08/EU_AccountingForProjects_2021R2-1.pdf
- https://www.acumatica.com/blog/technical-tuesday-project-accounting-revenue-recognition/
- https://www.dckap.com/blog/acumatica-edi-integration/

SAP S/4HANA:

- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/assigning-accounts-for-sales-documents
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/6618c353b677b44ce10000000a174cb4.html
- https://blog.sap-press.com/principles-of-event-based-revenue-recognition-ebrr-in-sap-s4hana
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/4dd8cb7b1c484b4b93af84d00f60fdb8/c6ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/4dd8cb7b1c484b4b93af84d00f60fdb8/cfceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/4dd8cb7b1c484b4b93af84d00f60fdb8/c0ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/21aead0c98bd4755abdacd91c99e3393/ac07b753128eb44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/4032610758dc437089f0c28320eec93f/af08789e7a6842f68acb056a0bfede9a.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/4dd8cb7b1c484b4b93af84d00f60fdb8/05cfb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/ed84b70c199d4470ae2e5ccb93b2e45b/10aab6531de6b64ce10000000a174cb4.html
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/describing-billing-methods-and-controls
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-resource-related-billing
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/performing-results-analysis
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f63dd39a28bb4b90adbf9e608aff58ea/e258eb07300f484faa9747c9c1276de4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f63dd39a28bb4b90adbf9e608aff58ea/5f681cdcd0104d278d483d51ed9d4313.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25a41481f62e469ba0e61015a0d39d20/96d813c621b240588cdc855dfb61fbec.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/085edb30fb3d413da552832f3d5c01c0/b48e5ad409cc497681fb39b5e666be46.html
- https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana
- https://cognitus.com/products/gov-con/aerospace-defense/
- https://piee.eb.mil/cms/docs/EDI/EDIGuide-AppendixN(856_ReceivingReport_EnergyRR_4010).pdf

Deltek Costpoint and Unanet:

- https://help.deltek.com/Product/Costpoint/8.2/GA/PJMCLIN.html
- https://help.deltek.com/product/Costpoint/8.1/GA/pjx_Project_Levels_and_Data.html
- https://costpoint.asrcfederal.com/cpweb/helpfiles/costpoint/PJMCLIN_Item_Linkage_Subtask.html
- https://info.redstonegci.com/blog/dcaa-accounting-system-compliance-with-deltek-costpoint
- https://help.deltek.com/Product/Costpoint/8.2/GA/blx_Manage_Project_iRAPT_Information_Screen.html
- https://sc3.thinapps.net/cpweb/helpfiles/costpoint/PCMMOMNT_ALLOCATIONS.htm
- https://help.deltek.com/product/costpoint/8.0/ga/PCMMOMNT.htm
- https://help.deltek.com/Product/Costpoint/8.1/GA/INX_Apply_Burden_Rates_to_Inventory.html
- https://help.deltek.com/product/costpoint/8.0/ga/inx_inventory_projects_and_abbreviations.htm
- https://info.redstonegci.com/blog/what-accountants-should-know-about-the-deltek-costpoint-inventory-module
- https://help.deltek.com/PRODUCT/COSTPOINT/7.1.1/GA/OEQSALES_SALES_ORDER_LINES.htm
- https://help.deltek.com/product/costpoint/8.0/ga/OEMPROJ.htm
- https://help.deltek.com/Product/Costpoint/8.1/GA/OER250I.html
- https://help.deltek.com/Product/Costpoint/8.1/GA/OEPWAWF.html
- https://help.deltek.com/Product/Costpoint/8.2/GA/blx_Invoicing_Receipt_Acceptance_and_Property_Transfer.html
- https://help.deltek.com/product/Costpoint/8.0/GA/blx_Delivery_Invoices.html
- https://help.deltek.com/product/Costpoint/8.1/GA/blx_Progress_Payments_and_Delivery_Invoices.html
- https://help.deltek.com/product/Costpoint/8.0/GA/BLMMPCB.html
- https://help.deltek.com/product/Costpoint/8.1/GA/BLMUSAGE_Set_Up_Unit_Billing_and_Revenue.html
- https://help.deltek.com/Product/Costpoint/7.1.1/GA/Billing.html
- https://et.norc.org/cpweb/helpfiles/costpoint/pjx_Unit_Revenue_Only.html
- https://softabase.com/software/erp/deltek-costpoint
- https://www.peerspot.com/products/deltek-costpoint-pros-and-cons
- https://unanetuniversitycontent.unanet.com/uu_content/GC%20Setting%20Up%20Contracts%20and%20Projects/GC_SettingUpContractsandProjects_FINAL.pdf
- https://unanet.com/erp-for-govcon/project-based-inventory-and-manufacturing
- https://info.redstonegci.com/blog/what-is-the-unanet-asset-inventory-and-manufacturing-aim-add-on
- https://www.diener.org/deltek-costpoint-vs-unanet-thoughts-from-a-cpa-firm/
