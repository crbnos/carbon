# Service Module

Field service (Phases A–D): customer assets, Field Visit service orders, their visits, the work tree, coverage, billable items, invoicing, the estimate PDF, service templates, the technician phone pages, Depot Repair orders opened by the receipt of an RMA `Repair` line, Refurbishment orders on a serial in stock, and the contract project roll-up. Spec: `.ai/specs/implemented/2026-10-08-field-service.md`.

## Key Domain Concepts
- **Customer asset** — one shipped serial at a customer (`customerAsset` → `trackedEntity`), with site and labor/parts warranty end dates. `post-shipment` creates it (`upsertShippedCustomerAssets`); `registerCustomerAsset` registers a unit sold before Carbon. Status: In Service → At Depot / Returned. `warrantyStatus(asset, today)` gives In warranty / Labor ended / Expired.
- **Service order** — work on one serial. The New Service Order drawer (`service-orders+/new.tsx`) creates `Field Visit` (a customer asset's serial) and `Refurbishment` (a serial in stock, no customer; it goes On Hold until the order completes or is cancelled) (`serviceOrderTypes`). A Refurbishment completes through `complete-service-order`, which moves its WIP into the serial's cost; `CompleteRefurbishmentModal` previews it first (`$id.complete.tsx`, `previewRefurbishmentCompletion`). `post-receipt` creates `Depot Repair` orders for an RMA's `Repair` line, one per serial (`createDepotRepairOrders`, `serviceOrder.salesReturnOrderLineId`); such an order needs no visit, and its unit ships back from the RMA (`isReadyToShipBack`). The list filters all 3 (`listedServiceOrderTypes`). Status: Draft → Planned → Scheduled → In Progress → Completed → Closed, plus On Hold and Cancelled. Planned (Mark as Planned), On Hold, Completed, Closed and Cancelled are set by the user; Resume and Reopen move to Planned. The other statuses come from the visits (`rollUpOrderStatus`), which never return a released order to Draft. A Draft order's Service project is Draft: its plan-line materials are not MRP demand and it takes no charge (`requireServiceOrderNode` refuses). `canMoveServiceOrder` decides which moves a user can make.
- **Visit** — one technician trip (`serviceVisit`): Scheduled → Traveling → On Site → Completed, or Cancelled (`canMoveVisit`). Completing a visit asks **Work complete?**; Yes completes the order.
- **Work tree** — every order owns a hidden `project` with `projectType` Service and `costTreatment` By Coverage (`insertServiceOrder` / `insertServiceProject`, `@carbon/server-functions/lib/service-orders`, shared with `post-receipt`). Its `projectElement` rows are its **elements** (System / Task); the UI says "element", some code still says "node" (`ServiceWorkNode`, `NodePicker`, `getServiceNode`, `requireServiceOrderNode`). The tree can start Empty, or from a Template, the Serial or the Item (`serviceOrderStartFrom`). A Service user never sees the word "project".
- **Coverage** — who pays for a charge: Warranty, Contract, Billable or Capitalized. `resolveCoverage` (`@carbon/utils`, `service-coverage.ts`) decides it when the charge posts. Each charge writes a `projectLedger` row and a `projectBillableItem` row (Unbilled / On Hold / Billed / Written Off).
- **Service template** — a Service `project` with `isTemplate`, identifier `serviceTemplateIdentifier(id)` (`TPL-…`). Its elements and plan lines are copied into an order.

## Safety
### Always
- MUST call `syncServiceOrderStatus` after every visit or order status change, in the same transaction. `scheduleServiceVisit`, `setServiceVisitStatus` and `cancelServiceOrder` already do this. The call also sets the project's status through `projectStatusOfOrder`.
- MUST check `hasPermission(claims.permissions, "service", "update", companyId)` in every route that writes through Kysely. Kysely writes bypass RLS. When the check fails, fall back to `requireOwnServiceVisit` (technician, own open visit), as `$id.charge.tsx`, `$id_.visits.$visitId.tsx` and `$id.visits.$visitId.signature.tsx` do. The visit status route passes `technicianId: userId` to `setServiceVisitStatus` for the same reason.
- MUST call `requireServiceOrderNode` before you charge an element. It refuses a Draft, Closed or Cancelled order and an element from another order's tree.
- MUST post charges through server functions: time through `saveTimesheetEntry` (`mode: "add"`, `save-timesheet-entry`) then `postTimesheetEntries` (`post-timesheet`); parts through `postProjectIssue` (`post-project-issue`, which installs the component); expenses through `addServiceExpense` (`post-project-expense`); coverage changes through `reclassServiceCharge` (`reclass-project-coverage`); time and expense reversals through `reverseServiceCharge` (a timesheet correction through `post-timesheet`, or a `projectExpenseEntry` with `reversalOfId` through `post-project-expense`), with a reason; the invoice through `create-service-order-invoice`.
- MUST name new path helpers `serviceOrder*`, `customerAsset*`, `serviceVisit*`, `serviceTemplate*`, `serviceWork*`, `myVisits` or `serviceSchedule`. `path.to.service`, `serviceRoot`, `serviceDetails` and `services` belong to the Service ITEM page.

### Ask First
- Letting a user create a Depot Repair order by hand. A Depot Repair order exists only through its RMA line (CHECK `serviceOrder_depot_check`).
- Completing or reopening a Refurbishment any way other than `complete-service-order`. Its cost moves into the serial there, once; `syncServiceOrderStatus` refuses both.
- Changing `resolveCoverage` or the `projectModule` / `serviceVisit` rules in `packages/database/src/authz/manifest.ts`. The posting accounts and the technician's access depend on them.

### Never
- Never insert `projectLedger`, `projectBillableItem`, `customerAssetComponent` or journal rows directly. Use the server functions above. The module writes only entries, which the server functions then post: a Draft `timesheetEntry` (`saveTimesheetEntry` in `add` mode, through `save-timesheet-entry`), a `projectExpenseEntry` (`addServiceExpense`), and their reversals (`reverseServiceCharge`).
- Never schedule or move a visit with `upsertServiceVisit`. It skips the roll-up and nothing calls it. Use `scheduleServiceVisit`.
- Never open a second order on a serial that already has an open order. `serviceOrder_open_subject_key` is a unique index on `trackedEntityId` WHERE status is not Closed or Cancelled.
- Never show a Service project in Projects. `getChargeNumbers`, the MES picker and `getEntityValues` filter `projectType = 'Standard'`.

## Validation Commands
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp exec vitest run test/service-models.test.ts
pnpm --filter @carbon/server-functions test   # posting + invoice functions
```

## Key Data Model
| Table / View | Purpose |
|---|---|
| `customerAsset` / `customerAssetComponent` | Installed base and the parts installed by service. Components are written only by `post-project-issue` (`installServicePart`). |
| `serviceOrder` | The order. Has `projectId` (NOT NULL, unique), `customerContractId`, `serviceTemplateId`, `salesInvoiceId`; on a Depot Repair order, `salesReturnOrderLineId`; on a Refurbishment, `expectedSellingPrice`, `abnormalRework` and the completion columns (`capitalizedAmount`, `writeDownAmount`, `completionJournalId`, `completionCostingMethod`). |
| `serviceVisit` | Technician, planned window, travel/arrive/complete stamps, notes, signature. |
| `project` / `projectElement` | The work tree (Service type) and service templates (`isTemplate`). |
| `projectLedger` / `projectBillableItem` | Posted charges with `coverage`, and what is left to bill. |

## Key Service Functions
- `createServiceOrder(client, db, args)` (`service.server.ts`) — one transaction. A Field Visit: checks the asset is In Service and uses the customer's only Active service contract (`billingBasis = 'Schedule'`); a named project contract is refused ("A project contract cannot cover a service order."). A Refurbishment: checks the serial is serial-tracked, Available or On Hold, with no open order, and sets it On Hold. Both create the project and the order, then build the tree (`buildServiceOrderTree` → `insertElementsFromPart`, with `includePlanLines: true`).
- `completeServiceOrder(db, args)` (`service.server.ts`) — invokes `complete-service-order` for every order type; `previewRefurbishmentCompletion(db, args)` runs its reads and planner without writing.
- `updateServiceOrderCoverageContract(db, args)` (`service.server.ts`) — the only way to change an order's coverage contract: it moves the Service project's `parentProjectId` with it and refuses while a Contract charge stands, and refuses a project contract. The order form (`getServiceOrderFormOptions`) and the order page's picker offer Active service contracts only. `updateServiceOrder` never saves `customerContractId`.
- `getContractServiceOrders` (`service.service.ts`) — the orders a contract covers, with their visits embedded (`status`, `plannedStart`), for the contract page's **Service Orders** tab. The tab's Scheduled column is `nextVisitStart` (`ServiceOrdersTable.tsx`). Its Total Cost comes from `getChildServiceProjectCosts` (projects module), or from `getServiceOrderCosts` when the contract has no project.
- `getDepotRepairOrdersByReturnOrder` (`service.service.ts`) — an RMA's Depot Repair orders with their unit's status; read by the RMA layout for Ship and the explorer.
- `getServiceOrder`, `getServiceWork`, `getServiceNode`, `getServiceVisits`, `getCustomerAssets`, `getServiceBillableItems`, `getServiceEstimateInputs` (`service.service.ts`).
- Pure, tested helpers in `service.models.ts` (`apps/erp/test/service-models.test.ts`): `summarizeWork`, `buildServiceEstimate` (also used by the estimate PDF, `ServiceEstimatePDF` in `@carbon/documents`), `inTreeOrder`, `canOverrideCoverage`, `canReverseCharge`, `buildExpenseReversal`, `isReadyToShipBack`, `worstServiceOrderStatus`.

## Routes
- `x+/service-orders+/` — module pages: list, `new` (the New Service Order drawer, a sibling of the list, so it opens over an empty page), `assets`, `my-visits`, `schedule`, `templates`, `templates_.$id.tsx` and `templates_.$id_.$elementId.tsx`. The trailing `_` renders the template page in the module layout, not under the list, and the template element as its own full page, not under the template.
- Sidebar (`useServiceSubmodules`): Manage (Service Orders, Schedule, My Visits) and Setup (Customer Assets, Service Templates), a plain group that is always open. My Time opens from the avatar menu, not this sidebar.
- The work (an order's Work tab, a template's page) is the project Plan page's List: `ServiceWorkList` (`ui/Work/`) renders `ElementsHeader` and `ElementList` under `ElementRoutesProvider` with `serviceOrderElementRoutes` / `serviceTemplateElementRoutes`. An element opens as a full page, the project `ElementView` (`$id_.work.$elementId.tsx`, `templates_.$id_.$elementId.tsx`); on an order its charges (`ServiceCharges`), charge actions (`useServiceChargeActions`) and fixed price (`FixedPriceField`) come from `ui/Work/ServiceCharges.tsx`. Every element write posts to `x+/service-work+/$projectId.*` (`new`, `update`, `move`, `$elementId.delete`, `$elementId.plan`, `$elementId.comments`) under `service` permissions, each guarded by `requireServiceWork`. The template page is a standard `RecordHeader` (identifier, name, copy button at the end): no route renames or deletes a template. My Visits, the Schedule, a customer's Assets tab and the contract's Service Orders tab show `Empty` when they have no rows.
- `x+/service-order+/$id.tsx` — the order workspace, laid out as the project workspace (Brad, 2026-10-19): `ServiceOrderHeader` (the id and customer · serial, the status, the order's actions, copy and a ⋯ menu of links) over `ResizablePanels` with `ServiceOrderSidebar` as the explorer — page links Overview (`$id.details`), Work (the work's element tree under it while open), Visits and Billing — and no properties panel. Overview is two columns, as an element page: Subject, Problem, Resolution and Documents, beside `ServiceOrderProperties` (the editable fields, each saved through the Details route). Visits and Billing are sections (a small heading over a bordered box), not cards. The header shows every move the order can make as a button (`canMoveServiceOrder`; one it cannot make is hidden, one the user may not make is disabled), the next step `variant="primary"`: Mark as Planned, Complete, Resume, Ship Back, Create Invoice or Close. `$id_.work.$elementId.tsx` is an element's full page (its action saves `intent=fixedPrice`). `$id.complete.tsx` is the Refurbishment completion preview (loader only). `$id_.visits.$visitId.tsx` is the phone visit page; the trailing `_` keeps it out of the workspace.
- `x+/contract+/$id.service-orders.tsx` — the contract's Service Orders tab (needs `view: "service"`); the contract header shows the tab only with `service_view`. `ContractServiceOrders` is a read-only `Table compact` with 5 columns: Service Order, Status, Customer Asset, Scheduled, Total Cost. It shows no billed amount.
- `x+/customer-asset+/$assetId.tsx` — the asset page. `file+/service-estimate+/$id[.]pdf.tsx` — Print Estimate.

## Related Modules
- **projects** — `insertElementsFromPart`, `postTimesheetEntries` and `postProjectIssue` (`projects.server.ts`). These UI parts are reused: `ElementsHeader`, `ElementList` and `ElementView` (through `ElementRoutesProvider`), `LogTimeModal`, `IssueMaterialModal` (`variant="service"`), `BuildFromPartDrawer` (with a service `endpoint`), `useSerialOptions` (`ServiceOrderForm`'s serial `Combobox`) and `FormSection` (from `ProjectForm.tsx`, in `ServiceOrderForm`).
- **sales** — RMA `Repair` lines open Depot Repair orders; the RMA line form and explorer show them, and the credit and replacement guards skip them. `releaseServiceOrderStamps` (`sales.server.ts`) sets the billable items back to Unbilled and reopens the order when its Draft invoice is deleted.
- **datasets** — tier 04 seeds `customerAssets`; tier 09 `seedServiceWork` seeds the templates, orders and visits.

## Rules References
- `.claude/rules/field-service.md` — field service subsystem conventions.
- `.claude/rules/projects-system.md` — projects, elements, ledger, timesheets.
- `.claude/rules/authz-manifest.md` — RLS manifest, `projectModule`, owner rules.
- `.claude/rules/traceability-model.md` — tracked entities and the `Service` activity.
