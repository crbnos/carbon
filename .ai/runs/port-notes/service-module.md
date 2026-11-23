# Port notes: service module (plan Phase 6, service)

Agent `service-module`. Worktree `kelowna-port`. Nothing committed. No `pnpm install`, no
migrations, no generators.

## Router line (for the projects agent or the orchestrator)

`apps/erp/app/modules/router.server.ts` needs:

```ts
import * as service from "./service/service.server";
// … and in `router`, between `sales` and `settings`:
  service,
```

Until that line is in, every service route fails typecheck with
`Property 'service' does not exist on type 'Api<…>'`. I checked my files with the line added
for the length of one typecheck and took it out again. The router now has only the projects
agent's change.

## 1. `service.server.ts` reshaped

`service.server.ts` now holds only `defineServiceFn` consts, plus two plain constants
(`MAX_SIGNATURE_BYTES`, `SERVICE_ELEMENT_FIELDS`) and one schema (`orderedIds`). Where its old
contents went:

| Old (`service.server.ts`) | New home |
|---|---|
| `ServiceOrderError` | `service.service.ts` |
| `createServiceOrder`, `assertNoOpenServiceOrder`, `buildServiceOrderTree`, `registerCustomerAsset`, `createServiceTemplate`, `projectStatusOfOrder`, `syncServiceOrderStatus`, `previewRefurbishmentCompletion`, `cancelServiceOrder`, `updateServiceOrderCoverageContract`, `requireServiceOrderNode`, `requireServiceWork`, `requireOwnServiceVisit`, `scheduleServiceVisit`, `setServiceVisitStatus` | `service.service.ts`. Same signatures and bodies. |
| `addServiceExpense`, `reclassServiceCharge`, `reverseServiceCharge` | `service.service.ts`. They now take `ctx: ServiceContext` in place of `(db, { companyId, userId })`, and post through `invokePosting(ctx, …)`. `reverseServiceCharge` calls `projects.service.postTimesheetEntries(ctx, …)`. `reclassServiceCharge` now also checks that the charge is on the order's project. The route used to do that check. |
| `completeServiceOrder(db, args)` wrapper | Deleted. The operation `completeServiceOrder` replaces it. |
| `type RefurbishmentCompletionPreview` | `types.ts`. `ui/ServiceOrders/CompleteRefurbishmentModal.tsx` imports it from there. |

New building blocks in `service.service.ts`. Each one replaces a check that a route used to do:

- `serviceOrderRefusal`: a `ServiceOrderError` becomes a `rule` error with its message; any other error becomes `internal` with a fallback message.
- `serviceWorkRefusal`: the same, but it also keeps the message of a plain `Error` that is not a data-layer error. The work routes showed `err.message` for these errors.
- `attemptServiceOrder`: runs a body and returns its value, or the error.
- `requireOpenServiceOrder`: replaces the route checks "The service order was not found" and "A closed or cancelled service order cannot change".
- `requireServiceBillableItem`: replaces the route check "The item is not on this service order".
- `requireServicePlanLine` and `requireServicePlanLineAccess`: replace the plan route's `ownsLine` check together with `requireServiceWork`.
- `nextServiceElementSortOrder`: the move route's read of the last sibling.
- `serviceBuildArgs`: was `toBuildArgs` in `$id.work.build.tsx`. The loader uses it too.
- `requireServiceVisitAccess(ctx, …)`: `ctx.can({ update: "service" })`, else `requireOwnServiceVisit`. It replaces `hasPermission(getUserClaims(…))` in five routes.

New constants in `service.models.ts`: `serviceOrderPropertyFields` and `serviceOrderTextFields`,
which were in `$id.details.tsx`; `serviceElementFields`, which was `SERVICE_FIELDS` in
`$projectId.update.tsx`; and `servicePlanTables` with the type `ServicePlanTable`.

Importers repointed (`git grep "service/service.server"`): every route now calls
`carbon()`. The only remaining match is `$id.charge.test.ts` (Phase 8, see below).

## 2. Operations (33)

Each operation's permission is the `requirePermissions` grant its route used.

| Operation | Permission | Route |
|---|---|---|
| `createServiceOrder` | create service | `service-orders+/new.tsx` |
| `registerCustomerAsset` | create service | `service-orders+/assets.new.tsx` |
| `updateCustomerAsset`, `updateCustomerAssetNotes` | update service | `customer-asset+/$assetId.tsx` |
| `createServiceTemplate` | create service | `service-orders+/templates.new.tsx` |
| `updateServiceOrderField` | update service | `service-order+/$id.details.tsx` (the coverage contract goes through `updateServiceOrderCoverageContract`) |
| `completeServiceOrder` | `completeServiceOrderPermission` (update service) | `run(ctx, "complete-service-order", …)` |
| `setServiceOrderStatus` | update service | `$id.status.tsx`. Completed calls `completeServiceOrder` (a nested call). Cancelled calls `cancelServiceOrder`. Any other status calls `syncServiceOrderStatus`. |
| `updateServiceBillableItem` | update service | `$id.billing.tsx` |
| `createServiceOrderInvoice` | `createServiceOrderInvoicePermission` (update service, create invoicing) | `$id.invoice.tsx`, through `run(ctx, "create-service-order-invoice", …)`. The route no longer writes. |
| `logServiceTime` | view service | `$id.charge.tsx` intent `time`: `invokePosting(ctx, "save-timesheet-entry", …, projects.saveTimesheetEntry)`, then `projects.timesheetBudgetWarning`, then `projects.postTimesheetEntries` |
| `issueServicePart` | view service + update inventory | intent `part`: `invokePosting(ctx, "post-project-issue", …)` |
| `addServiceExpense` | view service | intent `expense` |
| `reclassServiceCharge` | view service; refuses "You do not have permission to change a coverage" unless `ctx.can({ update: "service" })` | intent `reclass` |
| `reverseServiceCharge` | view service | intent `reverse` |
| `scheduleServiceVisit` | update service | `$id.visits.new.tsx` |
| `setServiceVisitStatus` | view service (a technician moves only their own visit) | `$id.visits.$visitId.status.tsx` |
| `signServiceVisit` | view service (`z.instanceof(File)`; the PNG and size checks moved in) | `$id.visits.$visitId.signature.tsx` |
| `updateServiceVisitNotes` | view service | `$id_.visits.$visitId.tsx` |
| `updateServiceNodeFixedPrice` | update service | `$id_.work.$elementId.tsx` |
| `buildServiceOrderWork` | update service | `$id.work.build.tsx` |
| `addServiceWorkElement`, `deleteServiceWorkElement`, `moveServiceWorkElement`, `orderServiceWorkElements`, `updateServiceWorkElements`, `setServiceWorkElementLabels` | update service | `service-work+/$projectId.{new,$elementId.delete,move,update}.tsx` |
| `upsertServiceWorkMaterial`, `upsertServiceWorkLabor`, `upsertServiceWorkCost`, `deleteServiceWorkPlanLine` | update service | `service-work+/$projectId.$elementId.plan.tsx` |
| `addServiceWorkComment`, `deleteServiceWorkComment` | view service | `service-work+/$projectId.$elementId.comments.tsx` |

`@mcp`: neither the branch's `service.service.ts` nor its `service.server.ts` had any `@mcp`
tag, so no operation is published. The MCP tool set did not change.

Every route action now has this shape: `validator(…).request(args, { params })`, then
`carbon(args.request)`, then return the result or `respond(...).redirect(...)`. Where the UI reads
`{ success, error: { message } }` (the fetcher modals, the billing table, grid cells with
`quiet`), the route still sends that shape, built from `result.error.message`. Rule refusals
that the form shows as field errors still map to the same field: `customerAssetId` or
`trackedEntityId`, `serialNumber`, `technicianId`.

## Other route fixes (stale imports)

- `~/modules/shared/timezone.server` → `~/modules/shared/shared.service`, in
  `customer+/$customerId.assets.tsx`, `service-orders+/{assets,my-visits,schedule}.tsx`.
- `getRecordIssueLinks` → `shared.service`, in `$id_.work.$elementId.tsx`.
- `getProjectElementPage(client, db, args)` (the new projects signature) → passes
  `getDatabaseClient()`, in `$id_.work.$elementId.tsx` and
  `service-orders+/templates_.$id_.$elementId.tsx`.
- `service+/$itemId.sales.tsx` and `$itemId.purchasing.$supplierPartId.tsx`: the branch's
  changes (`companyId` on the upsert, the warranty initial values, the FK-qualified embed) were
  already in the tree. Main's own route calls the items building block, so I left it.
- `reimbursements+/$reimbursementId.edit.tsx` (carry list A): verified, no change needed. The
  branch's `chargeNumbersError` check is in `saveReimbursement`
  (`invoicing.server.ts:1827`), which `saveAndPostReimbursement` also runs. `projectElementId`
  is in `toClientLines` and in `reimbursementLinesValidator`. The invoicing notes were correct.

## Behaviour notes (kept or changed on purpose)

- Building blocks still post as before. The postings now get the operation's `ctx`, not
  system handles. None of the posting bodies reads `ctx.actor`, `ctx.asCaller` or `ctx.can`
  (I grepped), so they run the same.
- `completeServiceOrder` and `createServiceOrderInvoice` go through `run`, as the task asked.
  For an internal failure the message is now `run`'s default ("The operation could not be
  completed."), not "Failed to complete the service order" / "Failed to create the invoice".
  A refusal keeps its own message.
- Route-side `logger.error` calls for unexpected failures are gone. `defineServiceFn` logs
  every `internal` result, with its cause.
- Order of checks: in the charge route, form validation now runs before the own-visit check
  and the reclass permission check. In the update route, "Change the labels of one element at a
  time" now runs before `requireServiceWork`. Only which refusal appears first changes.
- Work operations show a thrown message only when it does not come from the data layer
  (`serviceWorkRefusal`). Before, any `err.message` reached the user.

## Verification

- ERP `npx tsgo --noEmit`, with the router line in for the check: 0 errors in
  `modules/service/**`, `customer-asset+`, `customer+/$customerId.assets.tsx`,
  `service-order+`, `service-orders+`, `service-work+`. 42 lines remain, all in files other
  agents own: `test/database/*` and `test/release-jobs.test.ts` (Phase 8),
  `accounting+/indirect-pools.new.tsx:70` and `projects+/transfers.new.tsx:95`
  (`created.data` possibly null; both being edited in the tree), and `x+/zz-core-probe.ts`
  (somebody's scratch probe).
- Conformance (`service-fn-file`, `route-action-shape`, `no-server-code-in-client`,
  `module-shape`, `no-db-client-in-service`, `no-raw-rounding`, `no-interpolated-error-log`):
  0 violations on the 79 files above. I ran them with a throwaway tsx runner (deleted). To
  confirm the runner catches violations, I ran it on the old `service.server.ts`: 20
  `service-fn-file` hits. `baseline.json` not edited.
- `npx biome check`: clean on the same 79 files.

## Requests / open items

- **Router (projects agent / orchestrator):** add the line above.
- **Phase 8:** `routes/x+/service-order+/$id.charge.test.ts` mocks `service.server`
  (`requireServiceOrderNode`, `ServiceOrderError`, …) and `projects.service`. The route now
  calls `carbon()`, so the test has to be rewritten against the operations
  (`logServiceTime` and its order: save, budget warning, post), for example with a system
  `ServiceContext`.
- **Phase 9:** `apps/erp/app/modules/service/AGENTS.md` still says that the transactional
  writes live in `service.server.ts`. It should say: building blocks in `service.service.ts`,
  operations in `service.server.ts`, and list the operations in the table above.
  `posting-permissions.test.ts` is unaffected: the two `*Permission` constants did not change.
- The projects agent was not reachable by message during this run. I use these
  `projects.service` exports and need their names and signatures to stay as they are now:
  `saveTimesheetEntry`, `postProjectIssue`, `postTimesheetEntries(ctx, …)`,
  `timesheetBudgetWarning(client, db, …)`, `buildElementsFromPart`, `previewBuildFromPart`,
  `insertElementsFromPart`, `insertProjectElement`, `moveProjectElement`,
  `updateProjectElementOrder`, `deleteProjectElement`, `updateProjectElementField`,
  `setProjectElementLabels`, `upsert/deleteProjectElement{Material,Labor,Cost}`,
  `insert/deleteProjectElementComment`, `getProjectElementPage(client, db, …)`,
  `createTimesheetCorrection`, `postProjectExpense`, `reclassProjectCoverage`.
