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
---

# Field Service

Phases A, B and C of `.ai/specs/2026-10-08-field-service.md`. Phase A: customer assets,
Field Visit service orders, visits, the work tree, coverage, invoicing, the estimate,
templates and the technician's phone pages. Phase B: depot repair through the RMA. Phase
C: refurbishment of a serial in stock. Plans: `.ai/plans/2026-10-09-field-service-phase-a.md`,
`…-phase-b.md` and `…-phase-c.md` (their *Execution notes* record every deviation).
Module guide: `apps/erp/app/modules/service/AGENTS.md`.

## The shape

- **Customer asset** (`customerAsset`, one row per serial): customer, site, ship date,
  labor and parts warranty end dates, status In Service / At Depot / Returned, source
  Shipment or Manual.
- **Service order** (`serviceOrder`, readable id `SVC…`, sequence `serviceOrder`): one
  subject serial, one customer asset (none for a Refurbishment), and its own **Service project**
  (`project.projectType = 'Service'`, `costTreatment = 'By Coverage'`, identifier = the
  order's readable id). The project's elements are the **work tree** ("nodes"). There is
  no order line table.
- **Visit** (`serviceVisit`): technician, planned window (typed in the company's time
  zone: `ScheduleVisitModal` passes `useCompanyTimeZone()` to `DateTimePicker`'s
  `timeZone`), status, travel / arrival /
  completion stamps, notes, `signaturePath`, `signedByName`.
- **Installed component** (`customerAssetComponent`): a part a service order put in the
  asset, with its own parts warranty, and `removedDate` once a later part replaces it.
- **Billable item** (`projectBillableItem`): what a charge will bill. Status Unbilled →
  On Hold / Billed / Written Off.

At most one open order per subject serial (`serviceOrder_open_subject_key`). The New
form creates Field Visit and Refurbishment orders (`serviceOrderTypes`). A Depot Repair
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

Two pages opt out of their parent layout with a trailing `_`, so they render as full
pages: the visit page `service-order+/$id_.visits.$visitId.tsx` (not inside the order
workspace) and the template page `service-orders+/templates_.$id.tsx` (not under the
list table). The asset page is its own folder, `customer-asset+/$assetId.tsx`.

## Status: visits drive the order

`rollUpOrderStatus` (`service.models.ts`, pure, tested) gives the order's status:

1. A status the user set stays: On Hold, Completed, Closed, Cancelled.
2. **Work complete? Yes** on a completing visit gives Completed.
3. A visit Traveling, On Site, or Completed with work left gives In Progress.
4. A Scheduled visit gives Scheduled. No live visit gives Draft. Cancelled visits do
   not count.

`syncServiceOrderStatus` (`service.server.ts`) saves the roll-up and the project status
(`projectStatusOfOrder`: On Hold → On Hold, Completed → Technically Complete, Closed /
Cancelled → Closed, else Released). Call it after every visit change and every order
status change, in the same transaction. `canMoveServiceOrder` and `canMoveVisit` are
the allowed moves. `cancelServiceOrder` refuses an order while a ledger row stands (`openChargeIds`, `@carbon/utils`: not a reversal, and no row reverses it); an order whose every charge is reversed can be cancelled.

## Coverage

`resolveCoverage` (`packages/utils/src/service-coverage.ts`) decides who pays for one
charge when it posts:

1. A Refurbishment charge is Capitalized.
2. Time inside the asset's labor warranty is Warranty. A part inside the asset's parts
   warranty, or the warranty of the installed component on the node, is Warranty. An
   expense is never Warranty.
3. Else Contract, when the order names a coverage contract.
4. Else Billable.

A user override needs a reason (`coverageOverrideValidator`) and posts through
`reclass-project-coverage`, which moves the cost to the new coverage's account and leaves
the old ledger row reversed by a later row.

`resolveProjectPostingAccount` takes the coverage for a By Coverage project:
Warranty → `warrantyExpenseAccount`, Contract → the parent contract project's account
(a Statistical one falls back to Cost of Goods Sold), Billable → Cost of Goods Sold,
Capitalized → Work in Progress. A
By Coverage charge without a coverage is refused. The SQL mirror
`project_posting_account` raises for By Coverage: job completion never charges a
Service project.

## Charges post through server functions

Every charge goes through the order's charge route (`$id.charge.tsx`, `intent` = `time`,
`part`, `expense`, `reclass`, `reverse`) and a server function. Never insert ledger rows, billable
items or components directly.

| Charge | Server function | Notes |
|---|---|---|
| Time | `post-timesheet` | `logServiceTime` writes a Draft entry with the visit; a Service project's Draft entry posts at once. Journal line "Service Labor" with the Customer dimension. |
| Part | `post-project-issue` | `post-project-issue/service.ts`: billable item, installed component, replacement of the node's component, and the `Service` genealogy activity. A return reverses one whole open issue (`findServiceIssueToReturn`). |
| Expense | `post-project-expense` | `addServiceExpense`; Dr the coverage account / Cr GRNI. |
| Reclass | `reclass-project-coverage` | Refuses Capitalized either way. |
| Reverse | `post-timesheet` / `post-project-expense` | `reverseServiceCharge`, with a reason (`serviceChargeReversalValidator`). Time: `createTimesheetCorrection` to 0 hours (`correctionReason`; the correction keeps the entry's `serviceVisitId`), posted at once. Expense: `buildExpenseReversal`, a `projectExpenseEntry` with `reversalOfId` and `reversalReason`. Both post at the original's coverage and reverse its billable item. A reversal saved but not posted is posted again on the next Reverse, never written twice. |

The node drawer (`NodePeek`) shows **Reverse** on a time or expense row
(`canReverseCharge`: not a reversal, not reversed since). A part has no Reverse: it is
returned with Issue Part. Reversing the last standing charge is what lets
`cancelServiceOrder` through.

`loadServicePostingContexts` (`lib/project-posting.ts`) loads the order, its asset's
warranty dates, the labor item's price and the node's installed component in 3 queries
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
  makes Complete the next step (no visit) and offers Ship Back.

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
- **Complete** (`complete-service-order`, one transaction, from Draft, Scheduled or In
  Progress): `loadRefurbishmentCompletion` (`load.ts`) reads the WIP by node, the item cost,
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
  credit is split by node with the Project and Project Element dimensions. The serial goes
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
  asset's orders by the node's serial, else its item, else its name.

## Invoicing

`create-service-order-invoice` drafts one invoice of a Completed order's Unbilled items,
laid out by the tree (`planServiceInvoiceLines`): a heading per node, `Service` lines,
items on no node last under "Other charges", and one line per fixed-price node
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
  other costs at their amount. A fixed-price node is one line and its subtree is left
  out. `ServiceEstimatePDF` (`@carbon/documents`) is hand-built, not a template-engine
  document; the route is `file+/service-estimate+/$id[.]pdf.tsx`.
- A **service template** is a Service project with `isTemplate`, identifier
  `serviceTemplateIdentifier(id)` (`TPL-` + 6 characters of the id). `createServiceTemplate`
  makes one. Its nodes carry plan lines (`ElementPlanLines` with an `action` override).
- Building an order's tree from a template passes `includePlanLines` to
  `insertElementsFromPart`, so the plan lines come along and the estimate has prices.
  Projects' Build from part does not pass it.

## The phone pages

- **My Visits** (`service-orders+/my-visits.tsx`): the user's visits today and the next 7
  days, by the company's day.
- **The visit page**: status buttons, the unit and its last 3 orders, `NodePicker`,
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
No charges are seeded. Satellite also has a To Receive RMA (`bus-repair`) whose one line
returns SAT-1000-S013 with disposition Repair (`SalesReturnLineSpec.disposition`); the
validator keeps a Repair line out of on-hand and refuses one on a Completed return.
Satellite also seeds a Draft Refurbishment on stock serial RW010-SN-0054
(`ServiceOrderSpec` with `type: "Refurbishment"` and `serial`), which the seed puts On
Hold. The wipe deletes `customerAssetComponent`, `serviceVisit` and
`serviceOrder` before its FK-nulling pass (`serviceOrder_customer_check`).

## Known gaps

- The service tables do not broadcast, so no page declares `handle.realtime`.
- `documentSourceType` has no service order value, so order and visit files write no
  `document` row.
- A component the factory built in has no `customerAssetComponent` row, so a part issued
  in its place does not remove it.
- No browser verification of Phase A (plan Task 31), Phase B (plan Task 13) or Phase C
  (plan Task 11) yet.
- The SQL backflush (`backflush_job_materials`) applies a layer's children in turn, so a
  refurbished serial consumed by a backflush takes only its first child.
- A completed refurbishment cannot be reopened, and a refurbishment never changes the
  serial's item.
- Repair needs a Serial-tracked item. A Batch or untracked unit cannot come back for
  repair through an RMA.
- A repair the company cannot complete has no credit path: reverse the order's charges,
  void the receipt, then change the disposition.
- No precheck decides repair or return at receipt; the disposition is set before it.
