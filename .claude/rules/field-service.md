---
paths:
  - "apps/erp/app/modules/service/**"
  - "apps/erp/app/routes/x+/service-orders+/**"
  - "apps/erp/app/routes/x+/service-order+/**"
  - "apps/erp/app/routes/x+/customer-asset+/**"
  - "apps/erp/app/routes/file+/service-estimate+/**"
  - "packages/utils/src/service-coverage.ts"
  - "packages/server-functions/src/create-service-order-invoice/**"
  - "packages/server-functions/src/post-project-expense/**"
  - "packages/server-functions/src/reclass-project-coverage/**"
  - "packages/server-functions/src/post-project-issue/service.ts"
  - "packages/server-functions/src/post-shipment/customer-assets.ts"
  - "packages/server-functions/src/post-receipt/repair.ts"
  - "packages/server-functions/src/post-shipment/repair.ts"
  - "packages/server-functions/src/lib/service-orders.ts"
  - "packages/server-functions/src/complete-service-order/**"
  - "packages/documents/src/pdf/ServiceEstimatePDF.tsx"
  - "apps/erp/app/routes/x+/contract+/$id.service-orders.tsx"
  - "apps/erp/app/modules/projects/ui/Costs/ServiceOrderCosts.tsx"
---

# Field Service

Phases A–D of `.ai/specs/implemented/2026-10-08-field-service.md`. Phase A: customer
assets, Field Visit service orders, visits, the work tree, coverage, invoicing, the
estimate, templates and the technician's phone pages. Phase B: depot repair through the
RMA. Phase C: refurbishment of a serial in stock. Phase D: the contract project roll-up.
Plans: `.ai/plans/2026-10-09-field-service-phase-a.md`, `…-phase-b.md`, `…-phase-c.md`
and `…-phase-d.md` (their *Execution notes* record every deviation).
Module guide: `apps/erp/app/modules/service/AGENTS.md`.

## The shape

- **Customer asset** (`customerAsset`, one row per serial): customer, site, ship date,
  labor and parts warranty end dates, status In Service / At Depot / Returned, source
  Shipment or Manual.
- **Service order** (`serviceOrder`, readable id `SVC…`, sequence `serviceOrder`): one
  subject serial, one customer asset (none for a Refurbishment), and its own **Service project**
  (`project.projectType = 'Service'`, `costTreatment = 'By Coverage'`, identifier = the
  order's readable id). The project's elements are the **work tree**. The UI says
  "element"; code names still say "node" (`ServiceWorkNode`, `NodePeek`, `NodePicker`,
  `requireServiceOrderNode`). There is no order line table.
- **Visit** (`serviceVisit`): technician, planned window (typed in the company's time
  zone: `ScheduleVisitModal` passes `useCompanyTimeZone()` to `DateTimePicker`'s
  `timeZone`), status, travel / arrival /
  completion stamps, notes, `signaturePath`, `signedByName`.
- **Installed component** (`customerAssetComponent`): a part a service order put in the
  asset, with its own parts warranty, and `removedDate` once a later part replaces it.
- **Billable item** (`projectBillableItem`): what a charge will bill. Status Unbilled →
  On Hold / Billed / Written Off.

At most one open order per subject serial (`serviceOrder_open_subject_key`). The New
Service Order drawer (`service-orders+/new.tsx`, `ServiceOrderForm`) creates Field Visit
and Refurbishment orders (`serviceOrderTypes`). A Depot Repair
order comes only from an RMA receipt (below); the list filters all 3
(`listedServiceOrderTypes`).

A Service user never sees the word "project". The Projects module, the charge number
pickers (ERP and MES `getChargeNumbers`), the dimension picker (`getEntityValues`) and the
Ramp sync (`desiredProjectOptions`) list Standard projects only.

## Names that are taken

`path.to.service`, `serviceRoot`, `serviceDetails` and `services` are the Service
**item** page (`x+/service+/`). The module's routes are `x+/service-orders+/` (list, My
Visits, Schedule, assets, templates) and `x+/service-order+/` (the order workspace).
Helpers are `serviceOrder*`, `customerAsset*`, `serviceVisit*`, `serviceTemplate*`,
`myVisits` and `serviceSchedule`.

Three pages opt out of their parent layout with a trailing `_`, so they render as full
pages: the visit page `service-order+/$id_.visits.$visitId.tsx` (not inside the order
workspace), the template page `service-orders+/templates_.$id.tsx` (not under the
list table) and the template element page `service-orders+/templates_.$id_.$elementId.tsx`
(not under the template page). The asset page is its own folder,
`customer-asset+/$assetId.tsx`.

## The module UI

- **Sidebar** (`useServiceSubmodules`): Manage holds Service Orders, Schedule and My
  Visits. Setup holds Customer Assets and Service Templates; it is a plain group that
  is always open. My Time is not in it; it opens from the avatar menu.
- **New Service Order** is a drawer (`service-orders+/new.tsx`). The route is a sibling
  of the list, so the drawer opens over an empty page. The form reuses `FormSection`
  (the folded section that keeps its fields mounted) from the projects
  `ProjectForm.tsx`.
- **Service template page** (`templates_.$id.tsx`): a standard `RecordHeader` with the
  identifier, the name and the copy button at the right end (`toolsPlacement="end"`). It
  has no ⋯ menu: no route renames or deletes a template. A template element opens as a
  full page (`templates_.$id_.$elementId.tsx`): one header row (back, the breadcrumb,
  Copy, a ⋯ menu with Add plan line and Delete), then the Plan section
  (`ElementPlanLines`). Delete posts the template route's `intent=delete`.
- **Empty states**: My Visits, the Schedule, a customer's Assets tab
  (`CustomerAssetsTable` with `customerId`) and the contract's Service Orders tab use
  `Empty`. The Service Orders and Service Templates lists pass `Empty` only when no
  filter or search is set. An empty section inside a card is one muted line.

## Status: visits drive the order

`rollUpOrderStatus` (`service.models.ts`, pure, tested) gives the order's status:

1. A status the user set stays: On Hold, Completed, Closed, Cancelled.
2. **Work complete? Yes** on a completing visit gives Completed.
3. A visit Traveling, On Site, or Completed with work left gives In Progress.
4. A Scheduled visit gives Scheduled. Cancelled visits do not count.
5. No live visit: a Draft order stays Draft, and any other order gives Planned. A
   released order never returns to Draft.

Every order starts Draft. **Mark as Planned** (Draft → Planned) releases it: its Service
project goes from Draft to Released, so its plan-line materials become MRP demand
(`openProjectMaterialLines`) and it takes charges. A Draft order takes no charge:
`requireServiceOrderNode` refuses with "Mark the service order as Planned before you
charge it" (the project is Draft, so `assertChargeable` would refuse anyway). Scheduling
a visit on a Draft order rolls it to Scheduled, which releases it too. Resume and Reopen
move to Planned.

`syncServiceOrderStatus` (`service.server.ts`) saves the roll-up and the project status
(`projectStatusOfOrder`: Draft → Draft, On Hold → On Hold, Completed → Technically
Complete, Closed / Cancelled → Closed, else Released). `insertServiceProject` inserts
the project Draft, as its order. Migration `20261015150413` moved each existing Draft
order with a `projectLedger` row to Planned and set the other Draft orders' projects to
Draft. Call it after every visit change and every order
status change, in the same transaction. `canMoveServiceOrder` and `canMoveVisit` are
the allowed moves. `cancelServiceOrder` refuses an order while a ledger row stands (`openChargeIds`, `@carbon/utils`: not a reversal, and no row reverses it); an order whose every charge is reversed can be cancelled.

## Coverage

`resolveCoverage` (`packages/utils/src/service-coverage.ts`) decides who pays for one
charge when it posts:

1. A Refurbishment charge is Capitalized.
2. Time inside the asset's labor warranty is Warranty. A part inside the asset's parts
   warranty, or the warranty of the installed component on the element, is Warranty. An
   expense is never Warranty.
3. Else Contract, when the order names a coverage contract.
4. Else Billable.

A user override needs a reason (`coverageOverrideValidator`) and posts through
`reclass-project-coverage`, which moves the cost to the new coverage's account and leaves
the old ledger row reversed by a later row.

`resolveProjectPostingAccount` takes the coverage for a By Coverage project:
Warranty → `warrantyExpenseAccount`, Contract → the parent contract project's account
(a Statistical one falls back to Cost of Goods Sold; a Closed one refuses the charge,
see below), Billable → Cost of Goods Sold,
Capitalized → Work in Progress. A
By Coverage charge without a coverage is refused. The SQL mirror
`project_posting_account` raises for By Coverage: job completion never charges a
Service project.

## The contract project (Phase D)

A coverage contract with a project (`customerContract.projectId`) is the parent of the
Service project of every order it covers (`project.parentProjectId`).

- **Set at creation** by `insertServiceOrder` (`contractProjectId`).
- **Kept in step** by `updateServiceOrderCoverageContract` (`service.server.ts`, one
  transaction): the order's `customerContractId` and its project's `parentProjectId`
  change together. It refuses while a Contract charge stands (`openChargeIds` over the
  order's Contract ledger rows): that cost already posted to the old contract's account,
  so the user overrides it first (`reclass-project-coverage`). It also refuses a Closed or
  Cancelled order, a Refurbishment and another customer's contract. The details route
  sends the Properties field there, and `updateServiceOrder` never saves
  `customerContractId`. The field is editable on any open order.
- **Closed parent**: `resolveProjectPostingAccount` refuses a Contract charge whose parent
  project is Closed ("The contract project … is closed. …"). On Hold and Technically
  Complete still take it, as `assertChargeable`'s `commitment` mode does. The parent's
  status comes from `ctx.parent`, which `loadProjectPostingContexts` already loads.
- **Roll-up**: `get_child_service_project_costs(p_project_id, p_company_id)` (plpgsql,
  SECURITY INVOKER, migration `20261010013108`) returns one row per order whose Service
  project names the project as parent: actual (Σ `projectLedger.amount`), posted hours,
  billed and unbilled. It is separate from `get_project_cost_summary`, so Projects Phase 3
  can redefine that one alone. `getChildServiceProjectCosts` (`projects.service.ts`) adds
  each order's serial with one `.in()` query.
- **Costs page** (`$projectId.costs.tsx`): `ServiceOrderCosts` lists the orders under the
  tree, and `buildProjectCostFigures`'s third argument adds their actual to the project
  total only. RLS hides Service projects without `service_view`, so such a user sees no
  rows and a total without service cost.
- **Contract page**: the header shows route tabs **Details** and **Service Orders**
  (`DetailTopbar`, only with `service_view`). `contract+/$id.service-orders.tsx` lists
  `getContractServiceOrders` in `ContractServiceOrders`, a read-only `Table compact` with
  5 columns: Service Order, Status, Customer Asset, Scheduled and Total Cost. Scheduled is
  the planned start of the next unfinished visit (`nextVisitStart`, from the embedded
  visits). Total Cost is the roll-up's actual; a contract with no project shows the
  posted cost (`getServiceOrderCosts`). The tab shows no billed amount.

## Charges post through server functions

Every charge goes through the order's charge route (`$id.charge.tsx`, `intent` = `time`,
`part`, `expense`, `reclass`, `reverse`) and a server function. Never insert ledger rows, billable
items or components directly.

Each server function below, and the Refurbishment completion, writes its journal for every
company, as main's always-post rule says: Provisional with no accounting period before the
company's accounting cutover, Posted after it (`journalPostingStatus`). None reads
`accountingEnabled`.

| Charge | Server function | Notes |
|---|---|---|
| Time | `post-timesheet` | `saveTimesheetEntry` (`mode: "add"`, `save-timesheet-entry`) writes a Draft entry with the visit; a Service project's Draft entry posts at once. Journal line "Service Labor" with the Customer dimension. |
| Part | `post-project-issue` | `post-project-issue/service.ts`: billable item, installed component, replacement of the element's component, and the `Service` genealogy activity. A return reverses one whole open issue (`findServiceIssueToReturn`). |
| Expense | `post-project-expense` | `addServiceExpense`; Dr the coverage account / Cr GRNI. |
| Reclass | `reclass-project-coverage` | Refuses Capitalized either way. |
| Reverse | `post-timesheet` / `post-project-expense` | `reverseServiceCharge`, with a reason (`serviceChargeReversalValidator`). Time: `createTimesheetCorrection` to 0 hours (`correctionReason`; the correction keeps the entry's `serviceVisitId`), posted at once. Expense: `buildExpenseReversal`, a `projectExpenseEntry` with `reversalOfId` and `reversalReason`. Both post at the original's coverage and reverse its billable item. A reversal saved but not posted is posted again on the next Reverse, never written twice. |

The element drawer (`NodePeek`, route `$id.work.$elementId.tsx`) shows **Reverse** on a
time or expense row (`canReverseCharge`: not a reversal, not reversed since). A part has no Reverse: it is
returned with Issue Part. Reversing the last standing charge is what lets
`cancelServiceOrder` through.

`loadServicePostingContexts` (`lib/project-posting.ts`) loads the order, its asset's
warranty dates, the labor item's price and the element's installed component in 3 queries
for any number of charges. `buildBillableItem` builds the item: a covered item is priced
0 and its description says "(Covered by warranty)" or "(Covered by contract)".

The ERP writes through Kysely, which bypasses RLS, so the routes authorize. A user with
`update: "service"` charges any open order. A technician without it charges only
their own visit that is not Completed or Cancelled (`requireOwnServiceVisit`, the form's
`serviceVisitId`), and never reclasses. A technician reverses only a charge whose entry
carries their own open visit (`reverseServiceCharge`'s `onlyVisitId`). A part also needs
`update: "inventory"`.

## Depot repair through the RMA

A customer returns a unit for repair; the company repairs it and ships the same serial
back. The unit never enters company stock or stock value. Every branch keys on
`salesReturnOrderLine.disposition = 'Repair'`; every other RMA line posts as before.

- **The link** is `serviceOrder.salesReturnOrderLineId` (composite FK to the RMA line, NO
  ACTION; CHECK `serviceOrder_depot_check`: a Depot Repair order needs it). One RMA line
  returns several serials, each with its own order, so the link is on the order.
- **Disposition** (`setSalesReturnOrderLineDisposition`): before receipt only Pending and
  Repair (`salesReturnPreReceiptDispositions`); Repair needs a Serial-tracked item; a change
  to or from Repair after receipt is refused (`REPAIR_DISPOSITION_LOCKED_MESSAGE`) under the
  RMA's row lock, the lock `post-receipt` takes. The line's Issue route refuses a Repair line.
- **Receipt** (`post-receipt`, case Sales Return Order): a Repair line writes no
  `itemLedger`, no cost layer and no journal, and its serials stay Consumed. It needs one
  serial per received unit. Under the RMA lock the posting re-reads the dispositions and
  refuses one that changed. `createDepotRepairOrders` (`post-receipt/repair.ts`) refuses a
  serial with an open order, finds or creates its asset (`ensureCustomerAssets`, source
  Manual) and sets it At Depot, inserts one Draft Depot Repair order per serial
  (`insertServiceOrder`, `lib/service-orders.ts`: the RMA's customer, site and contact, the
  receiving location, the customer's only Active contract), and writes a `Return Receipt`
  activity with `At Depot` and the order's id.
- **Receipt void**: `voidDepotRepairOrders` cancels the orders of this receipt's serials
  (and their open visits), closes their projects and sets the assets In Service. It refuses
  an order with a charge that stands (`openChargeIds`) and a unit already shipped back.
- **Return shipment** (`create`, `post-shipment`): a Repair line ships the units whose order
  is Completed or Closed and whose asset is At Depot. `shipRepairedUnits`
  (`post-shipment/repair.ts`) re-checks that under the posting lock, writes no ledger, no
  cost and no journal, keeps the serial Consumed, writes a `Return Shipment` activity with
  `At Depot: false`, and sets the asset In Service at the RMA's site with the ship date and
  shipment. The void (`unshipRepairedUnits`) sets the asset At Depot again.
- **Guards** (`sales.service.ts`, MCP tools): `getCreditableQuantities` leaves Repair lines
  out, `createSalesReturnOrderCredit` refuses one (`REPAIR_LINE_CREDIT_MESSAGE`),
  `createReplacementSalesOrder` skips them and refuses an RMA of Repair lines only
  (`REPAIR_ONLY_REPLACEMENT_MESSAGE`).
- **UI**: the RMA line links its orders, the explorer shows their count and
  `worstServiceOrderStatus`, and the header's Ship shows for an order that
  `isReadyToShipBack`. A Depot Repair order's header links the RMA, shows the At Depot pill,
  offers Complete with no visit and offers Ship Back in its ⋯ menu.

Pinned by `post-receipt/sales-return-repair.test.ts` and
`post-shipment/sales-return-repair.test.ts` (fixture `lib/sales-return-test-fixture.ts`).

## Refurbishment of a serial in stock

The company refurbishes a serial it owns. Labor, parts and expenses collect in WIP
(coverage Capitalized), and the completion moves the WIP into that serial's cost.

- **Create** (`createServiceOrder`): the New form picks an item, then a serial
  (`SerialSelect`). The serial must be serial-tracked, Available or On Hold, with no open
  order. The order has no customer, asset, site or contract (`serviceOrder_customer_check`);
  `insertServiceOrder` takes null customer fields and names the project
  "<order id> — <serial>". The serial goes **On Hold** in the same transaction.
- **Cancel** (`cancelServiceOrder`): the serial goes from On Hold back to Available.
- **Charges**: `resolveCoverage` gives Capitalized, so every charge posts Dr WIP. A part
  issue writes no billable item and no installed component; `installServicePart` writes a
  `Service` activity from the issued serial or batch to the subject serial (a later Build
  from part shows the new parts). A return deletes the activity.
- **Guard** (`assertNoOpenRefurbishment`, `lib/service-orders.ts`): `post-shipment` (Sales
  Order) and `post-picking` (serial case) refuse a serial with an open Refurbishment order.
- **Complete** (`complete-service-order`, one transaction, from Draft, Planned, Scheduled
  or In Progress): `loadRefurbishmentCompletion` (`load.ts`) reads the WIP by element, the item cost,
  the open layers and children as `calculateCOGS` selects them, the on-hand (Average) and
  the cap; `planRefurbishmentCompletion` (`plan.ts`, pure, tested) decides:

  | Case | Effect |
  |---|---|
  | Abnormal rework, or Standard | Dr `materialVarianceAccount` / Cr WIP; the unit keeps its cost |
  | FIFO / LIFO | the serial's own layer, else a split of the layer `calculateCOGS` takes next (its open children move with the unit); a `Revaluation` child of the WIP; Dr inventory / Cr WIP |
  | Average | a `Revaluation` child (attached when the serial has a layer); `itemCost.unitCost` re-averaged over the on-hand |
  | Cap (FIFO / LIFO) | over the cap: a negative child, Dr `inventoryAdjustmentVarianceAccount` / Cr inventory |

  The cap is `serviceOrder.expectedSellingPrice`, else the item's oldest `itemUnitSalePrice`
  when its sales unit is empty or the inventory unit and its currency is the base
  currency; otherwise the completion skips the cap and warns. The journal has source type
  `Service Order` (not pushed to external ledgers by default, `POSTING_POLICY`); the WIP
  credit is split by element with the Project and Project Element dimensions. The serial goes
  Available with a `Service` activity, and the order saves `capitalizedAmount`,
  `writeDownAmount`, `completionJournalId` and `completionCostingMethod`
  (`serviceOrder_refurbishment_check`: only a Refurbishment has amounts).
- **One path**: the status route sends every Complete through `completeServiceOrder`
  (`service.server.ts`). `syncServiceOrderStatus` refuses to complete a Refurbishment,
  ignores a visit's Work complete? for it, and refuses to reopen a completed one.
- **UI**: Complete opens `CompleteRefurbishmentModal`, which loads the preview from
  `$id.complete.tsx` (`previewRefurbishmentCompletion`: the same reads without locks, the
  same planner, no writes) and posts `status=Completed` to the status route. Properties
  edit **Expected Selling Price** and **Abnormal Rework** until completion
  (`updateServiceOrder` refuses them on other types and after completion).

Pinned by `complete-service-order/plan.test.ts`, `complete-service-order.test.ts`,
`lib/calculate-cogs.test.ts`, `post-picking/refurbishment-guard.test.ts` and
`post-shipment/customer-assets.test.ts`.

## Customer assets

- **At shipment:** `upsertShippedCustomerAssets` (`post-shipment/customer-assets.ts`) is
  one `INSERT … SELECT … ON CONFLICT` per posted shipment. The warranty ends are the ship
  date plus the item's `itemUnitSalePrice.laborWarrantyMonths` / `partsWarrantyMonths`.
  A reshipped serial moves to the new customer and starts its warranty again; its
  `source` stays. A voided shipment sets the asset Returned.
- **At an RMA repair:** At Depot at the receipt, In Service at the return shipment (above).
- **By hand:** `registerCustomerAsset` (`service.server.ts`) inserts a Consumed
  `trackedEntity` for the typed serial (source document Item) and the asset with source
  Manual. It refuses an item that is not serial-tracked and a serial the item already
  has.
- **History:** `getCustomerAssetHistoryByComponent` groups the ledger rows of the
  asset's orders by the element's serial, else its item, else its name.

## Invoicing

`create-service-order-invoice` drafts one invoice of a Completed order's Unbilled items,
laid out by the tree (`planServiceInvoiceLines`): a heading per element, `Service` lines,
items on no element last under "Other charges", and one line per fixed-price element
(`projectElement.fixedPrice`) for its whole subtree. It stamps each item Billed and
closes the order (`serviceOrder.salesInvoiceId`). Tax is 0.

- `post-sales-invoice` skips stock and COGS on a line a billable item stamps
  (`billedServiceLineIds`): the part left stock at issue.
- Deleting the Draft invoice runs `releaseServiceOrderStamps` (`sales.server.ts`): the
  items go back to Unbilled and the order from Closed back to Completed.
- The Billing tab (`$id.billing.tsx`, `BillableItemsTable`) reviews an item before it is
  billed: **Edit Price**, **Hold** / **Release**, **Write Off** with a reason
  (`updateServiceBillableItem`). **Create Invoice** (`$id.invoice.tsx`) needs
  `update: "service"` and `create: "invoicing"`. With no Unbilled item, a Completed order
  shows **Close**.

## The estimate and templates

- `buildServiceEstimate` (`service.models.ts`, pure, tested) prices the tree's plan
  lines: labor at the service labor item's sale price
  (`companySettings.serviceLaborItemId`), materials at their item's `unitSalePrice`,
  other costs at their amount. A fixed-price element is one line and its subtree is left
  out. `ServiceEstimatePDF` (`@carbon/documents`) is hand-built, not a template-engine
  document; the route is `file+/service-estimate+/$id[.]pdf.tsx`.
- A **service template** is a Service project with `isTemplate`, identifier
  `serviceTemplateIdentifier(id)` (`TPL-` + 6 characters of the id). `createServiceTemplate`
  makes one. Its elements carry plan lines (`ElementPlanLines` with an `action` override,
  `path.to.serviceTemplateNode`).
- Building an order's tree from a template passes `includePlanLines` to
  `insertElementsFromPart`, so the plan lines come along and the estimate has prices.
  Projects' Build from part does not pass it.

## The phone pages

- **My Visits** (`service-orders+/my-visits.tsx`): the user's visits today and the next 7
  days, by the company's day. The list column is left-aligned under the title.
- **The visit page**: status buttons, the unit and its last 3 orders, the element picker
  (`NodePicker`),
  `WorkTimer` (the clock is per device in `localStorage`; Stop Work opens Log Time with the
  elapsed hours), Issue Part (defaults to the van, `employeeJob.defaultStorageUnitId`),
  Add Expense, notes, photos under `${companyId}/service/${orderId}/${visitId}/`, the
  signature (`$id.visits.$visitId.signature.tsx` uploads `signature.png` and saves the
  path and name), and Complete with **Work complete?**.
- Visit RLS lets the technician update their own visit (owner rule on `technicianId`);
  `service_update` holders update any.

## RLS

`projectModule(column, action, { standard?, via? })` (`authz/rules.ts`) governs every
project table: a Standard project follows `projects_<action>` (reads open to any
employee), a Service project `service_<action>`. See `authz-manifest.md`.

## Demo datasets

Each dataset registers 3 customer assets (tier 04: In warranty, Labor ended, Expired on
the anchor day), one service template with plan lines, a Scheduled order with the
template's tree and a visit tomorrow, and a Draft order (tier 09, `seedServiceWork`).
Robotics, motor and precision add a Planned order with the template's tree on the
Expired asset; its plan lines are MRP demand. Tier 09 inserts a Draft order's project
Draft and every other order's Released.
No charges are seeded. Satellite also has a To Receive RMA (`bus-repair`) whose one line
returns SAT-1000-S013 with disposition Repair (`SalesReturnLineSpec.disposition`); the
validator keeps a Repair line out of on-hand and refuses one on a Completed return.
Satellite also seeds a Planned Refurbishment on stock serial RW010-SN-0054
(`ServiceOrderSpec` with `type: "Refurbishment"` and `serial`), which the seed puts On
Hold. Satellite gives contract `novasat-ops` a project (`ContractSpec.project`,
identifier `NSOPS`, Expense, Released, seeded in tier 09 before the orders) and makes it
the coverage contract of the Draft order (`ServiceOrderSpec.contract`), so the order's
Service project is its child. The wipe deletes `customerAssetComponent`, `serviceVisit` and
`serviceOrder` before its FK-nulling pass (`serviceOrder_customer_check`).

## Known gaps

- The service tables do not broadcast, so no page declares `handle.realtime`.
- `documentSourceType` has no service order value, so order and visit files write no
  `document` row.
- A component the factory built in has no `customerAssetComponent` row, so a part issued
  in its place does not remove it.
- No browser verification of Phase A (plan Task 31), Phase B (plan Task 13), Phase C
  (plan Task 11) or Phase D (plan Task 8) yet.
- An order whose project names a parent other than its contract's current project (the
  contract's project changed after the order was created) drops out of the roll-up.
- A completed refurbishment cannot be reopened, and a refurbishment never changes the
  serial's item.
- Repair needs a Serial-tracked item. A Batch or untracked unit cannot come back for
  repair through an RMA.
- A repair the company cannot complete has no credit path: reverse the order's charges,
  void the receipt, then change the disposition.
- No precheck decides repair or return at receipt; the disposition is set before it.
