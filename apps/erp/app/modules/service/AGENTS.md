# Service Module

Field service (Phase A): customer assets, Field Visit service orders, their visits, the work tree, coverage, billable items, invoicing, the estimate PDF, service templates and the technician phone pages. Spec: `.ai/specs/2026-10-08-field-service.md`.

## Key Domain Concepts
- **Customer asset** — one shipped serial at a customer (`customerAsset` → `trackedEntity`), with site and labor/parts warranty end dates. `post-shipment` creates it (`upsertShippedCustomerAssets`); `registerCustomerAsset` registers a unit sold before Carbon. Status: In Service → At Depot / Returned. `warrantyStatus(asset, today)` gives In warranty / Labor ended / Expired.
- **Service order** — work on one asset's serial. Phase A creates `Field Visit` only (`serviceOrderTypes`). Status: Draft → Scheduled → In Progress → Completed → Closed, plus On Hold and Cancelled. On Hold, Completed, Closed and Cancelled are set by the user. The other statuses come from the visits (`rollUpOrderStatus`). `canMoveServiceOrder` decides which moves a user can make.
- **Visit** — one technician trip (`serviceVisit`): Scheduled → Traveling → On Site → Completed, or Cancelled (`canMoveVisit`). Completing a visit asks **Work complete?**; Yes completes the order.
- **Work tree** — every order owns a hidden `project` with `projectType` Service and `costTreatment` By Coverage (`insertServiceOrder` / `insertServiceProject`, `@carbon/server-functions/lib/service-orders`, shared with `post-receipt`). Its `projectElement` rows are **nodes** (System / Task / Folder). The tree can start Empty, or from a Template, the Serial or the Item (`serviceOrderStartFrom`). A Service user never sees the word "project".
- **Coverage** — who pays for a charge: Warranty, Contract, Billable or Capitalized. `resolveCoverage` (`@carbon/utils`, `service-coverage.ts`) decides it when the charge posts. Each charge writes a `projectLedger` row and a `projectBillableItem` row (Unbilled / On Hold / Billed / Written Off).
- **Service template** — a Service `project` with `isTemplate`, identifier `serviceTemplateIdentifier(id)` (`TPL-…`). Its nodes and plan lines are copied into an order.

## Safety
### Always
- MUST call `syncServiceOrderStatus` after every visit or order status change, in the same transaction. `scheduleServiceVisit`, `setServiceVisitStatus` and `cancelServiceOrder` already do this. The call also sets the project's status through `projectStatusOfOrder`.
- MUST check `hasPermission(claims.permissions, "service", "update", companyId)` in every route that writes through Kysely. Kysely writes bypass RLS. When the check fails, fall back to `requireOwnServiceVisit` (technician, own open visit), as `$id.charge.tsx`, `$id_.visits.$visitId.tsx` and `$id.visits.$visitId.signature.tsx` do. The visit status route passes `technicianId: userId` to `setServiceVisitStatus` for the same reason.
- MUST call `requireServiceOrderNode` before you charge a node. It refuses a Closed or Cancelled order and a node from another order's tree.
- MUST post charges through server functions: time through `logServiceTime` then `postTimesheetEntries` (`post-timesheet`); parts through `postProjectIssue` (`post-project-issue`, which installs the component); expenses through `addServiceExpense` (`post-project-expense`); coverage changes through `reclassServiceCharge` (`reclass-project-coverage`); the invoice through `create-service-order-invoice`.
- MUST name new path helpers `serviceOrder*`, `customerAsset*`, `serviceVisit*`, `serviceTemplate*`, `myVisits` or `serviceSchedule`. `path.to.service`, `serviceRoot`, `serviceDetails` and `services` belong to the Service ITEM page.

### Ask First
- Adding a `serviceOrderType` beyond Field Visit to the UI (Depot Repair, Refurbishment). These types need the RMA and capitalization flows, which the spec defers.
- Changing `resolveCoverage` or the `projectModule` / `serviceVisit` rules in `packages/database/src/authz/manifest.ts`. The posting accounts and the technician's access depend on them.

### Never
- Never insert `projectLedger`, `projectBillableItem`, `customerAssetComponent` or journal rows directly. Use the server functions above. A Draft `timesheetEntry` (`logServiceTime`) is the only charge row the module writes itself.
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
| `serviceOrder` | The order. Has `projectId` (NOT NULL, unique), `customerContractId`, `serviceTemplateId` and `salesInvoiceId`. |
| `serviceVisit` | Technician, planned window, travel/arrive/complete stamps, notes, signature. |
| `project` / `projectElement` | The work tree (Service type) and service templates (`isTemplate`). |
| `projectLedger` / `projectBillableItem` | Posted charges with `coverage`, and what is left to bill. |

## Key Service Functions
- `createServiceOrder(client, db, args)` (`service.server.ts`) — one transaction: checks the asset is In Service, uses the customer's only Active contract, creates the project and the order, then builds the tree (`insertElementsFromPart`, with `includePlanLines: true`).
- `getServiceOrder`, `getServiceWork`, `getServiceNode`, `getServiceVisits`, `getCustomerAssets`, `getServiceBillableItems`, `getServiceEstimateInputs` (`service.service.ts`).
- Pure, tested helpers in `service.models.ts` (`apps/erp/test/service-models.test.ts`): `summarizeWork`, `buildServiceEstimate` (also used by the estimate PDF, `ServiceEstimatePDF` in `@carbon/documents`), `inTreeOrder`, `canOverrideCoverage`.

## Routes
- `x+/service-orders+/` — module pages: list, `new`, `assets`, `my-visits`, `schedule`, `templates`, and `templates_.$id.tsx`. The trailing `_` renders the template page in the module layout, not under the list.
- `x+/service-order+/$id.tsx` — the order workspace, with tabs `details`, `work`, `visits` and `billing`. `$id_.visits.$visitId.tsx` is the phone visit page; the trailing `_` keeps it out of the workspace.
- `x+/customer-asset+/$assetId.tsx` — the asset page. `file+/service-estimate+/$id[.]pdf.tsx` — Print Estimate.

## Related Modules
- **projects** — `insertElementsFromPart`, `postTimesheetEntries` and `postProjectIssue` (`projects.server.ts`). These UI parts are reused with service props: `LogTimeModal`, `IssueMaterialModal` (`variant="service"`), `BuildFromPartDrawer` (`vocabulary="node"`) and `ElementPlanLines`.
- **sales** — `releaseServiceOrderStamps` (`sales.server.ts`) sets the billable items back to Unbilled and reopens the order when its Draft invoice is deleted.
- **datasets** — tier 04 seeds `customerAssets`; tier 09 `seedServiceWork` seeds the templates, orders and visits.

## Rules References
- `.claude/rules/field-service.md` — field service subsystem conventions.
- `.claude/rules/projects-system.md` — projects, elements, ledger, timesheets.
- `.claude/rules/authz-manifest.md` — RLS manifest, `projectModule`, owner rules.
- `.claude/rules/traceability-model.md` — tracked entities and the `Service` activity.
