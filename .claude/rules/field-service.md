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
  - "packages/documents/src/pdf/ServiceEstimatePDF.tsx"
---

# Field Service

Phase A of `.ai/specs/2026-10-08-field-service.md`: customer assets, Field Visit
service orders, visits, the work tree, coverage, invoicing, the estimate, templates and
the technician's phone pages. Plan: `.ai/plans/2026-10-09-field-service-phase-a.md`
(its *Execution notes* record every deviation). Module guide:
`apps/erp/app/modules/service/AGENTS.md`.

## The shape

- **Customer asset** (`customerAsset`, one row per serial): customer, site, ship date,
  labor and parts warranty end dates, status In Service / At Depot / Returned, source
  Shipment or Manual.
- **Service order** (`serviceOrder`, readable id `SVC…`, sequence `serviceOrder`): one
  subject serial, one customer asset, and its own **Service project**
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

At most one open order per subject serial (`serviceOrder_open_subject_key`). Phase A
creates Field Visit orders only (`serviceOrderTypes`).

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
`part`, `expense`, `reclass`) and a server function. Never insert ledger rows, billable
items or components directly.

| Charge | Server function | Notes |
|---|---|---|
| Time | `post-timesheet` | `logServiceTime` writes a Draft entry with the visit; a Service project's Draft entry posts at once. Journal line "Service Labor" with the Customer dimension. |
| Part | `post-project-issue` | `post-project-issue/service.ts`: billable item, installed component, replacement of the node's component, and the `Service` genealogy activity. A return reverses one whole open issue (`findServiceIssueToReturn`). |
| Expense | `post-project-expense` | `addServiceExpense`; Dr the coverage account / Cr GRNI. |
| Reclass | `reclass-project-coverage` | Refuses Capitalized either way. |

`loadServicePostingContexts` (`lib/project-posting.ts`) loads the order, its asset's
warranty dates, the labor item's price and the node's installed component in 3 queries
for any number of charges. `buildBillableItem` builds the item: a covered item is priced
0 and its description says "(Covered by warranty)" or "(Covered by contract)".

The ERP writes through Kysely, which bypasses RLS, so the routes authorize. A user with
`update: "service"` charges any open order. A technician without it charges only
their own visit that is not Completed or Cancelled (`requireOwnServiceVisit`, the form's
`serviceVisitId`), and never reclasses. A part also needs `update: "inventory"`.

## Customer assets

- **At shipment:** `upsertShippedCustomerAssets` (`post-shipment/customer-assets.ts`) is
  one `INSERT … SELECT … ON CONFLICT` per posted shipment. The warranty ends are the ship
  date plus the item's `itemUnitSalePrice.laborWarrantyMonths` / `partsWarrantyMonths`.
  A reshipped serial moves to the new customer and starts its warranty again; its
  `source` stays. A voided shipment sets the asset Returned.
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
No charges are seeded. The wipe deletes `customerAssetComponent`, `serviceVisit` and
`serviceOrder` before its FK-nulling pass (`serviceOrder_customer_check`).

## Known gaps

- A service order has no way to reverse its time or expenses (no correction on a Service
  timesheet row, no expense reversal in the UI). Only a part return reverses a charge, so
  an order with time or an expense cannot be cancelled; complete it and write off its
  billable items.
- The service tables do not broadcast, so no page declares `handle.realtime`.
- `documentSourceType` has no service order value, so order and visit files write no
  `document` row.
- A component the factory built in has no `customerAssetComponent` row, so a part issued
  in its place does not remove it.
- No browser verification of Phase A yet (plan Task 31).
