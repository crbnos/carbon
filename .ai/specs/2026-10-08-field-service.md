# Field Service: service orders on serials in stock and in the field

> Status: Phases A and B implemented (2026-10-09, plans `.ai/plans/2026-10-09-field-service-phase-a.md` and `.ai/plans/2026-10-09-field-service-phase-b.md`); browser verification of both is still due. Phases C and D are planned. Every open question is resolved (Q1 answered 2026-10-08).
> Author: Brad (with Claude)
> Date: 2026-10-08
> Research: `.ai/research/field-service.md` (SAP S/4HANA Service and FSM, D365 Field Service, Business Central, IFS, Salesforce Field Service, Epicor) and `.ai/research/serial-service-cost-treatment.md` (capitalize or expense)
> Builds on:
> - `.ai/specs/2026-10-03-projects.md`: labor categories and `projectLedger` (Phase 1a), part links and *Build from part* (Phase 1b), and *Service projects* (shipped with Phase A here)
> - the RMA module (`20260908142501_returns-module.sql`, `.ai/specs/2026-08-07-rma-module.md`)
> - contracts on main (`20261006221301_contracts.sql`)
> - the per-serial cost layer (`20261006220601_serial-cost-layer.sql`)

## TLDR

A **service order** is work on one existing serial, the **subject**. It has three types:

| Type | The subject | Where the work happens | Cost |
|---|---|---|---|
| **Field Visit** | a shipped serial (status `Consumed`) | at the customer's site | Expensed: warranty, contract or billable |
| **Depot Repair** | a shipped serial, returned on an RMA line with disposition `Repair` | in the company's shop | Expensed: warranty, contract or billable |
| **Refurbishment** | a serial the company owns, in stock | in the company's shop | Capitalized into the serial's cost, capped at its sale price |

A shipped serialized unit becomes a **customer asset** at shipment. The customer asset records the customer, the site, the ship date and the labor and parts warranty end dates. A unit sold before Carbon can be registered by hand.

An order has one or more **visits**. A visit has a technician, a planned window, a status and a signature. The visits drive the order's status.

An order owns a **work tree**: a project of type Service (projects spec, *Service projects*). For an engine rebuild, the tree is Engine → Cylinders → Boring, and Transmission. The order builds it from the subject serial's build history, from the item's make method, or from a service template. Each node can link the part it stands for.

A technician charges any node:
- **Time**, as timesheet entries;
- **Parts**, issued from any storage unit, including a van;
- **Expenses**, as expense entries.

Carbon decides each charge's **coverage** when it posts:
1. **Warranty**, if the service date is within the asset's labor or parts warranty, or within the warranty of the component the node links.
2. Else **Contract**, if the order names a covering contract.
3. Else **Billable**.

Each charge becomes a billable item. Covered items stay on the invoice at zero price. A node can have a fixed price for its whole subtree.

A part issued to a node is **installed** in the customer's unit, with its own parts warranty. So the customer asset builds a service history per component.

**Accounting:**
- **Customer units:** warranty work is expensed to Warranty Expense (Brad, 2026-10-08). Billable work goes to cost of goods sold. Contract work goes to the contract's project account.
- **Refurbishment:** labor and parts collect in WIP against the order. At completion they move into the serial's own cost layer. If the new cost exceeds the item's sale price (or an override), the excess is written down.

**Technicians** work in the ERP on a phone, not the MES (Brad, 2026-10-07). They use a My Visits page and a visit page with status buttons, time, parts, notes, photos and a signature.

**Depot Repair** keeps the customer's unit out of company stock. The RMA receipt and the return shipment of a `Repair` line write no stock ledger and no value. The same serial goes back to the customer.

### Who uses what

Modules follow job roles (Brad 2026-10-08). The work tree, the ledger and the posting code are shared with Projects, but each role works in its own module.

| Role | Daily work | Module |
|---|---|---|
| Service manager, dispatcher | Service orders, visit scheduling, warranty, the installed base | **Service** |
| Field technician | Today's visits on a phone: time, parts, photos, signature | **Service** (My Visits) |
| Depot or repair technician | Shop repairs and refurbishments | **Service** |
| Customer service | RMAs, contracts, warranty and order lookups | **Sales**, with `service_view` |
| Program or project manager, engineer | Requirements, design, budgets, R&D and contract cost | **Projects** |
| Accountant | Invoices, warranty expense | **Accounting** |

- A Service user never sees the word "project". The order's Service project is an implementation detail; the Projects module never lists it.
- Depot repair is a handoff between roles. Customer service sets the RMA disposition to Repair in Sales. The shop works the resulting order in Service.
- My Timesheet is personal. A technician's visit hours show in the same week as any project hours.

## Problem Statement

Carbon cannot service a unit.

- **No repair of a shipped unit.**
  - An RMA settles only by credit, replacement, or by shipping the unit back unchanged.
  - The `disposition` enum has `Repair`, but `salesReturnDispositionType` comments it out.
  - A `Rework` disposition flips a status and creates no work.
- **No refurbishment of a unit in stock.**
  - A job always outputs a new `trackedEntity` (`sync_insert_job_make_method`), so refurbishing a serial gives it a new identity.
  - No code adds cost to one serial.
- **No installed base.**
  - Finding who has serial X means joining `trackedEntity.attributes->>'Shipment'` to `shipment.customerId` (`getShippedTrackedEntitiesForCustomer`), and it needs an item.
  - Nothing records the site or the warranty.
- **No warranty.** "Warranty" is only a return reason label.
- **No field visit.**
  - `maintenanceDispatch` serves the company's own work centers only.
  - There is no technician schedule, no signature capture and no phone-friendly ERP page.
- **A returned unit enters stock value.** The RMA receipt values every returned serial at its outbound cost and counts it as on-hand. It does this even when the company will repair the unit and send it back.

## Proposed Solution

### Concepts

| Term | Meaning |
|---|---|
| **Customer asset** | One row per shipped serial (`customerAsset`), keyed to its `trackedEntity`. Holds the customer, the site (`customerLocationId`), the ship date and the labor and parts warranty end dates. |
| **Warranty months** | Two fields on the item's sales settings (`itemUnitSalePrice`): labor and parts. They set the asset's end dates at shipment. |
| **Service order** | Work on one subject serial: type, customer, site, problem, priority, status, coverage contract, and its own Service project. Readable id `SVC000123`. |
| **Subject** | The serial the order works on: a customer asset (Field Visit, Depot Repair) or a stock serial (Refurbishment). |
| **Visit** | One trip or work session: technician, planned window, status, actual arrival and end, notes, signature. |
| **Work tree** | The order's Service project. Its elements are the **nodes** (`SVC000123-4`). A node can link an item and a serial. |
| **Charge** | A timesheet entry, a part issue or an expense entry on a node. Each has a **coverage**: Warranty, Contract, Billable, or Capitalized (Refurbishment). |
| **Billable item** | The billing row of a charge (`projectBillableItem`): quantity, unit price, status. |
| **Component** | A part installed in a customer asset (`customerAssetComponent`): item, serial, install date, parts warranty end, removal. |
| **Service template** | A template project of type Service, for example *Engine rebuild*. |
| **Coverage contract** | An Active `customerContract` of the customer, chosen on the order. It covers the charges that warranty does not. |
| **Sale price cap** | For a Refurbishment, the serial's new cost may not exceed the item's `unitSalePrice`, or the order's "expected selling price" override. The excess is written down. |

### Lifecycle

`serviceOrderStatus`: **Draft → Scheduled → In Progress → Completed → Closed**, plus **On Hold** and **Cancelled**.

| Status | Meaning | Set by |
|---|---|---|
| Draft | Created, no visit planned | creation |
| Scheduled | At least one visit is Scheduled, none started | adding a visit |
| In Progress | A visit is Traveling or On Site, or a visit is Completed and the work is not done | a visit status change |
| On Hold | Waiting (parts, customer approval) | a user |
| Completed | The work is done. Refurbishment: the cost is capitalized. Depot Repair: the unit is ready to ship back. | the last visit's **Work complete**, or **Complete** on a shop order |
| Closed | Invoiced, or nothing to invoice. Depot Repair: the unit has shipped back. | invoice creation, or **Close** |
| Cancelled | No work, or the work is reversed | a user, only while no charge is posted |

`serviceVisitStatus`: **Scheduled → Traveling → On Site → Completed**, plus **Cancelled**.
- Completing a visit asks **Work complete?**
  - Yes: the order goes to Completed.
  - No: the order stays In Progress and needs another visit.

Depot Repair and Refurbishment orders work in the shop. They can have visits (one per work session) or none. A user completes them with **Complete**.

### Customer assets

- **At shipment.** `post-shipment` creates one `customerAsset` per serial on a posted sales shipment (`trackedEntity` status `Consumed`):
  - customer from `shipment.customerId`;
  - site: the sales order's `customerLocationId`, or `salesOrderShipment.customerLocationId` when the order is a drop shipment (the rule of `orderShipToCustomerLocationId` in the `convert` server function);
  - `shippedDate` = the posting date;
  - `laborWarrantyEndDate` / `partsWarrantyEndDate` = the posting date + the item's warranty months, or null.
- **On re-shipment.** A unit can ship again: a Return to Customer, or a new sale after a return for credit. The shipment updates the existing asset with the new customer, site and ship date. The warranty dates reset only on a new sale.
- **A return for credit** (any disposition other than Repair) marks the asset **Returned**, because the company owns the unit again.
- **Manual registration** for a unit sold before Carbon:
  1. Pick the item, type the serial, the customer, the site and the ship date.
  2. Carbon creates a `trackedEntity` with status `Consumed` and the asset.
- **Customer page.** A new **Assets** tab lists the customer's assets with item, serial, site, ship date, warranty status and open orders. It shows to users with `service_view`. The service manager owns the installed base, so asset edits need `update: service`.
- **Asset page.** Shows the warranty, the shipment, the RMA links and the service history:
  - by order: each order with its tree and its cost;
  - by component: hours, parts, cost and the last service date per component, across orders. The page groups the nodes of the asset's orders by their linked serial, else by their linked item.

### Components

`customerAssetComponent` records what is installed in a customer asset.
- **Install.** A part issued to a node of a Field Visit or Depot Repair order is installed in the order's asset. Carbon writes one component row with these values:
  - the item and serial;
  - the node and the order;
  - `installedDate` = the posting date;
  - `partsWarrantyEndDate` = the installed date + the installed item's `partsWarrantyMonths`, or null.
- **Replace.** If the node links an installed component (its serial), the issue also sets that component's `removedDate` and `removedByServiceOrderId`.
- **Genealogy.** The issue writes a `trackedActivity` of type `Service`, with the issued serial as input and the asset's serial as output. So a later *Build from part* on the asset's serial shows the replacement.
- **Return of the removed part** (a core return) is out of scope. The removed component only leaves the as-built record.

### Coverage

When a charge posts on a node, `resolveCoverage(charge, asset, component, order)` decides its coverage:

1. **Warranty**, if one of these is true:
   - it is time and the service date ≤ the asset's `laborWarrantyEndDate`;
   - it is a part and the service date ≤ the asset's `partsWarrantyEndDate`;
   - it is a part and the node links an installed component whose `partsWarrantyEndDate` ≥ the service date. A replacement part that fails inside its own warranty is replaced under warranty.

   Expenses are never covered by warranty.
2. Else **Contract**, if the order has a `customerContractId`.
3. Else **Billable**.

- A user can change a charge's coverage, with a reason.
- Every Refurbishment charge has coverage Capitalized.
- The order header shows a **Warranty** badge (labor and parts, with the end dates) and the coverage contract.
- When the customer has exactly one Active contract, Carbon proposes it as the coverage contract, and the user confirms it.

### Accounting

The order's Service project has the treatment **By Coverage**, so the existing project posting functions post every charge. Each charge writes its journal, its `projectLedger` row and its billable item in one transaction.

| Charge | Field Visit / Depot Repair (customer unit) | Refurbishment (company unit) |
|---|---|---|
| **Time** (`post-timesheet`): hours × the technician's labor category cost rate | Dr coverage account / Cr `laborAbsorptionAccount` | Dr `workInProgressAccount` / Cr `laborAbsorptionAccount` |
| **Part** (`post-project-issue`): issued at FIFO cost (`calculateCOGS`) | Dr coverage account / Cr inventory | Dr `workInProgressAccount` / Cr inventory |
| **Expense** (`post-project-expense`): the entered amount | Dr coverage account / Cr `goodsReceivedNotInvoicedAccount` (accrued, as an expense without an invoice) | Dr `workInProgressAccount` / Cr `goodsReceivedNotInvoicedAccount` |

The coverage account for a customer unit:
- **Warranty**: `accountDefault.warrantyExpenseAccount` (new; seeded to a new account `6120 Warranty Expense`).
- **Contract**:
  - If the contract has a `projectId`: that project's posting account (`resolveProjectPostingAccount`). The Service project names it as `parentProjectId`. Usually an Expense project whose account is cost of services.
  - Otherwise: `costOfGoodsSoldAccount`.
- **Billable**: `costOfGoodsSoldAccount`, as service make-to-order jobs do.

Every charge's journal carries the Customer, Project and Project Element dimensions.

**Refurbishment completion**, in one transaction:
1. Sum the order's WIP: the `projectLedger` amounts of the order's Service project with coverage Capitalized.
2. **Make sure the serial has its own layer.** The serial may have no open stamped `costLedger` layer. Then split 1 unit from the oldest open unstamped layer of the item:
   - decrease that layer's `remainingQuantity` by 1;
   - insert a stamped layer of quantity 1 at the same unit cost.
   This changes no value, so no journal is posted. The oldest layer is the one `calculateCOGS` would take for this serial anyway.
3. Apply the cost by costing method:
   - **FIFO / LIFO:** insert a child row on the serial's layer: `costLedgerType 'Revaluation'`, `adjustment: true`, `appliesToCostLedgerId`, `trackedEntityId`, quantity 1, `cost` = the WIP sum. Post Dr inventory / Cr WIP.
   - **Average:** post Dr inventory / Cr WIP. Re-average `itemCost.unitCost` = (on-hand × unit cost + WIP sum) ÷ on-hand. The order page states that Average spreads the cost over every unit of the item.
   - **Standard:** post Dr `materialVarianceAccount` / Cr WIP. The unit stays at standard.
4. **Abnormal rework.** If the order is flagged **Abnormal rework**, skip step 3. Post Dr `materialVarianceAccount` / Cr WIP.
5. **Sale price cap** (FIFO / LIFO only):
   1. The cap is the order's `expectedSellingPrice`, else the item's `itemUnitSalePrice.unitSalePrice` (converted to the item's inventory unit).
   2. If the serial's new unit cost (layer + children) exceeds the cap, insert a negative child row for the excess. Post Dr `inventoryAdjustmentVarianceAccount` / Cr inventory.
   3. If there is no cap, skip the check and show a warning on the order. Selling costs are not subtracted in v1.
6. Set the serial's status back to `Available`. Write a `trackedActivity` of type `Service` with the order id.

**A refurbishment never changes the serial's item.** An upgrade to a new revision (a different item row in Carbon) is out of scope for v1.

### Depot Repair through the RMA

1. On an RMA line for a serialized item, the user sets the disposition **Repair** before receipt. Before receipt a line takes Pending or Repair only, because Repair decides how the receipt posts. After receipt, a change to or from Repair is refused (decision 43).
2. Un-comment `Repair` in `salesReturnDispositionType` (`sales.models.ts:1258`).
3. **`post-receipt`, case "Sales Return Order", for a `Repair` line:**
   - Write no `itemLedger` row, no `costLedger` row and no journal.
   - Keep the `trackedEntity` status `Consumed`. The unit stays the customer's.
   - Write the `Return Receipt` activity with an `At Depot` attribute.
   - Create one Depot Repair service order per received serial: the RMA's customer, site and contact, and the receiving location. The coverage contract is the customer's only Active contract, because the RMA has no contract column. Link it with `serviceOrder.salesReturnOrderLineId` (decision 43).
   - A serial with no customer asset gets one, with source Manual (decision 45).
4. The shop works the order. Parts and labor post by coverage, as for a field visit.
5. **Ship back.** When the order is Completed (or Closed after its invoice), the RMA's return shipment ships the serial:
   - For a `Repair` line, `post-shipment` writes no `itemLedger`, no COGS and no journal.
   - It writes the `Return Shipment` activity and clears `At Depot`.
   - The asset's site and ship date update. The order goes to Closed after invoicing.
6. An RMA line with disposition `Repair` cannot get a credit memo or a replacement order (decision 47). Before receipt, change the disposition. After receipt, void the receipt first.
7. **Void.** A receipt void cancels the line's Depot Repair orders and sets their assets back In Service. It is refused while an order has a charge that stands (decision 46). A shipment void sets the asset back At Depot.

### Parts

- **Issue material** on a node picks: item, quantity, storage unit (default the technician's van, below), and the serial for tracked items. When the node links a part, its bill of materials comes first in the item list.
- It posts through `post-project-issue` (Issue to Project in the projects spec), with the charge's coverage. The ledger row is a Negative Adjmt. of `documentType 'Project Issue'`.
- It refuses negative stock.
- On a customer unit, it installs the part (see *Components*).
- **Return** reverses an issue at its original cost. It also deletes the component row the issue wrote, or restores the replaced component.
- **Van stock:** a technician's default storage unit (`employeeJob.defaultStorageUnitId`, new). Any storage unit can be a van.

### Labor and time

- On a visit, the technician picks a node, then taps **Start work** and **Stop work**, or types hours.
- Each time block is a `timesheetEntry` on the node, with the visit (`serviceVisitId`), the hours and the employee's labor category (`employeeJob.laborCategoryId`).
- Service time posts at **Stop work** or **Add time**, through `post-timesheet`. It does not wait for a weekly submit, and `timesheetApprovalRequired` does not apply: the visit and the customer's signature are its approval.
- A correction posts a reversal and a replacement with a reason, as for any timesheet entry.
- The technician's My Timesheet week shows these entries with the project entries.

### Invoicing

- **Create invoice** on a Completed Field Visit or Depot Repair order makes one Draft `salesInvoice` from the order's Unbilled billable items. It follows `create-contract-invoices`: sequence, opportunity, header, `salesInvoiceShipment` with the site, then lines.
- The invoice follows the tree. Each top-level node is a heading line, and its billable items follow it, in tree order.
- Each billable item is one invoice line of type `Service`. The projects spec prices them:
  - time: hours × the sale price of `companySettings.serviceLaborItemId`;
  - a part: quantity × the item's sale price;
  - an expense: the amount;
  - covered items: 0, with "Covered by warranty" or "Covered by contract CON000012".
- A **fixed-price node** gives one line at its price. Its subtree's items show at 0 with "Included in fixed price".
- **Invoice detail** on the order chooses **Itemized** (the default) or **By node**, which prints one line per top-level node with its total.
- Parts go on the invoice as `Service` lines because the stock already left at issue.
- **No second stock relief.** `post-sales-invoice` relieves stock and posts COGS for a line of an Inventory-tracked item. The line has no sales order line and a method other than Make to Order. This holds even for a `Service` line. So it skips stock and COGS for every line that a billable item stamps (`projectBillableItem.salesInvoiceLineId`), read with one query per invoice.
- The invoice stamps `serviceOrderId` on its header and `salesInvoiceLineId` on each billable item. Deleting the Draft invoice releases the stamps: `deleteSalesInvoiceReleasingRentals` and `deleteSalesInvoiceLineReleasingRentals` (`sales.server.ts`) also clear `projectBillableItem.salesInvoiceLineId` and return the items to Unbilled.
- An order with no Unbilled item closes with **Close** and no invoice.
- **Estimate.** **Print estimate** on the order prints the tree's plan as a PDF: plan lines at sale prices, and fixed-price nodes at their price. Customer approval of the estimate is out of scope.

### Contract project

- When the coverage contract has a project, the order's Service project names it as `parentProjectId`.
- Contract-covered charges post to that project's account.
- The contract project's Costs tab lists its service orders, one row each. So the contract shows its service cost beside its revenue.

### Technician experience (ERP on a phone)

- **My Visits** (`x+/service+/my-visits`): today's and upcoming visits for the signed-in employee. Each card shows customer, site address (a map link), subject serial, window and status.
- **Visit page**:
  1. Status buttons: **Start travel** → **Arrive** → **Complete**. Each tap stamps the time.
  2. The subject: item, serial, warranty badge and the last 3 orders on this asset.
  3. **The work tree**: an indented list of nodes with a large touch target per node. The selected node is the target of the next 3 actions. A node shows its component's last service date.
  4. **Start work** / **Stop work**, or **Add time**.
  5. **Issue part**, which defaults to the van.
  6. **Add expense**.
  7. Notes (rich text).
  8. Photos (`FileDropzone`; HEIC converts to JPEG).
  9. **Signature**: a canvas signature pad, saved as a PNG on the visit. It is a new `SignaturePad` component in `packages/react` with no new dependency.
  10. **Complete**, with **Work complete?**
- Every page uses `useIsMobile`, single-column layouts and large touch targets.

### Dispatch (v1)

- **Service → Schedule:** visits grouped by day and technician, with filters for status and technician.
- **Schedule visit** on an order sets the technician and the window.
- Drag-and-drop boards, skills, territories and optimization are later work.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Who decides capitalize vs expense | The order type (from the subject's owner). Customer units are expensed; company stock is capitalized. | Standards and every ERP surveyed (`serial-service-cost-treatment.md`). Brad 2026-10-08. |
| 2 | Shipped serial status | Stays `Consumed`. The `customerAsset` row says where it is. | Brad 2026-10-08. |
| 3 | Condition field, refurbished SKU | None. | Brad 2026-10-08. |
| 4 | Warranty accounting | Expensed when incurred to `warrantyExpenseAccount`. No reserve at sale in v1. | Brad 2026-10-08. |
| 5 | Sale price cap | The item's `unitSalePrice`, with an order override (`expectedSellingPrice`). No selling-cost subtraction. Skipped with a warning when there is no price. | Brad asked for the best option. Reuses an existing field; the override covers lower refurbished prices. |
| 6 | Installed base | A `customerAsset` table keyed to `trackedEntity`, created by `post-shipment` for every serialized item, plus manual registration. | Business Central service items. A table, not a view, because warranty dates and sites are edited, and legacy units need a row. |
| 7 | Which items create assets | Every serialized item on a posted sales shipment. No item flag. | Simplest. The rows cost nothing, and any shipped serial can then be serviced. |
| 8 | Warranty fields | `laborWarrantyMonths` and `partsWarrantyMonths` on `itemUnitSalePrice` (the item's sales settings). The end dates are stored on the asset and are editable. | Business Central and Salesforce separate labor and parts. The sales settings avoid widening `item`. |
| 9 | One subject per order | Yes. | SAP's one repair order per object. Keeps cost per serial clear. |
| 10 | Order types | Field Visit, Depot Repair, Refurbishment. | Covers Brad's two cases. Preventive maintenance comes later. |
| 11 | Visits drive status | Yes, as in D365. "Work complete?" on the last visit. | Avoids Salesforce's no-roll-up pitfall. |
| 12 | Coverage | Per charge at posting: the asset's warranty dates or the node's component warranty first, then the order's coverage contract, then billable. User override with reason. | D365, Business Central and Salesforce decide per line. Contracts have no per-serial coverage today, so the order names the contract. |
| 13 | Covered items on the invoice | At zero price, with a "covered by" note. | D365 and Business Central keep cost and history visible. |
| 14 | Depot Repair stock | The receipt and the return shipment of a `Repair` line write no stock ledger and no value. The serial stays `Consumed`. | SAP's non-valuated customer stock. Keeps planning and valuation clean. |
| 15 | Refurbishment execution | The service order collects labor and parts in WIP and capitalizes at completion. No job. | A job always makes a new serial (`sync_insert_job_make_method`), and changing that touches 3 handlers and job completion. SAP PM04 is also a maintenance-style order, not a production order. A job-based refurbishment can come later. |
| 16 | Serial layer for refurbishment | Split 1 unit from the oldest open unstamped layer when the serial has none (no value change). | Job output and RMA receipts write unstamped layers. The oldest layer is what `calculateCOGS` takes for the serial anyway. No change to job completion or receipts. |
| 17 | Costing methods | FIFO/LIFO: child row. Average: re-average. Standard: variance. | `serial-service-cost-treatment.md`; SAP, Oracle and IFS. |
| 18 | Abnormal rework | A flag on the order. Its cost posts to `materialVarianceAccount`. | ASC 330-10-30-7, IAS 2.16. |
| 19 | Labor cost rate | The technician's labor category (projects Phase 1a). | One cost model for project time and service time. |
| 20 | Labor price | The sale price of one company service labor item (`companySettings.serviceLaborItemId`). | A simple v1. Contract bill rates come with projects Phase 4. |
| 21 | Parts on the invoice | Line type `Service`. | The stock left at issue. A `Part` invoice line would relieve stock again. |
| 22 | Mobile | ERP pages built for phones. No MES. | Brad 2026-10-07. |
| 23 | Signature | A canvas `SignaturePad` in `packages/react`. No new dependency. | No dependency means nothing to ask about. |
| 24 | Dispatch | A list grouped by day and technician. No board in v1. | Research: essential vs advanced. |
| 25 | Module / naming | A new ERP module `service` (`service.models.ts`, `service.service.ts`, `service.server.ts`, `ui/`). Tables `customerAsset`, `serviceOrder*`. UI "Service", "Service order", "Visit", "Customer asset". Readable id `SVC`. | Maintenance and service are separate domains (Brad 2026-10-04). The existing `x+/service+/` route is the Service **item** page, so the module routes use `x+/service-orders+/` and `x+/service-order+/`. |
| 32 | Work structure | Each order owns a Service project; its elements are the work tree. There is no `serviceOrderLine` table. | One tree, one ledger and one set of charging actions for projects and service (Brad 2026-10-08). Time and parts can go to any node: Engine, Cylinders, Boring. |
| 33 | Building the tree | From the subject serial's build history, the item's make method, or a service template; or by hand. | Reuses projects' *Build from part*. Units Carbon did not build start from the make method or a template. |
| 34 | Installed components | `customerAssetComponent`, written by a part issue to a node of a customer unit, plus a `Service` genealogy activity. | Business Central's Replace Component. Gives per-component warranty and history, and keeps the serial's as-built current. |
| 35 | Service time posting | At Stop work or Add time; no weekly submit and no approval. | The visit and the signature are the approval. A technician should not reconcile a week before the customer is billed. |
| 36 | Prices | On billable items, created at posting; editable while Unbilled. Fixed-price nodes bill a subtree at one price. | The flat lines that held prices are gone. One billing table serves service now and contracts in projects Phase 4. |
| 37 | Where `resolveCoverage` lives | `@carbon/utils` (`service-coverage.ts`). | The posting server functions need it, and so does the ERP. One copy keeps the order page and the journal in agreement. Plan decision, 2026-10-09. |
| 38 | Fixed prices | Applied at invoicing. A billable item keeps its own price; the invoice bills the fixed-price node as one line and shows its subtree's items at 0 with "Included in fixed price". | A fixed price can change until the order is invoiced, with no rewrite of posted items. Plan decision, 2026-10-09. |
| 39 | Service time posting | `post-timesheet` posts a Service project's Draft entries. **Submit week** submits Standard entries only. | Service time posts at Stop Work or Add Time (decision 35), so it never waits in a weekly submit. Plan decision, 2026-10-09. |
| 40 | Second stock relief | `post-sales-invoice` skips stock and COGS on a line that a billable item stamps (`billedServiceLineIds`). Revenue still posts. | The part left stock when it was issued to the node. Plan decision, 2026-10-09. |
| 41 | My Timesheet | Moved to `x+/timesheet`, outside the Projects layout. `x+/projects+/timesheet` redirects there. | My Timesheet is personal: project and service hours in one week, for any employee. Plan decision, 2026-10-09. |
| 43 | Depot Repair link (B1) | `serviceOrder.salesReturnOrderLineId`, not `salesReturnOrderLine.serviceOrderId`. | One RMA line can return several serials, and each serial gets its own order (decision 9). A column on the line holds one order only. Plan decision, 2026-10-09. |
| 44 | Repair needs a serial (B2) | The Repair disposition needs an item tracked by Serial. | An order has one subject serial. A batch or an untracked unit has no identity to ship back. Plan decision, 2026-10-09. |
| 45 | Missing asset at a repair receipt (B3) | The receipt creates the asset, with source Manual. | A unit shipped before Carbon, or before the asset backfill, has no asset. The repair must still work. Plan decision, 2026-10-09. |
| 46 | Void of a repair receipt (B4) | The void cancels the line's orders. It is refused while an order has a charge that stands, or after its unit shipped back. | The order's subject is no longer at the depot. Posted cost needs a decision by a person. Plan decision, 2026-10-09. |
| 47 | Replacement and credit (B5) | A replacement order skips Repair lines and is refused when every line is Repair. A credit refuses a Repair line. | `createReplacementSalesOrder` works on the whole RMA, so the other lines can still be replaced. A repaired unit goes back to the customer, so nothing is credited. Plan decision, 2026-10-09. |
| 42 | RLS of the project tables | The `projectModule` rule piece decides between `projects_*` and `service_*` by `projectType`. Reads of a Standard project stay open to every employee. | One rule for every project table. MES operators and the PO line picker read Standard projects without `projects_view`, as before. Plan decision, 2026-10-09; the employee read is an execution change. |
| 26 | Multi-tenancy (H1) | Every new table has `companyId`, `PRIMARY KEY ("id","companyId")` and `id('prefix')`. | conventions-database. |
| 27 | Service shape (H2) | Client first, `{data, error}`, never throws. Posting and completion run in server functions (Kysely transactions). | conventions-services; `packages/server-functions/AGENTS.md`. |
| 28 | RLS (H3) | `company("service")` for orders, assets and components. Visits: an employee creates and updates their own visits (`technicianId`), and `service_create` / `service_update` holders any visit. The precedent is `timeCardEntry` (`or(and(owner(...), inCompany(..., "employee")), inCompany(..., "people_update"))`); `maintenanceDispatchEvent` has no owner check. Charges on a Service project use the projects tables; their rules check `service_*` for Service projects. | authz-manifest; the maintenance precedent. Q1 (2026-10-08). |
| 29 | Permissions (H4) | `service_view/create/update/delete`. Issue and Return Part also need `update: "inventory"`. Create invoice also needs `create: "invoicing"`. **Backfill:** every user with `sales_view` gets `service_view`; the Admin employee type gets full `service_*`. Companies grant technicians and service managers the rest. | Respects job roles (Brad 2026-10-08): customer service can look up warranty and order status, but no salesperson gets dispatch or repair rights by default. Carbon cannot know who the technicians are. |
| 30 | Forms (H5) | `serviceOrderValidator`, `serviceVisitValidator`, `customerAssetValidator`. Charges reuse the projects validators (`timesheetEntry`, `projectIssueValidator`, expense entry) with a coverage field. | conventions-forms. |
| 31 | Backward compatibility (H7) | Additive tables and columns. The RMA receipt and shipment change only for the new `Repair` lines. `post-shipment` adds asset rows and changes no posting. | No FROZEN surface. |

## Data Model Changes

Migration order:
1. Enums in their own migration.
2. Tables.
3. Seeds and backfills.

Then `pnpm db:migrate`, the authz rules (`pnpm --filter @carbon/database authz migration service-rls`) and `pnpm run generate:types`. RLS lives in `authz/manifest.ts`, never in migrations.

```sql
-- enums (own migration)
ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Service';            -- Q1, 2026-10-08
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Service Order';    -- Refurbishment completion
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Order';
ALTER TYPE "trackedActivityType" ADD VALUE IF NOT EXISTS 'Service'; -- if trackedActivity.type is an enum; else TEXT needs nothing

-- tables
CREATE TYPE "serviceOrderType" AS ENUM ('Field Visit', 'Depot Repair', 'Refurbishment');
CREATE TYPE "serviceOrderStatus" AS ENUM ('Draft', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled');
CREATE TYPE "serviceVisitStatus" AS ENUM ('Scheduled', 'Traveling', 'On Site', 'Completed', 'Cancelled');
-- "serviceCoverage" is created by the projects spec (Service projects)
CREATE TYPE "serviceInvoiceDetail" AS ENUM ('Itemized', 'By Node');
CREATE TYPE "customerAssetStatus" AS ENUM ('In Service', 'At Depot', 'Returned');

ALTER TABLE "itemUnitSalePrice"
  ADD COLUMN IF NOT EXISTS "laborWarrantyMonths" INTEGER CHECK ("laborWarrantyMonths" >= 0),
  ADD COLUMN IF NOT EXISTS "partsWarrantyMonths" INTEGER CHECK ("partsWarrantyMonths" >= 0);

CREATE TABLE "customerAsset" (
  "id" TEXT NOT NULL DEFAULT id('cas'),
  "companyId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "customerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "status" "customerAssetStatus" NOT NULL DEFAULT 'In Service',
  "shippedDate" DATE,
  "laborWarrantyEndDate" DATE,
  "partsWarrantyEndDate" DATE,
  "shipmentId" TEXT,                                 -- the shipment that created or last moved it
  "source" TEXT NOT NULL DEFAULT 'Shipment' CHECK ("source" IN ('Shipment', 'Manual')),
  "notes" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerAsset_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAsset_trackedEntity_key" UNIQUE ("trackedEntityId", "companyId"),
  CONSTRAINT "customerAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE "serviceOrder" (
  "id" TEXT NOT NULL DEFAULT id('svc'),
  "companyId" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,                    -- readable, sequence 'serviceOrder' prefix SVC
  "type" "serviceOrderType" NOT NULL,
  "status" "serviceOrderStatus" NOT NULL DEFAULT 'Draft',
  "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id"),   -- the subject
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "customerAssetId" TEXT,                            -- Field Visit, Depot Repair
  "customerId" TEXT REFERENCES "customer"("id"),     -- null for Refurbishment
  "customerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "customerContactId" TEXT REFERENCES "customerContact"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),  -- the company location that does the work
  "customerContractId" TEXT,                         -- coverage contract
  "projectId" TEXT NOT NULL,                         -- the order's own Service project (the work tree)
  "serviceTemplateId" TEXT,                          -- the template project the tree came from
  "invoiceDetail" "serviceInvoiceDetail" NOT NULL DEFAULT 'Itemized',
  "priority" "projectElementPriority" NOT NULL DEFAULT 'None',  -- reuse the projects enum
  "problem" JSONB,
  "resolution" JSONB,
  "assignee" TEXT REFERENCES "user"("id"),
  "expectedSellingPrice" NUMERIC,                    -- Refurbishment: overrides the sale price cap
  "abnormalRework" BOOLEAN NOT NULL DEFAULT FALSE,   -- Refurbishment
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "completedBy" TEXT REFERENCES "user"("id"),
  "salesInvoiceId" TEXT,                             -- stamp
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "serviceOrder_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceOrder_readable_key" UNIQUE ("serviceOrderId", "companyId"),
  CONSTRAINT "serviceOrder_asset_fkey" FOREIGN KEY ("customerAssetId", "companyId") REFERENCES "customerAsset"("id", "companyId"),
  CONSTRAINT "serviceOrder_contract_fkey" FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId"),
  CONSTRAINT "serviceOrder_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId"),
  CONSTRAINT "serviceOrder_project_key" UNIQUE ("projectId", "companyId"),
  CONSTRAINT "serviceOrder_customer_check" CHECK (("type" = 'Refurbishment') = ("customerId" IS NULL)),
  CONSTRAINT "serviceOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- at most one open order per subject serial
CREATE UNIQUE INDEX "serviceOrder_open_subject_key" ON "serviceOrder" ("trackedEntityId", "companyId")
  WHERE "status" NOT IN ('Closed', 'Cancelled');

CREATE TABLE "serviceVisit" (
  "id" TEXT NOT NULL DEFAULT id('svv'),
  "companyId" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL REFERENCES "user"("id"),
  "status" "serviceVisitStatus" NOT NULL DEFAULT 'Scheduled',
  "plannedStart" TIMESTAMP WITH TIME ZONE,
  "plannedEnd" TIMESTAMP WITH TIME ZONE,
  "travelStartedAt" TIMESTAMP WITH TIME ZONE,
  "arrivedAt" TIMESTAMP WITH TIME ZONE,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "notes" JSONB,
  "signaturePath" TEXT,                              -- private bucket path of the PNG
  "signedByName" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "serviceVisit_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "serviceVisit_order_fkey" FOREIGN KEY ("serviceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "serviceVisit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE "customerAssetComponent" (
  "id" TEXT NOT NULL DEFAULT id('cac'),
  "companyId" TEXT NOT NULL,
  "customerAssetId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),   -- null for an untracked part
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "installedDate" DATE NOT NULL,
  "partsWarrantyEndDate" DATE,
  "serviceOrderId" TEXT NOT NULL,
  "projectElementId" TEXT,                           -- the node it was issued to
  "projectLedgerId" TEXT,                            -- the issue
  "removedDate" DATE,
  "removedByServiceOrderId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "customerAssetComponent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerAssetComponent_asset_fkey" FOREIGN KEY ("customerAssetId", "companyId") REFERENCES "customerAsset"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerAssetComponent_order_fkey" FOREIGN KEY ("serviceOrderId", "companyId") REFERENCES "serviceOrder"("id", "companyId"),
  CONSTRAINT "customerAssetComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "customerAssetComponent_asset_idx" ON "customerAssetComponent" ("customerAssetId", "companyId") WHERE "removedDate" IS NULL;

-- Phase B (decision 43): the link is on the order, not on the RMA line
ALTER TABLE "serviceOrder" ADD COLUMN IF NOT EXISTS "salesReturnOrderLineId" TEXT;
-- composite FK ("salesReturnOrderLineId", "companyId") → salesReturnOrderLine, NO ACTION;
-- CHECK ("type" <> 'Depot Repair' OR "salesReturnOrderLineId" IS NOT NULL)
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "serviceOrderId" TEXT;
-- invoice lines link back through projectBillableItem.salesInvoiceLineId (projects spec)
-- each with an FK on (column, "companyId") ON DELETE SET NULL (column), and an index

ALTER TABLE "employeeJob" ADD COLUMN IF NOT EXISTS "defaultStorageUnitId" TEXT;   -- the technician's van

ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "warrantyExpenseAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT;
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "serviceLaborItemId" TEXT;

-- seeds and backfills
-- account 6120 'Warranty Expense' (Expense, Income Statement, parent group 'Operating Expenses', sibling of 6010)
--   per company group, with the accountDefault column, its FK and its backfill, as 20261006220201_revenue-recognition-core.sql does;
--   accountDefault.warrantyExpenseAccount = that account; seed-data.ts gains the account and the default.
-- sequence 'serviceOrder' prefix 'SVC' size 6 for every company (seed + backfill).
-- permissions (Q1): every userPermission row with sales_view = true gets service_view = true;
--   every employeeTypePermission row of the 'Admin' employee type gets a 'Service' row with full rights.
-- customerAsset backfill: one row per Consumed serial with a Posted sales shipment (sourceDocument 'Sales Order')
--   (the getShippedTrackedEntitiesForCustomer join, with no item filter), shippedDate = the shipment's
--   posting date, warranty dates null.
```

Because `serviceOrder.trackedEntityId`, `serviceOrder.serviceTemplateId`, `customerAsset.shipmentId`, `customerAssetComponent.projectLedgerId` and `salesInvoice.serviceOrderId` hold tenant row ids, the columns without an FK go into `ID_REF_COLUMNS` (`packages/jobs/src/backups/id-refs.ts`).

## API / Service Changes

**`service.service.ts`** (client first, `{data, error}`):
- **Customer assets:** `getCustomerAssets(client, companyId, args)` (filters: customer, item, warranty status, search by serial); `getCustomerAsset`; `getCustomerAssetHistory`; `upsertCustomerAsset` (site, warranty dates, notes).
- **Orders:** `getServiceOrders(client, companyId, args)`; `getServiceOrder`; `upsertServiceOrder` (Draft fields); `updateServiceOrderStatus` (On Hold, Cancelled, Close).
- **Visits:** `getServiceVisits(client, companyId, { technicianId, from, to, status })` for My Visits and the schedule; `upsertServiceVisit`; `updateServiceVisitStatus` (it stamps times and rolls the order status up).
- **Components:** `getCustomerAssetComponents(client, assetId, companyId)`; `getCustomerAssetHistoryByComponent` (one query, grouped by serial, else item).
- **Charges** use the projects services (timesheet entries, Issue to Project, expense entries, billable items) on the order's Service project.
- **Pure helpers in `service.models.ts`:** `resolveCoverage(charge, asset, component, order)` and `rollUpOrderStatus(order, visits)`, both unit-tested.

**`service.server.ts`** (Kysely, `db` from the route):
- `registerCustomerAsset(db, args)`: creates the `trackedEntity` and the asset in one transaction.
- `createServiceOrder(db, args)`:
  1. Reads the readable id.
  2. Checks the subject: a customer asset for Field Visit; an Available or On Hold stock serial for Refurbishment.
  3. Sets a Refurbishment subject to On Hold.
  4. Proposes the coverage contract.
  5. Creates the Service project (`createServiceProject`, projects spec) in the same transaction.
  6. If the user chose a source, builds the tree (`buildElementsFromPart`).

**Server functions** (`packages/server-functions/src/`):
- `post-timesheet`, `post-project-issue` and `post-project-expense` (projects spec) post the charges. On a Service project they call `resolveCoverage`, post to the coverage account and write the billable item. On a customer unit, `post-project-issue` also writes the component row and the `Service` genealogy activity.
- `complete-service-order`: for a Refurbishment, the WIP sweep, the serial layer split, the costing-method branch, the sale price cap and the release of the serial. For the other types, it only stamps the completion.
- `create-service-order-invoice`: follows `create-contract-invoices` (sequence, opportunity, header, `salesInvoiceShipment`, then `Service` lines from the Unbilled billable items in tree order, with fixed-price nodes and the invoice detail). It stamps the billable items. Permissions `{ update: "service", create: "invoicing" }`.
- `post-shipment`: creates or updates `customerAsset` rows for Serial items on posted sales shipments. For RMA `Repair` lines, the return shipment writes no ledger, no COGS and no journal.
- `post-receipt`: for RMA `Repair` lines, writes no ledger and no journal, keeps the serial `Consumed`, and creates the Depot Repair order.
- `buildJournalLineDimensionInserts` already carries Customer. It gains Project and Project Element through the projects spec (Task 24 of its Phase 1a plan).

**Routes:**
- `x+/service-orders+/` (module mode): `_layout`, `_index` (list), `new`, `my-visits`, `schedule`, `assets`, `assets.new`, `assets.$assetId`.
- `x+/service-order+/$id` (document mode): `details`, `work` (the tree, with the projects element peek), `visits`, `visits.$visitId` (the phone page), `complete`, `invoice`, `estimate`, `status`.
- A new **Assets** tab on the customer page (`x+/customer+/$customerId.assets.tsx`).
- RMA: a **Repair** disposition and an **Open service order** link on the line.

## UI Changes

Build with the `carbon-design` skill.

- **Navigation.** A **Service** module in `useModules.tsx` with Service Orders, My Visits, Schedule and Customer Assets.
- **Service order list.** Archetype A, after `x+/sales+/rmas.tsx`. Columns: id, type, status, customer, subject serial, item, site, next visit, coverage, assignee.
- **Service order page.** Archetype B, after `x+/sales-return-order+/$id.tsx`. The properties panel is after `IssueProperties.tsx`. Sections:
  - **Subject**: serial, item, the warranty badge, and the asset link.
  - **Visits**: a list with status and technician; **Schedule visit**.
  - **Work**: the tree in the projects List layout, with columns for coverage, hours, parts, cost and billable amount per node. A node opens in the element peek with **Log time**, **Issue material** and **Add expense**. **Build tree** and **Print estimate** sit in the section header.
  - **Problem** and **Resolution** (rich text).
  - **Files**: photos and the signature.
  - **Activity**: the audit log.
- **Header actions**: **Complete** (with the Refurbishment preview: WIP total, new unit cost, cap and write-down), **Create invoice**, **Close**, **Put on hold**, **Cancel**.
- **My Visits and the visit page.** Phone-first, as described in *Technician experience*.
- **Schedule.** Visits grouped by day, then by technician, with status pills. A row opens the visit.
- **Customer assets.** A list (archetype A) and an asset page. The page shows the warranty, the history by order and by component, and the installed components. It has **New service order**.
- **Item sales settings.** Two fields: Labor warranty (months) and Parts warranty (months).
- **Settings → Service.** The service labor item. Account Defaults gains **Warranty Expense**.
- **Employee job.** **Van (default storage unit)**.

## Acceptance Criteria

Phase A: customer assets, field visits, coverage, invoicing

- [ ] **Asset at shipment.** Item *ST-100* (serialized) has labor warranty 12 months and parts warranty 24 months. Shipping serial `SN-0001` to Acme on 2026-11-01 creates one customer asset with site, ship date 2026-11-01, labor end 2027-11-01 and parts end 2028-11-01. The asset shows on Acme's Assets tab.
- [ ] **Backfill.** Existing Consumed serials with a posted shipment get assets with no warranty dates.
- [ ] **Manual registration.** Registering serial `OLD-77` for Acme creates a `Consumed` tracked entity and an asset with `source = 'Manual'`.
- [ ] **Work tree.** A Field Visit on `SN-0001` uses the template *Engine rebuild*. It gets the nodes Engine, Cylinders (under Engine), Boring (under Cylinders) and Transmission, with ids `SVC000001-1` to `-4`. Building from the item's make method instead creates one node per Make to Order sub-assembly.
- [ ] **Charges on any node.** The technician logs 2 h on Boring and 1 h on Engine, and issues a gasket kit to Transmission. Engine's cost shows its own hour plus Cylinders and Boring. Transmission shows the kit.
- [ ] **Coverage.**
  1. On 2028-02-01, time on `SN-0001` is Billable (labor warranty ended), and a part is Warranty (parts warranty runs to 2028-11-01).
  2. With an Active coverage contract on the order, the time is Contract instead.
  3. A user override to Billable requires a reason.
- [ ] **Component warranty.** On 2029-01-10, after the asset's parts warranty ended, a part on the Transmission node is Warranty. The reason: the node links a transmission serial installed on 2028-06-01 whose own parts warranty runs 12 months.
- [ ] **Install and replace.** The Transmission node links the installed serial `TR-100`. Issuing serial `TR-200` to it writes a component row for `TR-200` and sets `TR-100`'s removed date. *Build from part* on `SN-0001` afterwards shows `TR-200`.
- [ ] **History by component.** Two orders both charge Cylinders. The asset page then shows one Cylinders row with the summed hours, the parts and the last service date.
- [ ] **Visits drive status.**
  1. Scheduling a visit sets the order Scheduled.
  2. **Start travel** sets it In Progress.
  3. Completing the visit with **Work complete? No** keeps it In Progress.
  4. A second visit completed with **Yes** sets it Completed.
- [ ] **Time posting.**
  - **Stop work** after 2 h at a labor category cost rate of 60.00, under Warranty, posts at once. The journal is Dr Warranty Expense / Cr Labor Absorption = 120.00, with the Customer, Project and Project Element dimensions.
  - A correction to 3 h posts a reversal and a replacement with a reason, net +60.00.
- [ ] **Part posting.** Issue 1 unit from the technician's van at FIFO cost 40.00, Billable. Carbon posts Dr COGS / Cr inventory = 40.00, with an `itemLedger` Negative Adjmt. of `documentType 'Project Issue'`, and one Unbilled billable item. Issuing more than the van holds is refused.
- [ ] **Invoice.**
  1. **Create invoice** on the Completed order makes one Draft invoice. Each top-level node is a heading, followed by its billable items as `Service` lines in tree order.
  2. Billable time is priced at the service labor item's sale price, and the billable part at its item sale price. A price changed on an Unbilled item carries to the invoice.
  3. Covered items show at 0 with "Covered by warranty".
  4. Transmission has a fixed price of 900.00. The invoice has one 900.00 line for it. Its items show at 0 with "Included in fixed price".
  5. The order goes to Closed. Deleting the Draft invoice reopens the order to Completed and clears the stamps.
- [ ] **Phone.**
  - On a 390 px wide screen, My Visits lists the technician's visits for today.
  - The visit page runs Start travel → Arrive → Add time → Issue part → Photo → Signature → Complete with no horizontal scroll.
  - The signature saves as a PNG on the visit.

Phase B: depot repair

- [ ] **Repair receipt.**
  - An RMA line for `SN-0001` with disposition Repair, set before receipt, receives the unit with no `itemLedger` row, no `costLedger` row and no journal.
  - The serial stays `Consumed`, the asset shows At Depot, and a Depot Repair order exists, linked to the RMA line.
- [ ] **Repair work.** Parts and labor post by coverage, as in Phase A.
- [ ] **Ship back.**
  - The Return to Customer shipment of the line writes no `itemLedger` row, no COGS and no journal.
  - The asset is In Service again at the customer's site, and the order closes after its invoice.
- [ ] **Guards.** A Repair line refuses a credit memo and a replacement order. On-hand quantity of *ST-100* is unchanged through the whole repair.

Phase C: refurbishment of a serial in stock

- [ ] **Capitalize (FIFO).**
  - Serial `SN-0050` is in stock in an unstamped layer of 10 units at 100.00. A Refurbishment order puts it On Hold.
  - Labor 150.00 and parts 50.00 post Dr WIP.
  - **Complete** splits a stamped layer of 1 at 100.00 (no journal) and adds a 200.00 child row. It posts Dr inventory / Cr WIP = 200.00.
  - The serial is Available. When `SN-0050` ships, COGS is 300.00. The other 9 units still cost 100.00.
- [ ] **Sale price cap.** The item's sale price is 250.00. The completion writes down 50.00 (Dr Inventory Adjustment Variance / Cr inventory). With an order override of 280.00 it writes down 20.00. With no price and no override it writes nothing and shows a warning.
- [ ] **Abnormal rework.** With **Abnormal rework** set, the 200.00 posts Dr Material Variance / Cr WIP, and the serial's cost stays 100.00.
- [ ] **Average and Standard.**
  - Average: the completion re-averages `itemCost.unitCost` over the on-hand units.
  - Standard: it posts the 200.00 to Material Variance.
  - The order page states the method's effect before completion.

Phase D: the contract project roll-up

- [ ] **Contract project.** An order whose coverage contract has a project gets that project as `parentProjectId`. Contract-covered charges post to its account. The contract project's Costs tab shows the order as one row.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The RMA receipt and return shipment change for Repair lines.** A mistake would leave a customer's unit valued as stock, or relieve stock that was never added. | High | Branch only on `disposition = 'Repair'`. Database tests for receipt and ship-back assert zero ledger and zero journal rows. The on-hand assertion is in the acceptance criteria. |
| **The layer split on refurbishment** picks the "wrong" unstamped layer for the serial | Med | It picks the oldest open layer, which is the layer `calculateCOGS` would take for this serial, so relief cost does not change. No GL posts. Pinned by a test. |
| **Average-cost items** cannot hold a per-serial value | Med | The completion re-averages and the order page says so before the user completes. |
| **Dependency on projects** (labor categories and the ledger in 1a; part links and *Build from part* in 1b; Service projects) | Med | Phase A starts after projects Phase 1b ships, and delivers the Service projects section of the projects spec with it. |
| **A project per service order** adds rows (one project, 6 states) per order | Low | The rows are small and indexed by `companyId`. The project list hides Service projects by default. |
| **The backfill of customer assets** reads every Consumed serial through a JSONB attribute | Low | One set-based `INSERT … SELECT` in the migration, not a loop. Indexed by `trackedEntity.status`. |
| **Signature and photos on phones** (HEIC, large files) | Low | `convertHeicToJpeg`; uploads go to the private bucket through the existing file paths. |
| **The `x+/service+/` route** already serves Service items | Low | The module routes are `x+/service-orders+/` and `x+/service-order+/`. |

## Delivery phases

Each phase gets its own plan with `/plan`:

1. **Phase A: customer assets, field visits, the work tree, components, coverage, invoicing, the phone pages.** It needs projects Phases 1a and 1b. It ships the projects spec's Service projects. **Implemented 2026-10-09** (plan `.ai/plans/2026-10-09-field-service-phase-a.md`, Tasks 1–30); browser verification (Task 31) is deferred.
2. **Phase B: depot repair through the RMA.** **Implemented 2026-10-09** (plan `.ai/plans/2026-10-09-field-service-phase-b.md`, Tasks 1–12); browser verification (Task 13) is deferred.
3. **Phase C: refurbishment of a serial in stock.**
4. **Phase D: the contract project roll-up.**

## Implementation notes (Phase A)

The plan's *Execution notes* record each deviation. These change the design above.

- **Technicians without `service_update`.** The ERP writes charges, notes and the signature through Kysely, which skips RLS. So the routes check the permission. Without it, a technician works only their own visit that is not Completed or Cancelled (`requireOwnServiceVisit`). A technician never overrides a coverage.
- **Returns.** A return of a service part reverses one whole open issue. That is the named issue, else the latest open issue of the same item and serial to the same node (`findServiceIssueToReturn`). A partial return is refused.
- **Contract coverage.** A Contract charge debits the contract project's account. A Statistical contract project has no account, so the charge debits Cost of Goods Sold.
- **Expense entries.** `post-project-expense` refuses a Capitalize project, because the CIP cost source has no `Project Expense` value.
- **Customer assets at shipment.** A reshipped serial keeps its `source`. A voided shipment sets its assets to Returned. The RMA return step updates only serials that are already assets.
- **Invoicing.** Tax is 0, because the customer has no default tax rate. Items on no node bill last under "Other charges". Deleting the Draft invoice sets the items back to Unbilled and the order back to Completed.
- **The work tree UI.** `WorkTree` is a component of the service module, not the projects element list. The element list posts to project routes that need `projects_*`.
- **Pages.** Work, Visits and Billing are tabs of the order. The asset page is `x+/customer-asset+/$assetId.tsx`. The visit page is `x+/service-order+/$id_.visits.$visitId.tsx` and the template page `x+/service-orders+/templates_.$id.tsx`, so they render as full pages.
- **Work timer.** `serviceVisit` has no work-start column, so the clock is kept on the device. **Stop Work** opens Log Time with the elapsed hours.
- **Visit window.** The window is typed and stored in the company's time zone. `DateTimePicker` gained an optional `timeZone` prop for this (a fix after Phase A).
- **Reversing charges.** The node drawer reverses a time or expense charge, with a reason. Time is reversed by a timesheet correction to 0 hours. An expense is reversed by an expense entry with `reversalOfId` and the new `reversalReason` column. So an order with time or an expense can be cancelled once each charge is reversed (a fix after Phase A).
- **Templates.** Build from part copied a template's nodes but not their plan lines. A service order now passes `includePlanLines`, so its estimate has prices. Projects' Build from part is unchanged.
- **Estimate PDF.** `ServiceEstimatePDF` is hand-built, like the project Reader. A template-engine document needs a new document type, which `packages/documents/AGENTS.md` puts under Ask First.
- **Settings.** `upsertItemUnitSalePrice` now filters by `companyId`. The van must be a storage unit at the employee job's location.
- **Demo datasets.** The templates and orders are seeded in tier 09, after the labor categories. The dataset wipe deletes the service order tables first, because nulling `customerId` breaks `serviceOrder_customer_check`.
- **Not built.** The contract project roll-up on the Costs tab (Phase D). Search excludes Service projects by default, because no search source lists projects.

## Implementation notes (Phase B)

The plan's *Execution notes* record each deviation. These change the design above.

- **Shared order creation.** `insertServiceOrder` and `ensureCustomerAssets` (`@carbon/server-functions/lib/service-orders`) create an order with its Service project in the caller's transaction. The ERP's New Service Order and `post-receipt` both call them. An order's project is named "<order id> — <serial> — <customer>". A project name is unique in its company, and a unit can have a second order.
- **The disposition race.** Both the disposition change and the receipt take the RMA's row lock. The receipt re-reads the dispositions under it and refuses one that changed while it posted.
- **One open order per serial.** A repair receipt refuses a serial that already has an open service order, before it writes anything.
- **Ship back.** A Repair line ships a unit whose order is Completed or Closed, because a company may invoice before it ships the unit back. Under the posting lock, the shipment re-checks the order and the asset.
- **UI.** The RMA line links its orders, and the explorer shows their count and the status that needs attention first. A Depot Repair order makes **Complete** its next step, since it has no visit, and offers **Ship Back** to the RMA. The RMA header hides **Issue Credit** and **Create Replacement** when they would only be refused.
- **Demo datasets.** Satellite seeds a To Receive RMA with one Repair line for SAT-1000-S013. A received repair is not seeded.

## Out of scope

- Asset hierarchies (a customer asset inside another), and return of removed parts (cores).
- Preventive maintenance plans that generate service orders.
- Entitlements with priority and price list overrides.
- Advance exchange and loaners.
- Supplier warranty claims.
- A warranty reserve accrued at the sale.
- Revision upgrades that change a serial's item.
- Checklists and inspection forms on visits.
- A drag-and-drop dispatch board, skills, territories and route optimization.
- Offline mode.
- Customer approval of an estimate. **Print estimate** gives the document only.
- Rental fleet units: they keep the maintenance module and the fixed asset rules.

## Open Questions

> Autonomous run (2026-10-08), then resolved with Brad. Brad decided the four questions from `.ai/research/serial-service-cost-treatment.md`, the status of shipped serials, and Q1.

Resolved with Brad (2026-10-08):

- [x] **Q1: a new `Service` permission module (RBAC)** — **Answer:** yes, because modules follow job roles. Every user with `sales_view` gets `service_view`, and the Admin employee type gets full `service_*`. Companies grant the rest. Technicians write their own visits and charges through owner rules, as timecard entries allow. A full copy of `sales_*` was rejected: it would give every salesperson dispatch and repair rights.
- [x] **Shipped serial status** — **Answer:** stays `Consumed`.
- [x] **Capitalize or expense** — **Answer:** decided by ownership. See `.ai/research/serial-service-cost-treatment.md`.
- [x] **Condition field / refurbished SKU** — **Answer:** neither.
- [x] **Warranty** — **Answer:** expensed when incurred.
- [x] **Sale price for the cap** — **Answer:** the best option. The author chose the item's `unitSalePrice` with an order override.

Resolved autonomously (2026-10-08), open to veto:

- [x] **Assets for every serialized item?** — **Autonomous:** yes, no item flag. Rationale: no cost, and any shipped serial can be serviced.
- [x] **Where do warranty months live?** — **Autonomous:** `itemUnitSalePrice`. Rationale: sales terms; avoids widening `item`.
- [x] **One subject per order?** — **Autonomous:** yes. Rationale: SAP one repair order per object; clean cost per serial.
- [x] **Refurbishment by job or by service order?** — **Autonomous:** by service order, capitalized at completion. Rationale: a job always makes a new serial, and changing that touches 3 handlers and job completion.
- [x] **Contract coverage?** — **Autonomous:** the order names the coverage contract; Carbon proposes it when the customer has exactly one Active contract. Rationale: contracts have no per-serial coverage.
- [x] **Parts on the invoice?** — **Autonomous:** `Service` lines. Rationale: the stock left at issue.
- [x] **Lines or a tree?** — **Brad (2026-10-08):** a tree. Each order owns a Service project, and time and parts go to any node. The flat lines are gone; prices live on billable items.
- [x] **Labor price?** — **Autonomous:** one company service labor item. Rationale: simple v1; contract bill rates come with projects Phase 4.
- [x] **Signature?** — **Autonomous:** a canvas component in `packages/react`, no dependency.
- [x] **Dispatch?** — **Autonomous:** a list by day and technician; no board in v1.

## Changelog

- 2026-10-08: Created autonomously after research (`.ai/research/field-service.md`, `.ai/research/serial-service-cost-treatment.md`) and a map of Carbon's RMA, shipment, job, cost layer, invoicing, contracts, maintenance and mobile touchpoints. Covers Brad's two cases (a serial in stock, a shipped serial). Q1 (the permission module) is open.
- 2026-10-08: The order owns a work tree (Brad). Each service order now owns a project of type Service (projects spec, *Service projects*). Time, parts and expenses go to any node as timesheet entries, project issues and expense entries, each with a coverage. The `serviceOrderLine` table, `post-service-order` and `post-service-part` are gone. Prices live on billable items. The tree builds from the subject serial's build history, the item's make method or a service template. A part issued to a node is installed (`customerAssetComponent`), with its own parts warranty, and coverage checks it. Invoices follow the tree, with fixed-price nodes. **Print estimate** is new. Phase A now needs projects Phase 1b.
- 2026-10-08: Modules follow job roles (Brad). New *Who uses what* section. Q1 resolved: a Service module; `sales_view` → `service_view`, and full rights for the Admin employee type only. The order's Service project stays hidden from Projects, the dimension picker and the Ramp sync. The customer Assets tab shows with `service_view`.
- 2026-10-09: Corrections from the Phase A planning research. The site comes from the sales order, not the shipment. `post-sales-invoice` must skip stock and COGS on lines that billable items stamp. Visit RLS follows `timeCardEntry` (owner rules), not `maintenanceDispatchEvent`. The account and default follow `revenue-recognition-core`. The demo datasets have no shipped serials, so the datasets register customer assets by hand.
- 2026-10-09: Phase A implemented (`.ai/plans/2026-10-09-field-service-phase-a.md`, Tasks 1–30). Browser verification (Task 31) is deferred. Decisions 37–42 record the plan's choices, and *Implementation notes (Phase A)* records the main changes found during the run.
- 2026-10-09: Phase B implemented (`.ai/plans/2026-10-09-field-service-phase-b.md`, Tasks 1–12). Browser verification (Task 13) is deferred. Decisions 43–47 record the plan's decisions B1–B5. The link is `serviceOrder.salesReturnOrderLineId`, not `salesReturnOrderLine.serviceOrderId`. *Implementation notes (Phase B)* records the main changes found during the run.
