# Service jobs and customer returns — implementation plan

**Spec:** .ai/specs/2026-10-22-service-jobs-and-returns.md
**Research:** .ai/research/2026-10-22-service-rma-postings.md, .ai/research/serial-service-cost-treatment.md
**Closest sibling:** the maintenance dispatch (`x+/maintenance+/`, `apps/erp/app/modules/resources/ui/Maintenance/`, MES `dispatch.*`). The dispatch grid copies the People board (`x+/priority+/people.tsx`).
**Branch:** projects-port-main, worktree `/Users/barbinbrad/conductor/workspaces/carbon/kelowna-port` (PR #2003). Brad moved all sessions here on 2026-10-23. Other sessions share this worktree: stage files by name only, and announce any stash, merge, rebase or reset first.
**Precedent commit:** `6335d69cf7` (on the frozen `projects-wbs-research-spec`, still reachable). Phase 0 deletes files that phase 1 copies. On the port, read the port copy BEFORE phase 0 deletes it, or read it with `git show 62fe17b63f:<port path>` (the port commit before any deletion). Use the port paths in the table below.

## The port's architecture (read first — this overrides the paths in the tasks)

This plan was written against `projects-wbs-research-spec`, where server functions lived in `packages/server-functions`. On `projects-port-main`, main's #1937 deleted that package. The task text keeps its old paths for history; use this section to find each file's real home. Line numbers in the tasks are stale; find each block by its function or case name.

**Rule A — writes go through operations.** A route action never writes. The `route-action-shape` check refuses a write in an action, including `getDatabaseClient()` writes and `invokePosting`. Every write is a `defineServiceFn` operation in `<module>.server.ts`, which wraps a building block in `<module>.service.ts`. The route calls `const api = await carbon(args.request); const result = await api.<module>.<op>(input); return respond(args.request, result)…`. Precedent: `apps/erp/app/routes/x+/maintenance+/new.tsx` → `resources.server.ts` `createMaintenanceDispatch` → `resources.service.ts` `insertMaintenanceDispatch`. Copy the PORT's version of every precedent route; it already follows Rule A.

**Rule B — a posting.** A posting building block is `export async function name(ctx: ServiceContext, raw)` with `nameInput` (zod) and `namePermission` (`satisfies PermissionRule`) next to it, in `<module>.service.ts`. It uses `ctx.asSystem.pg` (Kysely), `ctx.company.id` and `ctx.auditUserId`. Its operation in `<module>.server.ts` is `defineServiceFn({ input, permission, run(ctx, input) { return run(ctx, "<name>", () => svc.name(ctx, input)); } })` with `run` from `@carbon/api/service-tools.server`. A TSDoc comment is required. Precedent: `service.server.ts` `createServiceOrderInvoice` (before Task 1 deletes it) and `resources.service.ts` `postMaintenanceEvent`.

**Rule C — a posting the MES calls.** Add it to `PostingContract` in `packages/api/src/postings.server.ts`, to `MES_POSTINGS` in `packages/api/src/postings.ts` (its input schema goes in that file too), and to `postingPermissions` and `postings` in `apps/erp/app/modules/postings.server.ts`. The MES calls `erpPosting("<name>", { client, companyId, userId }, input)` from `apps/mes/app/services/erp.ts`. Precedent: `post-maintenance-event`, called by `apps/mes/app/services/maintenance.service.ts` `postMaintenanceLabor`.

**Rule D — one posting calling another** uses `invokePosting(ctx, "<name>", input, svc.fn, { as, schema })` from `shared.service.ts`. Precedent: `resources.service.ts` `postMaintenanceLabor`.

**Path map** (`inv.svc` = `apps/erp/app/modules/inventory/inventory.service.ts`, `shared.svc` = `apps/erp/app/modules/shared/shared.service.ts`, `proj.svc` = `apps/erp/app/modules/projects/projects.service.ts`, `T/` = `apps/erp/test/database/`):

| Plan says (`packages/server-functions/src/…`) | Port |
|---|---|
| `issue/index.ts` | `inv.svc` `issueMaterial`, `issueMaterialPermission` (rules keyed by `type`); the input union `issueInput` is in `packages/api/src/postings.ts` |
| the `maintenanceDispatch*` issue cases, `valueMaintenanceMovements`, `maintenance-return-cost.ts` | `inv.svc` (same names); test `T/issue/maintenance-return-cost.test.ts` |
| `post-maintenance-event/index.ts`, `plan.ts` | `apps/erp/app/modules/resources/resources.service.ts` `postMaintenanceEvent`, `maintenanceLaborCost`, `diffLaborGroups`; input in `packages/api/src/postings.ts`; test `T/post-maintenance-event/plan.test.ts` |
| `post-receipt/index.ts` | `inv.svc` `postReceipt` (RMA `case "Sales Return Order"`, the void path, the RMA status write) |
| `post-receipt/repair.ts` | `apps/erp/app/modules/inventory/receipt-repair.ts` |
| `post-shipment/index.ts`, `posting-lines.ts` | `inv.svc` `postShipment`, `ShipmentAccountDefaults`, `SalesShipmentLine`, `buildSalesShipmentJournal`; test `T/post-shipment/posting-lines.test.ts` |
| `post-shipment/customer-assets.ts`, `repair.ts` | `apps/erp/app/modules/inventory/shipment-customer-assets.ts`, `shipment-repair.ts` |
| `post-sales-invoice/index.ts` | `apps/erp/app/modules/invoicing/invoicing.service.ts` `postSalesInvoice`, `billedServiceLineIds` |
| `create/index.ts` | `shared.svc` `createDocument` (the RMA ship-back counts) |
| `create-service-order-invoice/` | `apps/erp/app/modules/service/service.service.ts` `createServiceOrderInvoice`; `service/service-invoice-plan.ts` (+test); op in `service.server.ts`; test `T/create-service-order-invoice/` |
| `complete-service-order/` | `service.service.ts` `completeServiceOrder`; `service/refurbishment-completion-load.ts`, `refurbishment-completion-plan.ts` (+test); op in `service.server.ts`; test `T/complete-service-order/` |
| `reclass-project-coverage/` | `proj.svc` `reclassProjectCoverage` (+ Input, Permission); test `T/reclass-project-coverage/` |
| `lib/service-orders.ts` | `apps/erp/app/modules/service/service-orders.ts`; test `T/lib/service-orders.test.ts` |
| `post-timesheet/index.ts`, `plan.ts` | `proj.svc` `postTimesheet`, `writeServiceBillableItems`; `apps/erp/app/modules/projects/timesheet-posting-plan.ts` |
| `save-timesheet-entry/`, `submit-timesheet-week/` | `proj.svc` `saveTimesheetEntry`, `submitTimesheetWeek`, `createTimesheetCorrection`, `insertTimesheetDraft`, `SaveTimesheetEntryArgs`/`invokeSaveTimesheetEntry`; inputs in `packages/api/src/postings.ts` |
| `post-project-expense/`, `post-project-issue/` | `proj.svc` `postProjectExpense`, `postProjectIssue` |
| `post-project-issue/service.ts` | `apps/erp/app/modules/projects/service-part-issue.ts` |
| `post-picking/` | `inv.svc` `postPicking` |
| `lib/project-posting.ts` | `apps/erp/app/modules/projects/project-posting.ts` |
| `lib/plan-adjustment.ts` `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` | `shared.svc` |
| `lib/post-adjustment.ts` `createAdjustmentJournal`, `valueMovement` | `shared.svc` |
| a journal reverse helper | `shared.svc` `insertNegatedJournal` |
| `lib/get-accounting-period` `resolveAccountingPeriod` | `shared.svc` |
| `getNextSequence(trx, …)` | `import * as sequence from "@carbon/database/sequence"` (as `inv.svc` does) |
| `lib/project-posting-test-fixture.ts`, `lib/sales-return-test-fixture.ts`, `local-database-test-fixture.ts` | `T/fixtures/project-posting.ts`, `T/fixtures/sales-return.ts`, `T/fixtures/local-database.ts` (`databaseTest`); also `T/fixtures/handles.ts` (`handlesOf`, `systemServiceOf`) |
| `src/<fn>/*.test.ts` | `T/<fn>/…`; a pure plan test sits beside its source file |
| `invoke.ts` registry, `package.json` exports | none: an exported `defineServiceFn` op is the registration (Rule B); plus Rule C for MES postings |
| `permissions-manifest.test.ts.snap` | `cd apps/erp && pnpm exec vitest run test/posting-permissions.test.ts -u`, then review the diff |
| `sales.server.ts` `releaseServiceOrderStamps` | `apps/erp/app/modules/sales/sales.service.ts` |
| `shipment+/lines.tracking.tsx` service branch | the `assignShipmentLineEntity` op in `inventory.server.ts` |
| `modules/service/index.ts` | does not exist; there is no barrel |
| `serverFns.system({ db: getDatabaseClient(), … }).invoke(…)` in a route | `(await carbon(request)).<module>.<op>(…)` with `respond(...)` |
| the same in the MES | `erpPosting("<name>", { client, companyId, userId }, input)` |

**Command map:**

| Plan says | Port |
|---|---|
| `--filter=@carbon/server-functions` | `--filter=erp` (add `--filter=@carbon/api` when `packages/api` changed) |
| `pnpm --filter @carbon/server-functions test` / `exec vitest run src/<fn>` | `cd apps/erp && pnpm exec vitest run test/database/<fn>` (live; load the worktree `SUPABASE_*` env first) |
| the permissions snapshot | `cd apps/erp && pnpm exec vitest run test/posting-permissions.test.ts -u` |
| after adding or removing an op | `pnpm generate:mcp`, then `pnpm check:manifest` |
| conformance | `pnpm --filter @carbon/checks exec vitest run src/run.test.ts` |

**Shared worktree:** another session (kelowna-1d) edits `production.service.ts` (the shop-time region) and `sales.service.ts` (the contract amend op). Do not edit either file until it reports that its commits landed: staging by file would take its hunks.

## Progress

Phase 0 — remove the old service module

- [x] Task 1: Remove service orders, coverage and depot repair from the server functions
- [x] Task 2: Remove service orders from the ERP, the MES and the shared packages
- [x] Task 3: Remove service orders from the demo datasets
- [x] Task 4: Take the service branch out of the authz rules
- [x] Task 5: Drop the old service tables, columns and enums
- [x] Task 6: Regenerate types and generated artifacts, and pass the phase 0 gate
- [x] Task 7: Archive the old spec and remove the old docs and rules

Phase 1 — RMA and the depot service job

- [x] Task 8: Add the new enum values
- [x] Task 9: Create the service job tables and the new columns
- [x] Task 10: Wire RLS, events, the sequence and backups for the new tables
- [x] Task 11: Add the Cost of Service account default
- [x] Task 12: Write the service models and their pure rules
- [x] Task 13: Write the service job service functions
- [x] Task 14: Add the `serviceJob*` issue types
- [x] Task 15: Create the `post-service-job` server function
- [x] Task 16: Make the RMA status follow the line resolution
- [x] Task 17: Create the job when a Service or Warranty line is received
- [x] Task 18: Ship a service unit back with no value, and post a warranty replacement to warranty
- [x] Task 19: Create the service invoice, and stop the invoice relieving stock twice
- [x] Task 20: Add the Jobs list, the New Job drawer and the navigation
- [x] Task 21: Build the job page
- [x] Task 22: Add time and parts to the job page
- [x] Task 23: Add the estimate and its PDF
- [x] Task 24: Wire Complete, Reopen, coverage change and Create Invoice
- [x] Task 25: Re-home the customer assets
- [x] Task 26: Rebuild the RMA line: return type, assets, next steps
- [x] Task 27: Seed service jobs in the demo datasets

Phase 2 — MES, My Time and the dispatch grid

- [x] Task 28: Add the MES Service queue
- [x] Task 29: Create a job from the MES
- [x] Task 30: Build the MES job page with the clock, parts and signature
- [x] Task 31: Show service jobs on My Time in the ERP
- [x] Task 32: Show service jobs on My Time in the MES
- [x] Task 33: Add drag and drop to the People matrix, through a shared matrix component
- [x] Task 34: Build the dispatch grid
- [x] Task 35: Link a charge's cost to a reimbursement or supplier invoice line

Wrap-up

- [x] Task 36: Write the docs, rules and AGENTS files
- [ ] Task 37: Fill the translations
- [ ] Task 38: Verify in the browser

## Dependencies

- Phase 0 runs in order. Tasks 1, 2 and 3 remove code while the old types still exist, so each one typechecks on its own package. Task 2 makes the ERP typecheck green again after Task 1.
- Task 4 must run before Task 5: the RLS policies read `project.projectType`, and the column cannot drop while they do.
- Phase 1 needs Task 6. Tasks 8, 9 and 10 run in order. Task 11 needs Task 10.
- Task 12 needs Task 10. Task 13 needs Task 12. Tasks 14 and 15 need Task 13 and are independent of each other.
- Task 16 needs Task 12. Tasks 17 and 18 need Tasks 14 and 16. Task 19 needs Task 15.
- Tasks 20 to 24 run in order and need Tasks 13 to 15. Task 24 also needs Task 19.
- Task 25 needs Task 13. Task 26 needs Tasks 16 to 18. Task 27 needs Tasks 17 and 24.
- Phase 2 needs phase 1. Tasks 28, 29 and 30 run in order. Tasks 31 and 32 run in order. Task 33 is independent of Tasks 28 to 32. Task 34 needs Task 33. Task 35 needs Task 22.
- Tasks 36, 37 and 38 run last, in order.

## Rules for every task

1. Read `.claude/skills/carbon-design/SKILL.md` before a UI task. Copy the named precedent file. Do not invent a layout.
2. Keep the house UI style: one toolbar row, at most one primary action, no input boxes in a table, secondary actions in a ⋯ menu, `Empty` for empty states, Lingui `t`/`<Trans>` for every string.
3. Never use JavaScript `Date`. Use `@internationalized/date` and `formatDate`. Compare `DATE` columns as `YYYY-MM-DD` strings.
4. Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers`.
5. Commit each task through `/check-and-commit`. Before a command that touches the database, load the worktree database URL: `set -a; . <(grep -E '^SUPABASE_' .env.local); set +a`.
6. Never rebuild or reset the database. Apply migrations with `pnpm db:migrate`.
7. Never construct a database client inside a `*.service.ts`. Pass `db` from the route.
8. Never query inside a loop. Collect the ids and make one `.in()` call.
9. If an assumption in a task turns out false, STOP and report. Do not improvise.

The code gate after every code task, scoped to the packages the task changed:

```bash
pnpm exec turbo run typecheck --filter=<pkg> --concurrency=1
# Expected: exit code 0, no "error TS" line.
pnpm exec biome check --no-errors-on-unmatched <changed files>
# Expected: exit code 0.
```

The package names are `erp`, `mes`, `@carbon/server-functions`, `@carbon/database`, `@carbon/utils`, `@carbon/documents`, `@carbon/ee` and `@carbon/jobs`.

---

# Phase 0 — remove the old service module

## Task 1: Remove service orders, coverage and depot repair from the server functions

**Depends on:** none
**Files:**
- Delete: `packages/server-functions/src/complete-service-order/`, `create-service-order-invoice/`, `reclass-project-coverage/`
- Delete: `packages/server-functions/src/lib/service-orders.ts` and `lib/service-orders.test.ts`
- Delete: `packages/server-functions/src/post-receipt/repair.ts`, `post-shipment/repair.ts`, `post-project-issue/service.ts`
- Delete: `post-receipt/sales-return-repair.test.ts`, `post-shipment/sales-return-repair.test.ts`, `post-picking/refurbishment-guard.test.ts`, `lib/sales-return-test-fixture.ts`
- Delete: `post-sales-invoice/post-sales-invoice.test.ts` (its only case is a service order's part)
- Modify: `packages/server-functions/src/invoke.ts` (lines 22, 28–29, 77) and `package.json` (line 13) — remove the deleted functions
- Modify: `lib/project-posting.ts` — remove coverage and service posting
- Modify: `post-timesheet/index.ts`, `post-timesheet/plan.ts`, `post-project-expense/index.ts`, `post-project-issue/index.ts`, `save-timesheet-entry/index.ts`, `submit-timesheet-week/index.ts` — remove the service branches
- Modify: `post-picking/index.ts` (lines 28, 353), `post-shipment/index.ts` (lines 55, 81–85, 223, 1929–1980, 2211–2240, 4222–4260), `post-receipt/index.ts` (lines 92, 474–480, the `repairSerials` block near 3161, 3447), `create/index.ts` (lines 2087–2118)
- Modify: `lib/project-posting-test-fixture.ts` — delete `addServiceOrder` (lines 982–1170)
- Modify tests: `post-timesheet/post-timesheet.test.ts`, `post-project-issue/post-project-issue.test.ts`, `post-project-expense/post-project-expense.test.ts`, `post-shipment/customer-assets.test.ts`, `lib/project-posting.test.ts`

**Steps:**
1. Delete every file and folder in the Delete lines above.
2. In `invoke.ts` and `package.json`, remove the entries of the 3 deleted functions.
3. In `lib/project-posting.ts`:
   1. Remove the service imports (lines 16–22).
   2. Remove `parentProjectId` (lines 40, 542, 713–768).
   3. Remove the `warrantyExpenseAccount` and Capitalized defaults (lines 84–88, 584, 657).
   4. Delete `coverageAccount` (lines 188–250) and the By Coverage branch (lines 264–272).
   5. Remove `coverage` from `buildProjectLedgerRow` (lines 444–473) and `reverseProjectLedgerRows` (lines 1085–1086).
   6. Delete lines 1098–1390 (`ServicePostingContext`, `loadServicePostingContext(s)`, `serviceChargeCoverage`, `buildBillableItem`).
   7. Remove `coverage` from `reverseBillableItem` (lines 1411, 1436) and `billableItemInsert` (line 1668).
4. In `post-timesheet/index.ts`, remove the service branches (lines 12, 39, 73–75, 116–153, 179–182, 215–241, 280–315, 534–535, 575–600, 639, 716–718, 823–826). Delete `writeServiceBillableItems` (lines 839–925).
5. In `post-timesheet/plan.ts`, remove the service fields and the "Service Labor" branch (lines 23, 44–45, 91–92, 233, 321–323, 347, 390).
6. In `post-project-expense/index.ts`, remove coverage and visits (lines 11, 30, 55–59, 110–165, 255–256, 297–326).
7. In `post-project-issue/index.ts`, remove the `coverage` input and its branches (lines 11, 35, 61–66, 92–96, 324–364, 538–562).
8. In `save-timesheet-entry/index.ts`, remove `serviceVisitId` and `coverage` (lines 52, 572, 614, 638).
9. In `submit-timesheet-week/index.ts`, remove the service-project skip (lines 123, 135).
10. In `post-picking/index.ts` and `post-shipment/index.ts`, remove `assertNoOpenRefurbishment`.
11. In `post-shipment/index.ts`, remove the Repair ship-back (lines 81–85, 1929–1980, 2211–2240, 4222–4260). Keep `customer-assets.ts` and its call.
12. In `post-receipt/index.ts`, remove the Repair branch and the depot order calls (lines 92, 474–480, near 3161, 3447). A Repair line now receives like any other line.
13. In `create/index.ts`, remove the Repair ship-back counts (lines 2087–2118).
14. Delete the service cases in the 5 test files listed above: `post-timesheet.test.ts` (cases near 236, 340), `post-project-issue.test.ts` (near 293, 418, 519), `post-project-expense.test.ts` (near 97, 227), `customer-assets.test.ts` (near 363), `project-posting.test.ts` (the "By Coverage" describe, lines 236–323).
15. Run `grep -rnE "serviceOrder|serviceVisit|coverage|projectType|parentProjectId" packages/server-functions/src`. Remove each remaining service reference. MRP "coverage" in other packages is a different word; leave it.

The line numbers come from commit `6335d69cf7`. If a block is not where the plan says, find it by its function name. If you cannot find it, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: exit code 0.
pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts -u
# Expected: the snapshot loses the 3 deleted functions; review the diff, then the test passes.
pnpm --filter @carbon/server-functions test
# Expected: all tests pass (live-database tests skip unless SUPABASE_DB_URL is local).
```

**Out of scope:** `post-shipment/customer-assets.ts`, `projectBillableItem` itself, `projectExpenseEntry` itself, ERP code.

## Task 2: Remove service orders from the ERP, the MES and the shared packages

**Depends on:** Task 1
**Files:**
- Delete: `apps/erp/app/routes/x+/service-order+/` (whole folder, with `$id.charge.test.ts`), `apps/erp/app/routes/x+/service-work+/`, `apps/erp/app/routes/x+/contract+/$id.service-orders.tsx`, `apps/erp/app/routes/file+/service-estimate+/$id[.]pdf.tsx`
- Delete: every file in `apps/erp/app/routes/x+/service-orders+/` except `assets.tsx`, `assets.new.tsx` and `_layout.tsx`
- Delete: `apps/erp/app/modules/service/ui/` folders `ServiceOrders/`, `Visits/`, `Work/`, `Billing/`, `Templates/`, and `ui/CustomerAssets/ComponentHistory.tsx`
- Delete: `apps/erp/app/modules/projects/ui/Costs/ServiceOrderCosts.tsx`, `apps/erp/test/service-models.test.ts`
- Delete: `packages/utils/src/service-coverage.ts` and its test, `packages/documents/src/pdf/ServiceEstimatePDF.tsx` and its test
- Modify: `apps/erp/app/modules/service/service.service.ts`, `service.server.ts`, `service.models.ts`, `index.ts`, `ui/ServiceStatus.tsx`, `ui/useServiceSubmodules.tsx`
- Modify: `apps/erp/app/modules/service/ui/CustomerAssets/CustomerAssetPage.tsx`, `CustomerAssetsTable.tsx`
- Modify: `apps/erp/app/routes/x+/customer-asset+/$assetId.tsx`, `apps/erp/app/routes/x+/customer+/$customerId.assets.tsx`
- Modify: `apps/erp/app/utils/path.ts`, `apps/erp/app/hooks/useModules.tsx`, `components/Layout/Topbar/CreateMenu.tsx`, `components/Layout/Topbar/Search.tsx`, `apps/erp/app/shortcuts.ts`
- Modify: the projects module and routes, the sales RMA code, and the other filters listed in the Steps
- Modify: `apps/mes/app/services/projects.service.ts`, `packages/ee/src/ramp/lib/projects.ts` and its test, `packages/ee/src/project-revenue/service.server.ts`, `packages/utils/src/index.ts`, `status-colors.ts` and its test, `packages/documents/src/pdf/index.ts`

**Steps:**
1. Delete every file and folder in the Delete lines above.
2. In `modules/service/service.service.ts`, keep only `CUSTOMER_ASSET_COLUMNS`, `getCustomerAssets`, `getCustomerAsset`, `upsertCustomerAsset` and `updateCustomerAssetNotes`. Delete everything else, including `getDepotRepairOrdersByReturnOrder`. In `CUSTOMER_ASSET_COLUMNS`, remove the `openOrders:serviceOrder…(count)` embed.
3. In `service.server.ts`, keep `registerCustomerAsset` only. In `service.models.ts`, keep the asset validators, `customerAssetStatuses`, `warrantyStatuses` and `warrantyStatus()`.
4. In `ui/ServiceStatus.tsx`, keep `CustomerAssetStatus`, `WarrantyBadge` and `BillableItemStatus`. Delete the rest. `ProjectBillableItemsTable.tsx` and `ContractLineBilling.tsx` keep importing `BillableItemStatus`.
5. In `CustomerAssetPage.tsx`, remove the orders and component sections. In `CustomerAssetsTable.tsx`, remove the `newServiceOrder` action (line 197).
6. In `useServiceSubmodules.tsx`, keep only Customer Assets. Task 20 adds Jobs and Schedule.
7. In `utils/path.ts`, delete the `serviceOrder*`, `serviceTemplate*`, `serviceVisit*`, `serviceWork*`, `serviceSchedule` and `myVisits` entries (lines 686–687, 707, 1738, 1789, 1956, 1959–1961, 2585–2608, 2614–2640). Keep the Service item paths (`service`, `serviceCosting`, `serviceDetails`, `services`, and the rest of that family).
8. In `useModules.tsx` (lines 141–144), point the Service module at `path.to.customerAssets` for now. Remove the service order entry from `CreateMenu.tsx` (lines 160–165), `shortcuts.ts` (line 142) and `Search.tsx` (lines 62, 585, 607).
9. In `modules/projects/projects.service.ts`:
   1. Remove the `.eq("projectType", "Standard")` filters (near lines 145, 174, 442, 466, 4624).
   2. In `TIMESHEET_ENTRY_COLUMNS` (near line 3484), remove `projectType` and the `serviceOrder` embed.
   3. In `createTimesheetCorrection` (near lines 3616–3622, 3679–3682), remove `serviceVisitId` and `coverage`.
   4. Delete `getChildServiceProjectCosts` (near lines 4197–4235).
10. In `projects.server.ts` (near lines 4460, 4476), remove `serviceVisitId`. In `projects.models.ts` (near lines 1741–1826), remove the `serviceActual` parameter of `buildProjectCostFigures` and its uses.
11. Remove the service rows and service costs from `ui/Costs/ProjectCostsTree.tsx`, `ui/Timesheet/useTimesheetRows.ts` (`isService` and its inputs), `TimesheetWeek.tsx` and `TimesheetGrid.tsx` (every `isService` use), and the routes `project+/$projectId.costs.tsx`, `project+/$projectId._index.tsx`, `project+/$projectId.elements.build.tsx` and `projects+/new.tsx`.
12. Remove the `projectType` filter from `settings+/time.tsx` (line 109), `production+/planning.tsx` (line 153), `purchasing+/planning.tsx` (line 152) and `accounting.service.ts` `getEntityValues` (near lines 5205–5225).
13. In the sales module:
    1. In `sales.server.ts`, delete `releaseServiceOrderStamps` and its call (near lines 449, 528–600).
    2. Remove `DepotRepairOrder` from `ui/SalesReturnOrders/types.ts`.
    3. Remove the depot order UI from `SalesReturnOrderExplorer.tsx`, `SalesReturnOrderHeader.tsx` and `SalesReturnOrderLineForm.tsx`.
    4. Remove the service orders link from `ui/Contracts/ContractHeader.tsx` (line 91).
    5. Remove the depot order reads from `sales-return-order+/$id.tsx` and `$id.$lineId.details.tsx`.
    6. Remove the service order branch from `shipment+/lines.tracking.tsx` (lines 166–176).
14. Remove "Repair" from `salesReturnDispositionType` in `sales.models.ts` (near line 1261), with its messages and `salesReturnPreReceiptDispositions` entry. Task 26 replaces it with `returnType`.
15. In `apps/mes/app/services/projects.service.ts` (lines 54, 74), remove the `projectType` filter from `getChargeNumbers`.
16. In `packages/ee/src/ramp/lib/projects.ts`, remove `projectType` (lines 80–92, 115) and update `__tests__/projects.test.ts` (lines 129–130). In `packages/ee/src/project-revenue/service.server.ts` (line 183), remove the `coverage: null` write.
17. In `packages/utils`, remove the `service-coverage` export (`index.ts` line 72) and the service order and visit colors (`status-colors.ts` lines 238–262, 513–514; test lines 42–68). Keep the `customerAsset` and `billableItem` colors.
18. In `packages/documents/src/pdf/index.ts`, remove the `ServiceEstimatePDF` exports.
19. Run `grep -rnE "serviceOrder|serviceVisit|ServiceOrder|projectType|parentProjectId|By Coverage" apps packages --include='*.ts' --include='*.tsx' | grep -vE "types.ts|swagger-docs-schema|tool-metadata|\.generated\.|migrations/"`. Remove each remaining hit, except dataset files (Task 3).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils --filter=@carbon/documents --filter=@carbon/ee --concurrency=1
# Expected: exit code 0.
pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test
# Expected: all tests pass.
cd apps/erp && pnpm exec vitest run test/
# Expected: all tests pass.
```

**Out of scope:** the migrations, generated types, the datasets, the docs.

## Task 3: Remove service orders from the demo datasets

**Depends on:** Task 2
**Files:**
- Modify: `packages/database/src/datasets/types.ts`, `data/{motor,precision,robotics,satellite}/sales.ts`, `tiers/09-accounting.ts`, `validate.ts`, `wipe.ts`, `coverage.ts`

**Steps:**
1. In `types.ts`, delete `ServiceTemplateNodeSpec`, `ServiceTemplateSpec` and `ServiceOrderSpec` (near lines 943–1015). Remove `serviceTemplates` and `serviceOrders` from `SalesData`. Keep `CustomerAssetSpec` and `customerAssets`.
2. In each `data/*/sales.ts`, delete `SERVICE_TEMPLATES` and `SERVICE_ORDERS` and their export keys. Keep `CUSTOMER_ASSETS`.
3. In `data/satellite/sales.ts`, change the "bus-repair" RMA line (near lines 950–971) from disposition Repair to Pending.
4. In `tiers/09-accounting.ts`, delete `seedServiceWork` (near lines 940–1147) and its call (near line 136).
5. In `validate.ts`:
   1. Keep the asset warranty checks in `fieldService` (near lines 2343–2395). Delete the template and order checks (near lines 2401–2527).
   2. Delete `COVERAGE.serviceOrder` (near lines 215–226).
   3. Delete the check that refuses a received Repair line with no depot order (near lines 2710–2715).
6. In `wipe.ts`, delete `SERVICE_ORDER_TABLES` and its use (near lines 105–112, 415).
7. In `coverage.ts`, delete the `serviceOrder` and `serviceVisit` floors. Keep `customerAsset`.
8. Run the validator only (layer 1 needs no database): `pnpm db:check:datasets`. If layer 2 reports `timesheetEntry` below its floor, lower that floor to the count it reports.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1
# Expected: exit code 0.
pnpm db:check:datasets
# Expected: layer 1 passes for all four datasets. Layer 2 may still fail on dropped columns until Task 5; that is expected here.
```

**Out of scope:** seeding service jobs (Task 27).

## Task 4: Take the service branch out of the authz rules

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/authz/rules.ts` (lines 123–148) — `projectModule` no longer reads `projectType`
- Modify: `packages/database/src/authz/manifest.ts` — remove `serviceOrder`, `serviceVisit` (near lines 1612–1622) and `customerAssetComponent` (near lines 328–332); fix the `projectTable` comment (near lines 94–109)
- Modify: `packages/database/src/authz/rules.test.ts` (lines 81–89), `packages/database/supabase/tests/authz-pieces.test.sql` (lines 148–233)
- Create: a generated authz migration

**Steps:**
1. Make `projectModule` return the `projects` module for every project row. Remove its `projectType` read.
2. Remove the 3 manifest entries.
3. Update the 2 test files to drop the service cases.
4. Load the worktree env. Run `pnpm db:migrate`.
5. Run `pnpm --filter @carbon/database authz migration remove-service-order-rls`.
6. Open the generated migration. Confirm that no policy reads `projectType` and that the old `serviceOrder`, `serviceVisit` and `customerAssetComponent` policies are dropped.
7. Run `pnpm db:migrate` again.

**Verify:**
```bash
grep -c "projectType" packages/database/supabase/migrations/$(ls -t packages/database/supabase/migrations | head -1)
# Expected: 0.
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all authz tests pass, including migration.test.ts.
```

**Out of scope:** dropping the column (Task 5).

## Task 5: Drop the old service tables, columns and enums

**Depends on:** Task 4
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_remove-service-orders.sql` (with `pnpm db:migrate:new remove-service-orders`)
- Modify: `packages/jobs/src/backups/renames.ts` — `TABLE_RENAMES` entries set to `null` for `serviceOrder`, `serviceVisit`, `customerAssetComponent`
- Copy from (precedent): the newest `openProjectMaterialLines` body (`20261015150413_project-material-mrp-demand.sql`, lines 116–168); the newest `project_cost_treatment()` (`20261009105739`) and `project_posting_account()` (`20261009103835`, plus any later redefinition: `grep -l "project_posting_account" packages/database/supabase/migrations/*.sql`)

**Steps:**
1. Run `pnpm db:migrate:new remove-service-orders`.
2. Write the data cleanup first:
   1. Find the child tables of `project`: `SELECT conrelid::regclass, conname FROM pg_constraint WHERE confrelid = '"project"'::regclass;`.
   2. Delete the rows of every child table that belong to a `project` with `"projectType" = 'Service'`. Delete children before parents.
   3. Delete those `project` rows, templates included.
   4. Run `UPDATE "project" SET "costTreatment" = 'Statistical' WHERE "costTreatment" = 'By Coverage';` and the same for `"projectElement"`.
   5. Run `DELETE FROM "sequence" WHERE "table" = 'serviceOrder';`.
3. Drop the view `openProjectMaterialLines`. Recreate it from the newest body without the `next_visit` LATERAL join, with `COALESCE(m."requiredDate", e."startDate", p."startDate")`.
4. Run `DROP FUNCTION IF EXISTS get_child_service_project_costs(TEXT, TEXT);`.
5. Drop these foreign keys and indexes first:
   - `salesInvoice_serviceOrder_fkey`, `salesInvoice_serviceOrderId_idx`
   - `timesheetEntry_visit_fkey`, `timesheetEntry_serviceVisitId_idx`
   - `projectExpenseEntry_visit_fkey`, `projectExpenseEntry_serviceVisitId_idx`
   - `project_parent_fkey`, `project_parent_check`, `project_parentProjectId_idx`, `project_service_treatment_check`
6. Drop the tables in this order: `serviceVisit`, `customerAssetComponent`, `serviceOrder`. Use `DROP TABLE IF EXISTS`, without `CASCADE`.
7. Drop these columns with `DROP COLUMN IF EXISTS`:
   - `project.projectType`, `project.parentProjectId`
   - `timesheetEntry.coverage`, `coverageReason`, `serviceVisitId`
   - `projectLedger.coverage`, `coverageReason`
   - `projectExpenseEntry.coverage`, `coverageReason`, `serviceVisitId`
   - `projectBillableItem.coverage`
   - `salesInvoice.serviceOrderId`
8. Restore `project_identifier_check` to `CHECK ("identifier" IS NULL OR "identifier" ~ '^[A-Z][A-Z0-9]{1,5}$')`.
9. Drop the enums: `projectType`, `serviceCoverage`, `serviceOrderType`, `serviceOrderStatus`, `serviceVisitStatus`, `serviceInvoiceDetail`.
10. Recreate `projectCostTreatment` without 'By Coverage':
    1. `ALTER TYPE "projectCostTreatment" RENAME TO "projectCostTreatment_old";`
    2. Create `"projectCostTreatment"` with the old values minus 'By Coverage'.
    3. Drop `project_costObjective_treatment_check`. Drop the column defaults of `project.costTreatment` and `projectElement.costTreatment`.
    4. Alter both columns: `TYPE "projectCostTreatment" USING "costTreatment"::text::"projectCostTreatment"`.
    5. Restore the default `'Statistical'` on `project.costTreatment`. Re-add `project_costObjective_treatment_check` from `20261011151014` line 17.
    6. Drop and recreate `project_cost_treatment()` from its newest body.
    7. `CREATE OR REPLACE` `project_posting_account()` from its newest body, so its variable takes the new type.
    8. `DROP TYPE "projectCostTreatment_old";`
11. Keep `customerAsset`, `customerAssetStatus`, `projectBillableItemStatus`, `employeeJob.defaultStorageUnitId`, the 'Service' module value and the journal values 'Service Order' and 'Project Expense'.
12. Add the 3 dropped tables to `TABLE_RENAMES` in `packages/jobs/src/backups/renames.ts` with the value `null`.
13. Load the worktree env. Run `pnpm db:migrate`.

If a `DROP` fails on a dependency the plan does not name, STOP and report the dependency. Do not add `CASCADE`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "\dt \"serviceOrder\"" -c "SELECT column_name FROM information_schema.columns WHERE table_name='project' AND column_name IN ('projectType','parentProjectId');"
# Expected: "Did not find any relation" and 0 rows.
psql "$SUPABASE_DB_URL" -c "SELECT unnest(enum_range(NULL::\"projectCostTreatment\"));"
# Expected: no 'By Coverage' row.
```

**Out of scope:** `projectBillableItem` and `projectExpenseEntry` themselves; `customerAsset`.

## Task 6: Regenerate types and generated artifacts, and pass the phase 0 gate

**Depends on:** Task 5
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`, `tool-manifest.digest.json`, `packages/ee/src/workflows/catalog/events.generated.ts`, `labels.generated.ts`, `packages/jobs/manifests/schema.json`

**Steps:**
1. Run `pnpm run generate:types`.
2. Run `pnpm generate:swagger`.
3. Run `pnpm run generate:mcp`.
4. Run the workflow catalog generator. Find its script with `grep -n "workflow-catalog" package.json packages/ee/package.json`.
5. Run `pnpm db:check:backups`. It regenerates `packages/jobs/manifests/schema.json` when the backup check passes.
6. Typecheck every touched package. Fix what fails.
7. Run the tests that must keep passing (Verify).
8. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/ee --filter=@carbon/jobs --filter=@carbon/utils --filter=@carbon/documents --concurrency=1
# Expected: exit code 0.
pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/ee test && pnpm --filter @carbon/utils test
# Expected: all pass, including create-project-billing-invoices, generate-contract-billable-items, contract-posting, posting-lines, rental-posting, always-post-invoice, post-project-burden, project-posting, post-timesheet, post-project-issue, post-project-expense.
cd apps/erp && pnpm exec vitest run test/
# Expected: all pass, including project-billing-models, projects-cost-figures, projects-timesheet-week.
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both pass.
```

**Out of scope:** new features.

## Task 7: Archive the old spec and remove the old docs and rules

**Depends on:** Task 6
**Files:**
- Move: `.ai/specs/implemented/2026-10-08-field-service.md` → `.ai/specs/archived/2026-10-08-field-service.md`, with `> Superseded by: .ai/specs/2026-10-22-service-jobs-and-returns.md` under its title
- Delete: `.claude/rules/field-service.md`, `apps/erp/app/modules/service/AGENTS.md` and `CLAUDE.md`, `docs/content/docs/reference/service-orders.mdx`
- Modify: root `AGENTS.md` (line 107), `docs/content/docs/reference/meta.json` (line 19)
- Modify: `.claude/rules/projects-system.md` (the "Service projects" section, lines 285–317, and the mentions at 186, 227, 588, 689, 696, 775, 822–827, 958), `project-control.md` (line 81), `authz-manifest.md` (lines 65–69), `traceability-model.md` (lines 75–83, 126–127), `ramp-integration.md` (lines 276–277), `inventory-system.md` (lines 61, 285–286), `onboarding-company-templates.md` (`SERVICE_ORDER_TABLES`)
- Modify: `apps/erp/app/modules/projects/AGENTS.md` (lines 20, 159), `sales/AGENTS.md` (line 61), `production/AGENTS.md` (lines 18, 108)
- Modify: `docs/content/docs/reference/rmas.mdx`, `projects.mdx`, `project-billing.mdx`, `planning.mdx`, `contracts.mdx`, `docs/content/guides/project-to-cash.mdx`, `docs/content/src/glossary/terms.ts` (lines 2607, 2627, 2661, 2667)

**Steps:**
1. Move the old spec and add the superseded line.
2. Delete the 4 files.
3. Point the root `AGENTS.md` "Field service" row at `.ai/specs/2026-10-22-service-jobs-and-returns.md` until Task 36 writes the new rule.
4. Remove `service-orders` from `meta.json`.
5. In each rule, AGENTS file and docs page, delete the sentences about service orders, visits, service projects, coverage per charge and depot repair. Delete; do not rewrite. Task 36 writes the new text.
6. In `terms.ts`, delete the service order and visit terms. Keep "customer asset".

**Verify:**
```bash
grep -rniE "service order|serviceOrder|service visit" .claude/rules apps/erp/app/modules/*/AGENTS.md docs/content AGENTS.md | grep -v "archived/"
# Expected: no output.
pnpm --filter docs typecheck
# Expected: exit code 0.
```

**Out of scope:** writing the new docs (Task 36).

---

# Phase 1 — RMA and the depot service job

## Task 8: Add the new enum values

**Depends on:** Task 7
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-job-enum-values.sql` (with `pnpm db:migrate:new service-job-enum-values`)
- Copy from (precedent): `20251231151200_add-maintenance-consumption-to-item-ledger-document-type.sql`, `20260929181534_maintenance-labor-journal.sql`

**Steps:**
1. Run `pnpm db:migrate:new service-job-enum-values`.
2. Write these lines. A new enum value cannot be used in the transaction that adds it, so this migration holds nothing else.
   ```sql
   ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Service Job Consumption';
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Job Consumption';
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Job';
   ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Service Job';
   ALTER TYPE "salesReturnOrderStatus" ADD VALUE IF NOT EXISTS 'In Progress' BEFORE 'Completed';
   ```
3. Load the worktree env. Run `pnpm db:migrate`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT unnest(enum_range(NULL::\"salesReturnOrderStatus\"));"
# Expected: Draft, To Receive, In Progress, Completed, Cancelled.
```

**Out of scope:** tables.

## Task 9: Create the service job tables and the new columns

**Depends on:** Task 8
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-jobs.sql` (with `pnpm db:migrate:new service-jobs`)
- Copy from (precedent): `20251216021152_maintenance.sql` (tables near line 287, sequence near lines 717–736); `20261009153156_field-service-module.sql` lines 45–125 (an account default column with its seeded account)

**Steps:**
1. Run `pnpm db:migrate:new service-jobs`.
2. Create the enums `serviceJobStatus`, `serviceCoverage`, `serviceWorkSite`, `serviceBillingMethod`, `serviceJobPriority`, `serviceEstimateStatus`, `serviceJobItemLineType` and `returnType`. Use the values in the spec's Data Model section. Guard each with `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
3. Create `serviceJob`, `serviceJobEstimateLine`, `serviceJobTime`, `serviceJobItem` and `serviceJobAssignment` from the spec's SQL. Each table gets:
   - `"id" TEXT NOT NULL DEFAULT id('<prefix>')` with the prefixes `sj`, `sjel`, `sjt`, `sji`, `sja`.
   - `"companyId"`, the composite PK `("id", "companyId")` and an FK to `company` `ON DELETE CASCADE`.
   - The audit columns `createdBy` (NOT NULL), `createdAt`, `updatedBy`, `updatedAt`, plus `customFields` on `serviceJob`.
   - An FK to `serviceJob` `ON DELETE CASCADE` on each child table.
   - An index on `companyId` and on every FK column.
4. Add the `serviceJob` foreign keys: `customer`, `customerLocation`, `customerContact`, `customerAsset`, `item` (both `itemId` and `serviceItemId`), `trackedEntity`, `location`, `salesReturnOrderLine`, `salesInvoice`, `journal` (`completionJournalId`), `user` (`assignee`). Use `ON DELETE SET NULL` for optional columns, `RESTRICT` for `customerId` and `locationId`.
5. Add the child FKs: `employeeId` → `user`, `laborItemId` and `itemId` → `item`, `storageUnitId` → `storageUnit`.
6. Add `serviceJobItem."reimbursementLineId"` and `"purchaseInvoiceLineId"` now, nullable, with `ON DELETE SET NULL` FKs. Task 35 uses them.
7. Add the 2 partial unique indexes from the spec: one live job per RMA line, and one running clock per employee.
8. Alter `salesReturnOrderLine`: add `returnType`, `customerAssetId` (FK `ON DELETE SET NULL`), `problem`, `quantityShipped`, and the quantity CHECK from the spec.
9. Add `salesOrderLine."salesReturnOrderLineId"` and `salesInvoiceLine."serviceJobId"`, both nullable with `ON DELETE SET NULL` FKs and indexes.
10. Add `accountDefault."costOfServiceAccount"` with an FK to `account` `ON DELETE RESTRICT` and an index. Copy the idempotent FK block from `20261009153156_field-service-module.sql`. Do not seed an account; the default falls back to COGS.
11. Seed the sequence for every company:
    ```sql
    INSERT INTO "sequence" ("table","name","prefix","suffix","next","size","step","companyId")
    SELECT 'serviceJob','Service Job','SJ',null,0,6,1,"id" FROM "company" ON CONFLICT DO NOTHING;
    ```
12. Load the worktree env. Run `pnpm db:migrate`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "\d \"serviceJob\"" | head -5
# Expected: the table exists.
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM \"sequence\" WHERE \"table\"='serviceJob';"
# Expected: one row per company.
```

**Out of scope:** RLS (Task 10), types (Task 10).

## Task 10: Wire RLS, events, the sequence and backups for the new tables

**Depends on:** Task 9
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — `company("service")` rules for the 5 tables
- Modify: `packages/database/src/event-system/attachments.ts` — copy the `maintenanceDispatch` entry (near lines 205–212) for `serviceJob`; `{ events: true }` for the 4 child tables
- Modify: `packages/database/src/event-system/handlers/sync_advance_document_sequence.sql` — `WHEN 'serviceJob' THEN 'serviceJobId'`
- Modify: `packages/database/src/seed-data.ts` — the `serviceJob` sequence in `sequences` (near line 261; maintenance is near line 319)
- Modify: `packages/jobs/src/backups/` — the new tables, if the backup check asks for them
- Create: a generated authz migration

**Steps:**
1. Add `serviceJob`, `serviceJobEstimateLine`, `serviceJobTime`, `serviceJobItem` and `serviceJobAssignment` to the manifest as `company("service", { create: "employee", update: "employee" })`. That copies the maintenance rule, so a technician without `service_update` can log time from the MES.
2. Add the 5 attachments. `serviceJob` gets `after: ["sync_advance_document_sequence"]`, `events: true` and `statement: ["broadcast_table_changes"]`.
3. Add the sequence CASE line to the handler file.
4. Add the sequence to `seed-data.ts`.
5. Load the worktree env. Run `pnpm db:migrate`.
6. Run `pnpm --filter @carbon/database authz migration service-jobs-rls`.
7. Run `pnpm db:migrate`.
8. Run `pnpm run generate:types`.
9. Run `pnpm db:check:backups`. If it names a new table, follow its message.

**Verify:**
```bash
grep -c "serviceJobAssignment" packages/database/src/types.ts
# Expected: a number above 0.
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all pass.
pnpm --filter @carbon/checks test
# Expected: all pass, including document-sequence-synced.
```

**Out of scope:** UI.

## Task 11: Add the Cost of Service account default

**Depends on:** Task 10
**Files:**
- Modify: `packages/database/src/accounting-cutover/shared.ts` — `ACCOUNT_DEFAULT_COLUMNS` (near lines 65–138)
- Modify: `packages/database/src/account-import.ts` — `ROLE_NAMES` (near lines 51–126)
- Modify: `packages/database/src/journal-posting-status.ts` — `OPTIONAL_DEFAULT_ROLES` (near line 72), `DEFAULT_FALLBACKS` (near line 105), `OPTIONAL_DEFAULT_LABELS` (near line 124)
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `costOfServiceAccount: z.string().optional()` next to `projectExpenseAccount` (near line 583)
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — a field next to `warrantyExpenseAccount` (near line 567)
- Copy from (precedent): the `projectExpenseAccount` entries in the same files

**Steps:**
1. Add `costOfServiceAccount` wherever `projectExpenseAccount` appears in the 3 database files.
2. Set its fallback: `costOfServiceAccount: "costOfGoodsSoldAccount"` in `DEFAULT_FALLBACKS`.
3. Label it "Cost of Service" in `OPTIONAL_DEFAULT_LABELS` and `ROLE_NAMES`.
4. Add the optional validator field.
5. Add the form field: label "Cost of Service", description "Labor and parts on billable and contract service jobs. Falls back to Cost of Goods Sold.", `badgeType: "Expense"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --concurrency=1
# Expected: exit code 0.
pnpm --filter @carbon/database exec vitest run src/journal-posting-status src/account-import src/accounting-cutover
# Expected: all pass.
```

**Out of scope:** posting with the account (Tasks 14, 15).

## Task 12: Write the service models and their pure rules

**Depends on:** Task 10
**Files:**
- Modify: `apps/erp/app/modules/service/service.models.ts`
- Create: `packages/utils/src/service-job.ts`, `packages/utils/src/service-job.test.ts`
- Modify: `packages/utils/src/index.ts` — export the new file
- Copy from (precedent): `apps/erp/app/modules/resources/resources.models.ts` (`maintenanceDispatchValidator`, `maintenanceDispatchEventValidator`, `maintenanceDispatchItemValidator`, `MAINTENANCE_DISPATCH_LOCKED_STATUSES`, `isMaintenanceDispatchLocked`)

**Steps:**
1. In `packages/utils/src/service-job.ts`, write 5 pure functions. The server functions and both apps use them.
   1. `coverageAccountRole(coverage)`: Billable and Contract → `"costOfServiceAccount"`; Warranty → `"warrantyExpenseAccount"`.
   2. `suggestCoverage({ laborWarrantyEndDate, partsWarrantyEndDate }, asOfDate)`: `"Warranty"` when either date is on or after `asOfDate` (string compare of `YYYY-MM-DD`), else `"Billable"`.
   3. `needsAcceptedEstimate(job)`: true when `billingMethod === "Fixed Price"` or `salesReturnOrderLineId` is set with coverage Billable. False when `repairable === false`. False for Warranty and Contract.
   4. `canComplete(job)`: false when `needsAcceptedEstimate(job)` and `estimateStatus !== "Accepted"`.
   5. `serviceJobPrimaryAction(job)`: the table in the spec's UI Changes section. It returns `"Start" | "Send Estimate" | "Complete" | "Record Response" | "Create Invoice" | null`.
2. Export `SERVICE_JOB_LOCKED_STATUSES = ["Completed", "Invoiced", "Cancelled"]` and `isServiceJobLocked(status)`.
3. Write tests for each function: both coverage roles, a warranty date before, on and after the as-of date, the 4 estimate cases (Fixed Price, RMA Billable, not repairable, Time and Materials), and every primary action row.
4. In `service.models.ts`, add the zod validators. Copy the maintenance validators' shape:
   - `serviceJobValidator` (create and update)
   - `serviceJobEstimateLineValidator`, `serviceJobTimeValidator`, `serviceJobItemValidator` (Charge lines), `serviceJobAssignmentValidator`
   - `serviceJobStatusValidator` (the action and the target status)
   - `serviceJobEstimateResponseValidator` (Accepted or Declined, `estimateRespondedBy`)
5. Export the enum arrays (`serviceJobStatuses`, `serviceCoverages`, `serviceWorkSites`, `serviceBillingMethods`, `serviceJobPriorities`, `returnTypes`) typed from `Database["public"]["Enums"]`.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/service-job.test.ts
# Expected: all pass.
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=erp --concurrency=1
# Expected: exit code 0.
```

**Out of scope:** service functions.

## Task 13: Write the service job service functions

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/modules/service/service.service.ts`, `service.server.ts`, `index.ts`, `types.ts`
- Copy from (precedent): `apps/erp/app/modules/resources/resources.service.ts` (`getMaintenanceDispatches`, `getMaintenanceDispatch`, `getMaintenanceDispatchEvents`, `getMaintenanceDispatchItems`, `insertMaintenanceDispatch`, `upsertMaintenanceDispatch`, `upsertMaintenanceDispatchEvent`, `deleteMaintenanceDispatchItem`)

**Steps:**
1. Write the reads, each `(client, …)` returning `{ data, error }`:
   - `getServiceJobs(client, companyId, args)` with `setGenericQueryFilters`, `{ count: "exact" }`, and the customer, asset and assignee embeds.
   - `getServiceJob(client, id)`, `getServiceJobTime(client, serviceJobId)`, `getServiceJobItems(client, serviceJobId)`, `getServiceJobEstimateLines(client, serviceJobId)`.
   - `getServiceJobAssignmentsRange(client, companyId, { startDate, endDate, locationId })`.
   - `getServiceBacklog(client, companyId, locationId)`: open jobs (not Completed, Invoiced or Cancelled) with no assignment.
   - `getServiceJobsByAsset(client, customerAssetId)`.
2. Write the writes, each `(client, …)` returning `{ data, error }`, copying the maintenance upsert shape (`createdBy` or `id` branch, `sanitize()`, `.select("id").single()`):
   - `upsertServiceJobEstimateLine`, `deleteServiceJobEstimateLine`
   - `upsertServiceJobTime`, `deleteServiceJobTime`
   - `upsertServiceJobItem` (Charge lines only; a Part goes through `issue`)
   - `upsertServiceJobAssignment`, `moveServiceJobAssignment`, `deleteServiceJobAssignment`
   - `updateServiceJob` (header fields only; not `status`, `coverage` or the posting columns)
3. Every write that touches a child row or the header refuses when `isServiceJobLocked(job.status)` is true. Return `{ data: null, error: { message } }`. Time and parts check it too.
4. In `service.server.ts`, write `insertServiceJob(client, input)`. It takes the next number with `getNextSequence` (copy `insertMaintenanceDispatch`), sets `coverage` from `suggestCoverage` when an asset is given and no coverage is passed, and inserts the row.
5. Tag the reads and the simple writes with `@mcp` verbs, copying the maintenance tags.
6. Run `pnpm run generate:mcp`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
pnpm --silent check:manifest
# Expected: "digest current".
```

**Out of scope:** posting (Tasks 14, 15).

## Task 14: Add the `serviceJob*` issue types

**Depends on:** Task 13
**Files:**
- Modify: `packages/server-functions/src/issue/index.ts` — 3 new zod members, permission rules, 3 cases, and `valueServiceJobMovements`
- Modify: `packages/server-functions/src/lib/plan-adjustment.ts` — add 'Service Job Consumption' to `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` (near lines 34–50)
- Create: `packages/server-functions/src/issue/service-job.test.ts`
- Copy from (precedent): the maintenance members (near lines 1315–1349), permissions (near lines 2312–2315), cases (`maintenanceDispatchInventory` near 5163, `maintenanceDispatchTrackedEntities` near 5275, `maintenanceDispatchUnconsume` near 5663), and `valueMaintenanceMovements` (near lines 1452–1630); `issue/maintenance-return-cost.ts`

**Steps:**
1. Add `serviceJobInventory`, `serviceJobTrackedEntities` and `serviceJobUnconsume` to the input union. Each takes `serviceJobId` instead of `maintenanceDispatchId`.
2. Set their permissions to `{ update: "service" }`.
3. Copy the 3 maintenance cases. Replace `maintenanceDispatchItem` with `serviceJobItem` (`lineType: "Part"`), and `documentType` with 'Service Job Consumption'.
4. Write `valueServiceJobMovements` from `valueMaintenanceMovements`. Its `offsetAccount` is the coverage account: `resolveDefaultAccount(accountDefaults, coverageAccountRole(job.coverage), postingStatus)`.
5. Store each issued line's unit cost on `serviceJobItem.unitCost`.
6. Refuse an issue when the job is locked (`isServiceJobLocked`).
7. Write live-database tests with `databaseTest`:
   1. Issue 1 part (unit cost 70) to a Billable job. Expect a journal Dr Cost of Service 70 / Cr Inventory 70, and `serviceJobItem.unitCost` 70.
   2. Issue to a Warranty job. Expect the debit on `warrantyExpenseAccount`.
   3. Unconsume. Expect the reverse lines at the issued cost.
   4. Issue to a Completed job. Expect a refusal.
8. Update the permissions snapshot: `pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts -u`. Review the diff.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/issue
# Expected: all pass (live-database cases need the local SUPABASE_DB_URL loaded).
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: exit code 0.
```

**Out of scope:** the ERP and MES routes that call it.

## Task 15: Create the `post-service-job` server function

**Depends on:** Task 13
**Files:**
- Create: `packages/server-functions/src/post-service-job/index.ts`, `plan.ts`, `plan.test.ts`, `post-service-job.test.ts`
- Modify: `packages/server-functions/src/invoke.ts` (registry), `package.json` (exports), the permissions snapshot
- Copy from (precedent): `packages/server-functions/src/post-maintenance-event/index.ts` and `plan.ts`

**Steps:**
1. Define `post-service-job` with `defineServerFn`. Input is a discriminated union on `action`:
   - `{ action: "complete", serviceJobId, signedByName?, signaturePath? }`
   - `{ action: "reopen", serviceJobId }`
   - `{ action: "set-coverage", serviceJobId, coverage }`
   Permissions: `{ update: "service" }`.
2. Run every action in one `db.transaction()`. Lock the job row `forUpdate`. Read `journalPostingStatus(trx, companyId)` and `accountDefault`.
3. **complete:**
   1. Refuse unless the status is In Progress, On Hold or Open.
   2. Refuse when `canComplete(job)` is false. Message: "This job needs an accepted estimate before it can be completed."
   3. Read the job's `serviceJobTime` rows and their labor items' `itemCost.unitCost` in one query.
   4. Refuse when a row's labor item has no cost, or a cost of 0. Name the item in the message.
   5. Refuse when a clock is still running (`startTime` set, `endTime` null). Message: "Stop the running clock first."
   6. In `plan.ts`, build the journal lines: one pair per labor item, Dr the coverage account / Cr `laborAbsorptionAccount`, amount = Σ hours × unit cost. Use `resolveDefaultAccount` for both.
   7. Write the journal with `createAdjustmentJournal` (`sourceType: "Service Job"`, line `documentType: "Service Job"`, `documentId` = the job id). Resolve the period with `resolveAccountingPeriod` when the status is Posted.
   8. Write `unitCost` on each time row. Set `status = "Completed"`, `completedAt`, `completionJournalId`, and the signature fields.
   9. Skip the journal when the total is 0.
   10. Call `refreshSalesReturnOrderStatus` (Task 16) when the job has `salesReturnOrderLineId`.
4. **reopen:**
   1. Refuse unless the status is Completed. An Invoiced job cannot reopen.
   2. Write a reversing journal: every line of `completionJournalId` with debit and credit swapped. First grep `packages/server-functions/src/lib` for an existing reverse or void helper, and use it when one exists.
   3. Clear `completionJournalId`, `completedAt` and the time rows' `unitCost`. Set the status to In Progress.
5. **set-coverage:**
   1. Refuse when the job is locked.
   2. Read the cost of the parts issued to the job: the `costLedger` rows of its 'Service Job Consumption' item ledger entries.
   3. When that cost is not 0, write one journal: Dr the new coverage account / Cr the old one.
   4. Update `coverage`.
6. In `plan.test.ts`, test the pure line builder: 2 labor items, a zero total, and the reclass pair.
7. In `post-service-job.test.ts`, write live-database tests for the acceptance criteria in the spec's phase 1 list: complete (Dr Cost of Service 60 / Cr Labor Absorption 60 for 1.5 h × 40), reopen (reversal), a Warranty job (warranty account), set-coverage with an issued part (reclass journal), and the estimate refusal.
8. Register the function in `invoke.ts` and `package.json`. Update the permissions snapshot with `-u` and review the diff.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/post-service-job
# Expected: all pass.
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: exit code 0.
```

**Out of scope:** the invoice (Task 19).

## Task 16: Make the RMA status follow the line resolution

**Depends on:** Task 12
**Files:**
- Modify: `packages/utils/src/status.ts` — `getSalesReturnOrderStatus` (near line 143)
- Modify: `packages/utils/src/status.test.ts` (create the cases if the file has none for it)
- Create: `packages/server-functions/src/lib/sales-return-status.ts` — `refreshSalesReturnOrderStatus(trx, salesReturnOrderId, companyId)`
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — the callers near lines 7659 and 7872; add `refreshSalesReturnOrderStatus(client, id, companyId)`

**Steps:**
1. Extend the line input of `getSalesReturnOrderStatus` with `returnType`, `disposition`, `quantityShipped`, `jobStatus` (the line's job, or null) and `hasReplacement`.
2. A line is **received** when `isReturnLineSettled` holds (unchanged).
3. A line is **resolved** when:
   - Return to Stock: it is received and `disposition !== "Pending"`.
   - Service or Warranty: it is received, and `jobStatus` is Completed, Invoiced or Cancelled, and one of these holds:
     - `quantityShipped >= 1`;
     - `disposition === "Scrap"`;
     - `hasReplacement`, with `disposition` Scrap or Use As Is.
4. The status is To Receive until every line is received, In Progress until every line is resolved, then Completed. Keep the return shape `{ status, allReceived }` and add `allResolved`.
5. Write tests: a stock line Pending (In Progress), a stock line disposed (Completed), a service line received with an open job (In Progress), a service line shipped back (Completed), a warranty line replaced and scrapped (Completed), and a line not yet received (To Receive).
6. Write `refreshSalesReturnOrderStatus` for the server functions. It reads the lines, their jobs, and whether a `salesOrderLine` names each line, in 3 queries. Then it writes the status when it changed. Never change a Draft or Cancelled RMA.
7. Write the ERP twin in `sales.service.ts` with the same reads through `client`. Use it where the old status was computed.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/status.test.ts
# Expected: all pass.
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/server-functions --filter=erp --concurrency=1
# Expected: exit code 0.
```

**Out of scope:** the receipt and shipment changes (Tasks 17, 18).

## Task 17: Create the job when a Service or Warranty line is received

**Depends on:** Tasks 14, 16
**Files:**
- Create: `packages/server-functions/src/post-receipt/service-return.ts`
- Modify: `packages/server-functions/src/post-receipt/index.ts` — the `case "Sales Return Order"` (near line 2957) and its status write (near lines 3478–3502); the void path (near lines 474–490, 560–581)
- Create: `packages/server-functions/src/post-receipt/service-return.test.ts`
- Copy from (precedent): `git show 6335d69cf7:packages/server-functions/src/post-receipt/repair.ts` (`createDepotRepairOrders`, `voidDepotRepairOrders`) and the old Repair branch, `git show 6335d69cf7:packages/server-functions/src/post-receipt/index.ts` lines 3158–3201

**Steps:**
1. In `post-receipt/index.ts`, select `returnType`, `customerAssetId` and `problem` with the RMA lines.
2. Treat a line with `returnType` Return for Service or Return for Warranty like the old Repair branch: no item ledger value, no cost ledger, no journal. The tracked entity stays Consumed.
3. In `service-return.ts`, write `createServiceJobsForReturn(trx, { lines, rma, receipt, companyId, userId })`. For each such line:
   1. Ensure its customer asset exists (copy the asset part of `createDepotRepairOrders`). Set the asset status At Depot.
   2. Skip the line when a live job already names it.
   3. Take a number with `getNextSequence(trx, "serviceJob", companyId)`.
   4. Insert `serviceJob`: coverage Billable for Return for Service, Warranty for Return for Warranty; status Open; `workSite` Depot; `locationId` = the receipt's location; `customerId`, `customerLocationId`, `customerContactId` from the RMA; `itemId`, `trackedEntityId`, `customerAssetId` and `problem` from the line; `salesReturnOrderLineId`.
   5. Write a `trackedActivity` row the way the old code did.
4. Call it after the receipt's lines post. Then call `refreshSalesReturnOrderStatus`. Delete the old hand-written status block.
5. In the void path, write `voidServiceJobsForReturn`. Cancel a job only when it has no time, no issued parts and status Open. Otherwise refuse the void with "Service job SJ… has work on it. Cancel the job first." Set the asset back In Service.
6. Write live-database tests:
   1. An RMA with one Return to Stock line and one Return for Service line. After receipt, the stock line has its item ledger value. The service line has none. One Billable job exists, Open, Depot. The RMA is In Progress.
   2. A Return for Warranty line creates a Warranty job.
   3. Voiding the receipt before any work cancels the job.
   4. Voiding after time was logged refuses.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/post-receipt
# Expected: all pass.
```

**Out of scope:** the RMA UI (Task 26).

## Task 18: Ship a service unit back with no value, and post a warranty replacement to warranty

**Depends on:** Tasks 14, 16
**Files:**
- Create: `packages/server-functions/src/post-shipment/service-return.ts`, `service-return.test.ts`
- Modify: `packages/server-functions/src/post-shipment/index.ts` — the RMA case (near lines 1830–2258), its void case (near line 3998), the sales order lines load (near lines 236–262), `journalShipmentLines.push` (near lines 591–603)
- Modify: `packages/server-functions/src/post-shipment/posting-lines.ts` — `ShipmentAccountDefaults` (near line 40), `SalesShipmentLine` (near line 49), the COGS debit in `buildSalesShipmentJournal` (near lines 191–196)
- Modify: `packages/server-functions/src/create/index.ts` — the RMA shipment line counts (where Task 1 removed the Repair counts)
- Copy from (precedent): `git show 6335d69cf7:packages/server-functions/src/post-shipment/repair.ts` (`loadRepairLineIds`, `shipRepairedUnits`, `unshipRepairedUnits`) and the old skip at lines 1929–1985 of `post-shipment/index.ts` in that commit

**Steps:**
1. In `service-return.ts`, write `loadServiceReturnLineIds` (lines with `returnType` Return for Service or Return for Warranty), `shipServiceUnits` and `unshipServiceUnits`. Copy the old repair versions. Key on `returnType`, not `disposition`.
2. In the RMA shipment case, skip value for those lines (no item ledger value, no journal), as the old Repair skip did. Set the asset In Service.
3. On post, add the shipped quantity to `salesReturnOrderLine.quantityShipped` for every RMA line on the shipment. On void, subtract it. Then call `refreshSalesReturnOrderStatus`.
4. In `create/index.ts`, let a Service or Warranty line ship 1 unit when its job is Completed or Invoiced and `disposition` is not Scrap.
5. Add `warrantyExpenseAccount` to `ShipmentAccountDefaults`. Add `cogsAccountOverride?: string` to `SalesShipmentLine`. Use it in place of `costOfGoodsSoldAccount` when set.
6. Select `salesReturnOrderLineId` with the sales order lines. Read those RMA lines' `returnType` in one query. Set `cogsAccountOverride` to `warrantyExpenseAccount` for a line whose RMA line is Return for Warranty.
7. Confirm the void path builds its reversal with the same builder. If it does not, apply the same override there.
8. Write tests:
   1. Pure, in `posting-lines.test.ts`: a line with `cogsAccountOverride` debits that account.
   2. Live: a replacement sales order line that names a Warranty RMA line posts Dr Warranty Expense / Cr Inventory on shipment.
   3. Live: shipping a repaired unit back writes no journal, sets `quantityShipped` to 1, and sets the asset In Service.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/post-shipment src/create
# Expected: all pass.
```

**Out of scope:** creating the replacement order (Task 26).

## Task 19: Create the service invoice, and stop the invoice relieving stock twice

**Depends on:** Task 15
**Files:**
- Create: `packages/server-functions/src/create-service-invoice/index.ts`, `plan.ts`, `plan.test.ts`, `create-service-invoice.test.ts`
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — `billedServiceLineIds` (near lines 695–709)
- Modify: `invoke.ts`, `package.json`, the permissions snapshot
- Copy from (precedent): `git show 6335d69cf7:packages/server-functions/src/create-service-order-invoice/index.ts` and `plan.ts`

**Steps:**
1. Define `create-service-invoice` with input `{ serviceJobId }` and permissions `{ update: "service", create: "invoicing" }`.
2. Copy the precedent's flow: lock the job, read the customer payment terms, the customer and the company, take the exchange rate, take the next `salesInvoice` number, insert the `opportunity`, the Draft `salesInvoice`, the `salesInvoiceShipment`, then the lines.
3. Refuse unless the job is Completed and Billable.
4. In `plan.ts`, build the lines:
   - Time and Materials: one "Service" line per labor item with Σ billable hours × the labor item's `unitSalePrice`; one "Service" line per billable Part (`itemId` = the part, quantity, `unitPrice`); one "Service" line per billable Charge.
   - Fixed Price: one "Service" line, `itemId` = `serviceItemId`, quantity 1, `unitPrice` = `fixedPrice`.
   - Every line gets `serviceJobId`.
5. Set `serviceJob.salesInvoiceId` and status Invoiced.
6. In `post-sales-invoice/index.ts`, add every line with `serviceJobId` to `billedServiceLineIds`. Those lines then post revenue only.
7. Test the plan (Time and Materials with 1.5 h × 95 and 1 part × 120; Fixed Price; a non-billable entry left out). Test live: the invoice draft exists, and posting it writes AR and Sales only, with no item ledger row.
8. Register the function. Update the snapshot with `-u` and review the diff.

**Verify:**
```bash
pnpm --filter @carbon/server-functions exec vitest run src/create-service-invoice src/post-sales-invoice
# Expected: all pass.
```

**Out of scope:** the ERP button (Task 24).

## Task 20: Add the Jobs list, the New Job drawer and the navigation

**Depends on:** Tasks 13, 15
**Files:**
- Create: `apps/erp/app/routes/x+/service-jobs+/_layout.tsx`, `_index.tsx`
- Create: `apps/erp/app/routes/x+/service-job+/_layout.tsx`, `new.tsx`, `update.tsx`
- Create: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobsTable.tsx`, `ServiceJobForm.tsx`, `ServiceJobStatus.tsx`, `CoverageBadge.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `serviceJobs`, `serviceJob(id)`, `newServiceJob`, `serviceJobUpdate`, `serviceJobStatus(id)`, `serviceSchedule`
- Modify: `apps/erp/app/modules/service/ui/useServiceSubmodules.tsx` — Jobs, Schedule (added in Task 34; leave it out until then), Customer Assets
- Modify: `apps/erp/app/hooks/useModules.tsx` — the Service module opens `path.to.serviceJobs`
- Modify: `apps/erp/app/components/Layout/Topbar/CreateMenu.tsx` — "Service Job"
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/maintenance.tsx`, `apps/erp/app/routes/x+/maintenance+/_layout.tsx`, `new.tsx`, `update.tsx`; `ui/Maintenance/MaintenanceDispatchesTable.tsx`, `MaintenanceDispatchForm.tsx`, `MaintenanceStatus.tsx`

**Steps:**
1. Read `.claude/skills/carbon-design/SKILL.md`.
2. Copy the maintenance list route to `service-jobs+/_index.tsx`. The loader calls `getServiceJobs`. Permissions: `view: "service"`. Handle: `module: "service"`.
3. Copy `MaintenanceDispatchesTable` to `ServiceJobsTable`. Columns: Job (link), Status, Coverage, Customer, Asset (serial), Work Site, Assignee, Due Date, Created. Filters: Status, Coverage, Work Site, Assignee.
4. Copy the New drawer to `service-job+/new.tsx` and `ServiceJobForm`. Fields: Customer, Customer Location, Contact, Customer Asset (filtered by customer), Problem, Work Site, Location, Billing Method, Priority, Assignee, Due Date. When an asset is picked, show the suggested coverage and allow a change. The action calls `insertServiceJob` and redirects to `path.to.serviceJob(id)`.
5. Copy `update.tsx` for inline field updates through `updateServiceJob`.
6. Write `ServiceJobStatus` and `CoverageBadge` from `MaintenanceStatus`. Add their colors to `packages/utils/src/status-colors.ts`.
7. Add the paths, the submodules, the module link and the Create menu entry.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
Screenshot `/x/service-jobs` at 1440 px next to `/x/resources/maintenance`. Answer the 7 questions of the screenshot check (lesson "Every UI task names its precedent screen").

**Out of scope:** the job page (Task 21).

## Task 21: Build the job page

**Depends on:** Task 20
**Files:**
- Create: `apps/erp/app/routes/x+/service-job+/$jobId.tsx`, `$jobId._index.tsx`, `$jobId.status.tsx`
- Create: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobHeader.tsx`, `ServiceJobExplorer.tsx`, `ServiceJobProperties.tsx`, `ServiceJobNotes.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/maintenance+/$dispatchId.tsx`, `$dispatchId.status.tsx`; `ui/Maintenance/MaintenanceDispatchHeader.tsx`, `MaintenanceDispatchExplorer.tsx`, `MaintenanceDispatchProperties.tsx`, `MaintenanceDispatchNotes.tsx`

**Steps:**
1. Copy the 3-pane layout: `PanelProvider`, the `RecordHeader`, `ResizablePanels` with explorer, centre and properties, and the `RecordOutlet` for drawers.
2. The loader reads the job, its time, items, estimate lines, the asset, and the RMA line when set, in one `Promise.all`.
3. Copy the header. It shows the job number with a copy button, the status badge and the coverage badge.
4. Give the header one primary action from `serviceJobPrimaryAction`. Put Hold, Resume, Cancel, Send Estimate, Print Estimate and Reopen in the ⋯ menu. Task 24 wires the actions that post.
5. Explorer: 3 sections, Estimate, Time and Parts. Each lists its rows and opens a drawer route. Tasks 22 and 23 fill them.
6. Centre: Problem (text), Findings and Resolution (rich text, copy `MaintenanceDispatchNotes`), a "Repairable" Yes/No toggle, and Files.
7. Properties: Customer, Location, Contact, Asset (link to the asset page, with its warranty badge), Coverage, Billing Method, Work Site, Location, Priority, Assignee, Due Date, and the RMA (link) when set. Each field saves through `update.tsx`.
8. `$jobId.status.tsx` handles Start (Open → In Progress), Hold, Resume and Cancel. Cancel is allowed only with no posted time and no issued parts.
9. Lock every field when `isServiceJobLocked` is true. Wire realtime on `serviceJob.id` as the dispatch does.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
Screenshot a job at 1440 px next to a maintenance dispatch and answer the screenshot check.

**Out of scope:** time, parts and estimate content.

## Task 22: Add time and parts to the job page

**Depends on:** Task 21
**Files:**
- Create: `apps/erp/app/routes/x+/service-job+/$jobId.time.new.tsx`, `$jobId.time.$timeId.tsx`, `$jobId.time.$timeId.delete.tsx`
- Create: `$jobId.item.new.tsx` (Charge lines), `$jobId.item.$itemId.delete.tsx`, `$jobId.add-and-issue.tsx`
- Create: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobTimeForm.tsx`, `ServiceJobChargeForm.tsx`, `ServiceJobAddPartModal.tsx`
- Copy from (precedent): `maintenance+/$dispatchId.event.new.tsx`, `$dispatchId.event.$eventId.tsx`, `$dispatchId.event.$eventId.delete.tsx`, `$dispatchId.item.new.tsx`, `$dispatchId.item.$itemId.delete.tsx`, `$dispatchId.add-and-issue.tsx`; `ui/Maintenance/MaintenanceAddPartModal.tsx`

**Steps:**
1. Time drawer fields: Employee, Labor Item (Service items only; default `companySettings.serviceLaborItemId`), Date, Hours, Billable, Note. The action calls `upsertServiceJobTime`. The Explorer's Time section lists each row as "Name · Date · Hours".
2. Charge drawer fields: Item (Service items only), Description, Quantity, Unit Price (default the item's sale price), Billable.
3. Copy the add-and-issue route. It invokes `issue` with `serviceJobInventory` or `serviceJobTrackedEntities`. The Parts section lists issued parts with quantity and cost, and charges with price.
4. A part's delete runs `serviceJobUnconsume` through `issue`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, log 1.5 h on a job and issue 1 part. The explorer shows both.

**Out of scope:** posting time (Task 24).

## Task 23: Add the estimate and its PDF

**Depends on:** Task 22
**Files:**
- Create: `apps/erp/app/routes/x+/service-job+/$jobId.estimate.new.tsx`, `$jobId.estimate.$lineId.tsx`, `$jobId.estimate.$lineId.delete.tsx`, `$jobId.estimate.send.tsx`, `$jobId.estimate.response.tsx`
- Create: `apps/erp/app/routes/file+/service-job-estimate+/$id[.]pdf.tsx`
- Create: `packages/documents/src/pdf/ServiceJobEstimatePDF.tsx` and its test; export it from `packages/documents/src/pdf/index.ts`
- Create: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobEstimateLineForm.tsx`, `EstimateResponseModal.tsx`
- Copy from (precedent): `git show 6335d69cf7:packages/documents/src/pdf/ServiceEstimatePDF.tsx` and `git show 6335d69cf7:apps/erp/app/routes/file+/service-estimate+/$id[.]pdf.tsx`

**Steps:**
1. Estimate line drawer fields: Item (a labor item, a part or a charge item), Description, Quantity (hours for a labor item), Unit Price (default the item's sale price).
2. Send sets `estimateStatus` Sent, `estimateSentAt`, and status Awaiting Approval. It refuses with no lines.
3. Record Response opens a modal: Accepted or Declined, and the customer's name.
   - Accepted: `estimateStatus` Accepted, `fixedPrice` = the estimate total when Fixed Price, status Open.
   - Declined: `estimateStatus` Declined, `repairable` false, status In Progress, so the technician can complete it.
4. Rewrite the PDF for a flat line list. Props: `{ company, estimate: { serviceJobId, date, customerName, siteName, siteAddress, itemName, serial, laborWarranty, partsWarranty, lines: { description, quantity, unitPrice, amount }[], total } }`. Format money with `formatMoney` and the currency's decimals.
5. Print Estimate in the ⋯ menu opens the PDF route.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents --concurrency=1
# Expected: exit code 0.
pnpm --filter @carbon/documents exec vitest run src/pdf/ServiceJobEstimatePDF.test.ts
# Expected: pass.
```
In the browser, add 2 h labor (price 95) and 1 part (price 120). Send it. The PDF total is 310.

**Out of scope:** a customer portal approval.

## Task 24: Wire Complete, Reopen, coverage change and Create Invoice

**Depends on:** Tasks 19, 23
**Files:**
- Create: `apps/erp/app/routes/x+/service-job+/$jobId.complete.tsx`, `$jobId.reopen.tsx`, `$jobId.coverage.tsx`, `$jobId.invoice.tsx`
- Modify: `ServiceJobHeader.tsx`, `ServiceJobProperties.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/maintenance+/$dispatchId.status.tsx` (the Complete branch and its call to `postMaintenanceLabor`)

**Steps:**
1. Complete invokes `post-service-job` `{ action: "complete" }` through `serverFns.system({ db: getDatabaseClient(), companyId, userId })`. Show its refusal message in a flash.
2. Reopen invokes `{ action: "reopen" }`.
3. The Coverage field in Properties posts to `$jobId.coverage.tsx`, which invokes `{ action: "set-coverage" }`. It does not go through `update.tsx`.
4. Create Invoice invokes `create-service-invoice` and redirects to the new sales invoice.
5. The primary action follows `serviceJobPrimaryAction`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, complete the job from Task 23 and create its invoice. The journal and the invoice match the spec's acceptance criteria.

**Out of scope:** the MES.

## Task 25: Re-home the customer assets

**Depends on:** Task 13
**Files:**
- Move: `apps/erp/app/routes/x+/service-orders+/assets.tsx`, `assets.new.tsx`, `_layout.tsx` → `apps/erp/app/routes/x+/service-jobs+/assets.tsx`, `assets.new.tsx` (merge `_layout.tsx` into the one from Task 20); delete the empty `service-orders+` folder
- Modify: `apps/erp/app/utils/path.ts` — `customerAssets`, `newCustomerAsset`
- Modify: `apps/erp/app/modules/service/ui/CustomerAssets/CustomerAssetPage.tsx`, `CustomerAssetsTable.tsx`
- Modify: `apps/erp/app/modules/service/service.service.ts` — the `CUSTOMER_ASSET_COLUMNS` embed counts open jobs

**Steps:**
1. Move the routes and fix the paths.
2. In `CUSTOMER_ASSET_COLUMNS`, embed the open job count from `serviceJob`.
3. On the asset page, list the asset's service jobs (`getServiceJobsByAsset`) and its RMA lines. Add a "New Service Job" action that opens the New drawer with the asset filled in.
4. In the table, add a row action "New Service Job".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, open an asset. Its jobs show, and New Service Job fills the asset and suggests the coverage.

**Out of scope:** asset components (dropped).

## Task 26: Rebuild the RMA line: return type, assets, next steps

**Depends on:** Tasks 16, 17, 18
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `salesReturnOrderLineValidator` (near lines 1326–1342): `returnType`, `customerAssetId`, `problem`, and quantity 1 for Service and Warranty
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `upsertSalesReturnOrderLine` (near line 7364), `createReplacementSalesOrder` (near line 8263), `setSalesReturnOrderLineDisposition` (near line 8399); add `insertSalesReturnOrderLinesFromAssets`
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderLineForm.tsx`, `SalesReturnOrderExplorer.tsx`, `SalesReturnOrderHeader.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesReturnOrders/AddFromAssetsModal.tsx`
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.from-assets.tsx`, `$id.$lineId.next-step.tsx`
- Copy from (precedent): `ReturnableLinesModal.tsx`, `routes/x+/sales-return-order+/returnable-lines.tsx`, `$id.$lineId.disposition.tsx`

**Steps:**
1. Line form: add Return Type (Return to Stock, Return for Service, Return for Warranty), Customer Asset (the RMA customer's assets) and Problem. When an asset is picked, fill the item and serial, and preselect Return for Warranty when `suggestCoverage` returns Warranty. Lock the quantity at 1 for Service and Warranty. Lock Return Type after receipt.
2. Copy `ReturnableLinesModal` to `AddFromAssetsModal`. It lists the customer's assets with item, serial, shipped date and warranty badge. Each picked asset becomes one line through `insertSalesReturnOrderLinesFromAssets` (one insert call), with the suggested return type. Add "Add from assets" next to the existing add action.
3. Explorer line row: show the return type and, when set, a link to the line's service job with its status.
4. Line ⋯ menu, by line state:
   - Return to Stock, received: Disposition (existing: Use As Is, Return to Customer, Scrap, Rework).
   - Service or Warranty, job Completed: "Ship back" (creates the RMA shipment, as Return to Customer does today) and "Scrap".
   - Warranty, job Completed with `repairable = false`: "No-charge replacement".
   - Service or Warranty, job not Completed: "Change to Return for Service" (Warranty only), which also invokes `post-service-job` `set-coverage` Billable.
5. `$id.$lineId.next-step.tsx` handles Scrap and No-charge replacement:
   - Scrap sets `disposition` Scrap and the tracked entity Scrapped. It writes no ledger row: the unit has no value.
   - No-charge replacement calls `createReplacementSalesOrder` for this line with unit price 0 and `salesReturnOrderLineId` set on the new line. The old unit then takes Scrap, or Use As Is (keep at zero value).
   - "Keep at zero value" must add the unit to stock at cost 0. If no existing server path writes a zero-cost positive adjustment for a tracked entity, STOP and report. Ship Scrap only.
6. After each action, call `refreshSalesReturnOrderStatus`.
7. In `createReplacementSalesOrder`, stop skipping lines by disposition Repair (that value is gone). Set `salesReturnOrderLineId` on each inserted `salesOrderLine`.
8. Show In Progress in `SalesReturnOrderStatus`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
cd apps/erp && pnpm exec vitest run app/modules/sales
# Expected: all pass.
```
In the browser, run the spec's phase 1 RMA criteria: add 2 assets, receive, see 2 jobs, complete the warranty job not repairable, replace it, ship the replacement.

**Out of scope:** supplier recovery (phase 3).

## Task 27: Seed service jobs in the demo datasets

**Depends on:** Tasks 17, 24
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `ServiceJobSpec`, and `serviceJobs` on `SalesData`
- Modify: `packages/database/src/datasets/data/{motor,precision,robotics,satellite}/sales.ts` — `SERVICE_JOBS`, and RMA lines with `returnType`
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` (or `09-accounting.ts` for posted jobs) — `seedServiceJobs`
- Modify: `packages/database/src/datasets/validate.ts`, `coverage.ts`, `wipe.ts`
- Copy from (precedent): `seedCustomerAssets` in `tiers/04-sales.ts` (near lines 863–905); the posted-document conventions in `.claude/rules/onboarding-company-templates.md` ("Posted documents carry their downstream rows")

**Steps:**
1. In each dataset, add 5 jobs that cover the statuses Open, Awaiting Approval, In Progress, Completed (Warranty) and Invoiced (Billable). Each names a seeded customer asset. Use day offsets for dates.
2. Give the satellite "bus-repair" RMA line `returnType` Return for Service and link its job.
3. A Completed or Invoiced job carries its time rows, its completion journal (built the way `post-service-job` builds it) and, for Invoiced, its invoice with `serviceJobId` on the lines.
4. Remove the temporary 'In Progress' exclusion from the `salesReturnOrderStatus` coverage set in `validate.ts` (added in Task 10 because no dataset had an In Progress RMA yet), and seed one In Progress RMA. Add a `COVERAGE.serviceJob` status set in `validate.ts`. Add floors for `serviceJob`, `serviceJobTime` and `serviceJobItem` in `coverage.ts`, measured after a seed.
5. Add the job tables to `wipe.ts` only if the generic FK pass cannot delete them. Run the re-apply check to find out.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass layer 1 and layer 2, including the re-apply pass.
```

**Out of scope:** phase 2 data (assignments).

---

# Phase 2 — MES, My Time and the dispatch grid

## Task 28: Add the MES Service queue

**Depends on:** Task 27
**Files:**
- Create: `apps/mes/app/routes/x+/service.tsx`
- Create: `apps/mes/app/services/service.service.ts`
- Modify: `apps/mes/app/utils/path.ts` — `service`, `serviceJob(id)`, `newServiceJob`, `serviceTime`, `addAndIssueServiceJobItem(id)`
- Modify: `apps/mes/app/components/AppSidebar.tsx` (`QUEUES` near lines 272–281, `useQueueTitles` near lines 287–301, `queueKeyForPath` near line 304), `apps/mes/app/shortcuts.ts` (`MES_NAV_SHORTCUTS` near lines 19–27), `apps/mes/app/components/MesTabBar.tsx` (`TAB_KEYS`, `counts`), `apps/mes/app/routes/x+/_layout.tsx` (the count)
- Copy from (precedent): `apps/mes/app/routes/x+/maintenance.tsx`; `apps/mes/app/services/maintenance.service.ts` (`getActiveMaintenanceDispatchesByLocation`, `getMaintenanceDispatchesAssignedTo`, `getActiveMaintenanceEventsCount`)

**Steps:**
1. Write `getOpenServiceJobsByLocation(client, locationId)`, `getServiceJobsAssignedTo(client, userId, date)` (jobs with an assignment for the user on that date, or `assignee` = the user) and `getOpenServiceJobsCount(client, locationId)`.
2. Copy `maintenance.tsx` to `service.tsx`. Show "Today" (assigned to me today), then "Open at this location". Filters: Status, Coverage, Work Site. Cards show the job number, customer, asset serial, problem, coverage badge and status.
3. Add a `service` queue with the icon `LuHammer`, the title "Service", a shortcut, a tab key and its count. Make `queueKeyForPath` map `/x/service/…` detail pages to the queue.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: exit code 0.
```
Screenshot the MES Service queue next to the MES Maintenance queue at the same width and answer the screenshot check.

**Out of scope:** creating a job (Task 29).

## Task 29: Create a job from the MES

**Depends on:** Task 28
**Files:**
- Create: `apps/mes/app/routes/x+/service.new.tsx`
- Create: `apps/mes/app/components/ServiceJob/NewServiceJobModal.tsx`
- Modify: `apps/mes/app/services/models.ts` — `serviceJobNewValidator`
- Copy from (precedent): `apps/mes/app/routes/x+/dispatch.new.tsx`; the scan tab of `apps/mes/app/components/MaintenanceDispatch/MaintenanceAddPartModal.tsx` (near lines 93, 122, 366)

**Steps:**
1. The modal has a scan field: "Scan or enter a serial". Copy the scan tab's `trackedEntity` lookup. Then find the `customerAsset` with that `trackedEntityId`.
2. When an asset is found, show its customer, item and warranty badge, and the suggested coverage. When none is found, show a Customer picker and leave the asset empty.
3. Fields: Problem (required), Work Site (default Customer Site), Coverage (default the suggestion).
4. The action copies `dispatch.new.tsx`:
   1. Validate. Switch to the service role. Check every id belongs to the company.
   2. Take the next number with `rpc("get_next_sequence")` for `serviceJob`.
   3. Insert the job with status In Progress, `assignee` = the user, `locationId` = the user's location.
   4. Insert a `serviceJobTime` row with `startTime` now, `entryDate` today in the company time zone, and the default labor item. Refuse when the user already has a running clock.
   5. Redirect to `path.to.serviceJob(id)`.
5. Open the modal from a "New" button in the Service queue header.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: exit code 0.
```
In the MES, scan a seeded serial and create a job. The job page opens with the clock running.

**Out of scope:** the job page (Task 30).

## Task 30: Build the MES job page with the clock, parts and signature

**Depends on:** Task 29
**Files:**
- Create: `apps/mes/app/routes/x+/service.$jobId.tsx`, `service-time.tsx`, `service.$jobId.add-and-issue.tsx`, `service.$jobId.signature.tsx`
- Create: `apps/mes/app/components/ServiceJob/ServiceJobAddPartModal.tsx`, `ServiceJobSignature.tsx`
- Modify: `apps/mes/app/services/service.service.ts` — `getServiceJob`, `getServiceJobTime`, `getServiceJobItems`, `getRunningServiceClock`, `startServiceClock`, `stopServiceClock`, `completeServiceJob`
- Copy from (precedent): `apps/mes/app/routes/x+/dispatch.$dispatchId.tsx`, `maintenance-event.tsx`, `dispatch.$dispatchId.add-and-issue.tsx`; `apps/mes/app/components/MaintenanceDispatch/MaintenanceAddPartModal.tsx`; the signature in `git show 6335d69cf7:apps/erp/app/modules/service/ui/Visits/VisitPage.tsx` (`VisitSignature`, near line 467) and `git show 6335d69cf7:apps/erp/app/routes/x+/service-order+/\$id.visits.\$visitId.signature.tsx`; photo upload in `apps/mes/app/components/JobOperation/components/Step.tsx` (near lines 515–535)

**Steps:**
1. Copy the dispatch page layout: `MesAppBar`, a back link to the queue, the heading and status, then a `VStack max-w-2xl mx-auto` of cards.
2. Cards: Customer and asset (with warranty badge), Problem, Clock (Start or Stop, and today's total), Time entries, Parts, Findings, Resolution, Repairable (Yes/No), Photos, Complete.
3. `service-time.tsx` copies `maintenance-event.tsx`:
   - Start: refuse when `getRunningServiceClock` finds one. Insert a row with `startTime`. Set the job In Progress when it was Open.
   - Stop: set `endTime`, `hours` (the difference, in hours, rounded with `round` from `@carbon/utils`) and `entryDate`.
4. Parts copy the maintenance add-and-issue route and modal. They invoke `issue` with the `serviceJob*` types.
5. Photos upload to `${companyId}/service-job/${jobId}/` with the `Step.tsx` pattern.
6. The signature card uses `SignaturePad` from `@carbon/react`. It posts a PNG and `signedByName`. The route stores it at `${companyId}/service-job/${jobId}/signature.png`.
7. Complete: stop a running clock, then invoke `post-service-job` `{ action: "complete", signedByName, signaturePath }` with `serverFns.system`. Show a refusal in a flash.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: exit code 0.
```
In the MES, run the spec's phase 2 MES criteria: start and stop the clock, a second Start is refused, issue a part, complete with a signature.

**Out of scope:** My Time (Tasks 31, 32).

## Task 31: Show service jobs on My Time in the ERP

**Depends on:** Task 27
**Files:**
- Modify: `packages/utils/src/service-job.ts`, `service-job.test.ts` — `groupServiceTimeRows(entries, assignments)` and `manualHoursForDay(dayEntries, total)`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `getTimesheetWeekView` (near line 5517) also returns `serviceRows`
- Modify: `apps/erp/app/modules/projects/ui/Timesheet/useTimesheetRows.ts`, `TimesheetWeek.tsx`, `TimesheetModals.tsx` (`AddRowModal`)
- Create: `apps/erp/app/routes/x+/timesheet.service.tsx` — the service cell action
- Copy from (precedent): the project row path in `TimesheetWeek.tsx` (`commit` near line 253, `save(path.to.timesheetUpdate, …)` near line 296) and `apps/erp/app/routes/x+/timesheet.update.tsx`

**Steps:**
1. Write `groupServiceTimeRows`: one row per job, cells per day = Σ hours, plus jobs that have an assignment that week and no time. Write `manualHoursForDay`: the manual entry's new hours = the day's new total − Σ clock entries that day; null when that is below 0.
2. Test both helpers: a day with only a manual entry, a day with a clock entry of 1.5 h and a new total of 3 h (manual 1.5), and a total below the clock sum (null).
3. In `getTimesheetWeekView`, read the user's `serviceJobTime` rows and `serviceJobAssignment` rows for the week, with the job number, customer and status, in 2 queries. Return `serviceRows: groupServiceTimeRows(...)`.
4. Render service rows below the project rows with the job number and customer as the label, linking to the job. A row is read-only when its job is locked.
5. A service cell commit posts to `timesheet.service.tsx` with `serviceJobId`, `entryDate` and `hours`. The action reads the day's entries, uses `manualHoursForDay`, and upserts or deletes the manual entry. When the helper returns null, return the warning "This day has clock time on the job. Edit it on the job." Use the default labor item for a new entry.
6. Service rows never count toward submit, approval, certification or DCAA checks. Confirm `submit-timesheet-week` reads only `timesheetEntry`.
7. In `AddRowModal`, add a "Service job" tab that lists the user's open jobs (assigned or `assignee`).

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/service-job.test.ts
# Expected: all pass.
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, My Time shows the job row with its hours. Dragging to 3 h saves. A Completed job's row is locked.

**Out of scope:** the manager timesheet grid (`TimesheetGrid.tsx`); it stays project-only.

## Task 32: Show service jobs on My Time in the MES

**Depends on:** Task 31
**Files:**
- Modify: `apps/mes/app/routes/x+/timesheet.tsx` — the loader (near line 77) and a new `intent === "service-cell"` in the action (near line 164)
- Modify: `apps/mes/app/services/service.service.ts` — `getServiceTimeWeek`, `saveServiceDayHours`
- Copy from (precedent): the `cell` intent in the same file (near line 170)

**Steps:**
1. Read the week's service time and assignments for the user. Group them with `groupServiceTimeRows`.
2. Show service jobs as cards next to the charge number cards, using the same `WeekHoursChart` interaction.
3. The `service-cell` intent does what Task 31's action does, with `manualHoursForDay`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: exit code 0.
```
In the MES My Time, the job appears and its hours match the ERP.

**Out of scope:** submit and certification.

## Task 33: Add drag and drop to the People matrix, through a shared matrix component

**Depends on:** Task 27
**Files:**
- Create: `apps/erp/app/components/ScheduleMatrix/ScheduleMatrix.tsx`, `index.ts`
- Modify: `apps/erp/app/modules/production/ui/Schedule/People/PeopleMatrix.tsx` — wrap the grid, make each chip draggable and each cell a drop target
- Modify: `apps/erp/app/modules/production/production.service.ts` — add `movePeopleAssignmentCell`
- Modify: `apps/erp/app/modules/production/production.models.ts` — the `move-cell` intent in the people update validator
- Modify: `apps/erp/app/routes/x+/priority+/people.update.tsx` — handle `move-cell`
- Create: `apps/erp/test/schedule-matrix.test.ts` (the pure drop rules)
- Copy from (precedent): `apps/erp/app/modules/production/ui/Schedule/People/PeopleWeekBoard.tsx` (`DndContext`, sensors, `DragOverlay`, `onDragEnd` near line 408); `movePeopleAssignment` in `production.service.ts` (near line 5966, the same-station merge); the `move` intent in `people.update.tsx` (near line 296, which reschedules both work centers)

The People matrix and the dispatch grid are the same shape: people as rows, days as columns, chips in cells. Brad asked for drag and drop on both, so they share one component.

**Steps:**
1. Read `.claude/skills/carbon-design/SKILL.md`.
2. In `ScheduleMatrix.tsx`, export 4 pieces built on `@dnd-kit/core` (already a dependency):
   1. `ScheduleMatrixDnd`: wraps `DndContext` and a `DragOverlay`. Use a `PointerSensor` with `activationConstraint: { distance: 5 }` and a `KeyboardSensor`, so a click still opens a cell's modal. Props: `onMove({ chipId, from, to })`, where `from` and `to` are `{ rowId, date } | "outside"`, and `renderOverlay(chipId)`.
   2. `MatrixCell`: `useDroppable` with id `${rowId}:${date}`. Props: `rowId`, `date`, `disabled`. It highlights while a chip is over it.
   3. `MatrixChip`: `useDraggable` with data `{ chipId, rowId, date }`. Props: `chipId`, `rowId`, `date`, `disabled`, `children`. It fades while it is being dragged.
   4. `MatrixOutsideZone`: a drop target with the id `outside`, for a side panel such as the service backlog. A chip dragged from it reports `from: "outside"`.
3. Export the pure `resolveMatrixDrop(active, over)`. It returns the move, or null when the drop is on the same cell, on a disabled cell, or on nothing. Test the 4 cases in `apps/erp/test/schedule-matrix.test.ts`.
4. Add `movePeopleAssignmentCell(db, { id, companyId, employeeId, date })` to `production.service.ts`. Copy `movePeopleAssignment`:
   1. Lock the source row.
   2. Find a target row with the same work center and the same effective shift for the new person and date.
   3. If one exists, merge: add the hours (null when either side is null, as the existing merge does), then delete the source.
   4. Else update the source's `employeeId` and `date`.
   5. Return the work center id, so the route can reschedule it.
5. In `people.update.tsx`, handle `intent: "move-cell"` with `id`, `employeeId` and `date`. Refuse a target day on which the person is absent. Reschedule the work center the way the `move` intent does.
6. In `PeopleMatrix.tsx`:
   1. Wrap the assignments table in `ScheduleMatrixDnd`.
   2. Wrap each cell's content in `MatrixCell`. Disable it when the person is absent that day or the user cannot edit.
   3. Wrap each `PeopleChip` in `MatrixChip`.
   4. `onMove` submits `move-cell` to `path.to.priorityPeopleUpdate`.
   5. Keep the cell's click-to-open `PeopleHoursModal` as it is.
7. Do not change `PeopleBoard` or `PeopleWeekBoard`. They keep their own sortable lists.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run test/schedule-matrix.test.ts
# Expected: all pass.
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, open Production → Priority → People, Matrix view. Drag a person's Monday chip to their Tuesday cell. It moves, the hours total stays the same, and the forecast reschedules. Drag it onto a day marked Absent: the cell refuses the drop. Click a cell: the hours modal still opens. Screenshot the matrix during a drag at 1440 px.

**Out of scope:** copy-on-drag, multi-select drag, the Board and Week views.

## Task 34: Build the dispatch grid

**Depends on:** Tasks 27, 33
**Files:**
- Create: `apps/erp/app/routes/x+/service-jobs+/schedule.tsx`, `schedule.update.tsx`
- Create: `apps/erp/app/modules/service/ui/Schedule/ServiceSchedule.tsx`, `ServiceScheduleHeader.tsx`, `ServiceBacklog.tsx`, `AssignmentBlock.tsx`
- Modify: `apps/erp/app/modules/service/ui/useServiceSubmodules.tsx` — add Schedule
- Modify: `packages/database/src/datasets/` — seed 4 assignments per dataset in the current week (Task 27's jobs), and a `serviceJobAssignment` floor
- Copy from (precedent): `apps/erp/app/routes/x+/priority+/people.tsx` (the loader near lines 102–189 and the week block near lines 293–345); `ui/Schedule/People/PeopleMatrix.tsx` after Task 33 (rows, cells and drag and drop through `~/components/ScheduleMatrix`), `PeopleHeader.tsx` (week navigation and the department filter), `peopleShared.ts`, `people.update.tsx` (intents)

**Steps:**
1. The loader copies `people.tsx`: resolve the location and its time zone, build the week with `startOfWeek(parseDate(date), "en-GB")`, and read in one `Promise.all`:
   - `getLocationEmployees`
   - `getPeopleAbsencesRange`
   - `getEmployeeDepartments`, `getEmployeeShifts`, `getShiftsWithTimes`
   - `getServiceJobAssignmentsRange`
   - `getServiceBacklog`
2. Copy `PeopleHeader` for week navigation and the department filter. Drop the controls the grid does not use (view switch, overtime, time off).
3. Copy the `PeopleMatrix` grid: employees as rows, the week's days as columns, sticky header and first column. An absent day is greyed out (`buildAbsentSet`).
4. Each cell lists `AssignmentBlock`s (job number, customer, planned hours) and a total against the shift hours (`ladderShiftHours`).
5. `ServiceBacklog` is a side panel listing the backlog jobs as draggable cards.
6. Use `ScheduleMatrixDnd`, `MatrixCell` and `MatrixChip` from Task 33, as `PeopleMatrix` does. Wrap the backlog panel in `MatrixOutsideZone`. In `onMove`:
   - From `outside` to a cell: intent `assign`. Planned hours default to the shift hours minus the cell's total, at least 1.
   - From a cell to another cell: intent `move`.
   - From a cell to `outside`: intent `unassign`.
   - Clicking a block opens a small modal to edit the planned hours and note, with a link to the job.
7. `schedule.update.tsx` handles the 3 intents through `upsertServiceJobAssignment`, `moveServiceJobAssignment` and `deleteServiceJobAssignment`. Permission: `update: "service"`.
8. Seed assignments in the datasets. Add the floor. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --concurrency=1
# Expected: exit code 0.
pnpm db:check:datasets
# Expected: pass.
```
Screenshot the grid at 1440 px next to the People matrix and answer the screenshot check. Drag a backlog job onto Tuesday; it leaves the backlog and the total updates.

**Out of scope:** capacity forecasting, travel time, skills.

## Task 35: Link a charge's cost to a reimbursement or supplier invoice line

**Depends on:** Task 22
**Files:**
- Modify: `apps/erp/app/modules/service/ui/ServiceJob/ServiceJobChargeForm.tsx`
- Modify: `apps/erp/app/modules/service/service.service.ts` — `upsertServiceJobItem`, `getLinkableCostLines(client, companyId, { employeeId?, supplierId? })`
- Modify: `apps/erp/app/routes/x+/service-job+/$jobId.item.new.tsx` and the charge edit route
- Copy from (precedent): the `reimbursementLine` read in `apps/erp/app/modules/invoicing/invoicing.service.ts` (`upsertReimbursementLines` near line 1600)

**Steps:**
1. Add a "Paid by" section to the charge form: none, a reimbursement line, or a supplier invoice line. The picker lists lines with their document number, description and amount.
2. When a line is linked, set the charge's `unitCost` to the linked amount ÷ quantity, and store the link. The job writes no journal for it: the linked document posts its own.
3. When the linked line's account differs from the job's coverage account (`coverageAccountRole`), show the warning "This cost posted to {account}, not the job's {coverage account}."
4. Show the charge's cost and its source document in the Parts section.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: exit code 0.
```
In the browser, add a $180 hotel charge, link it to a reimbursement line, and see a cost of 180 with no new journal.

**Out of scope:** creating a reimbursement from the job.

---

# Wrap-up

## Task 36: Write the docs, rules and AGENTS files

**Depends on:** Tasks 1 to 35
**Files:**
- Create: `.claude/rules/service-jobs.md` (with `paths:` frontmatter for `apps/erp/app/modules/service/**`, `packages/server-functions/src/post-service-job/**`, `packages/server-functions/src/create-service-invoice/**`, `apps/mes/app/routes/x+/service*`)
- Create: `apps/erp/app/modules/service/AGENTS.md` (with `.claude/skills/create-agents-md/SKILL.md`) and its `CLAUDE.md` (`@AGENTS.md`)
- Create: `docs/content/docs/reference/service-jobs.mdx`; add it to `meta.json`
- Modify: root `AGENTS.md` Task Router row "Field service" → "Service jobs (depot and field service, warranty, RMA service lines)" pointing at the new rule and AGENTS file
- Modify: `apps/erp/app/modules/production/AGENTS.md` (the People matrix drag and drop, `movePeopleAssignmentCell`, the `move-cell` intent, `~/components/ScheduleMatrix`)
- Modify: `apps/erp/app/modules/sales/AGENTS.md` (RMA return types), `.claude/rules/inventory-system.md`, `traceability-model.md`, `accounting-sync-handlers.md` if it lists journal sources, `onboarding-company-templates.md` (service jobs in the datasets)
- Modify: `docs/content/docs/reference/rmas.mdx`, `customer-assets.mdx`, `docs/content/src/glossary/terms.ts` ("service job", "coverage", "return type")

**Steps:**
1. Write the rule from the committed code only. Cover: the record, coverage and its accounts, the posting table, the estimate rule, the RMA return types and resolution, My Time rows, the grid. Mark anything you cannot verify with `<!-- UNVERIFIED: … -->`.
2. Write the AGENTS file with the create-agents-md skill.
3. Write the reference page with the `carbon-docs` skill. Say where it is: Service → Jobs.
4. Update the other files.
5. Run the link check from `.claude/rules/changelog-authoring.md` for `/docs/` links in the pages you touched.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: exit code 0.
grep -rn "service-orders\|serviceOrder" .claude/rules docs/content AGENTS.md apps/erp/app/modules/*/AGENTS.md
# Expected: no output.
```

**Out of scope:** a changelog entry (ask Brad).

## Task 37: Fill the translations

**Depends on:** Task 36
**Files:**
- Modify: `packages/locale/locales/*/*.po`

**Steps:**
1. Run the `/translate` skill.

**Verify:**
The `/translate` skill runs its own check at the end.

```bash
# Expected in the skill's final report: 0 missing translations and 0 terminology conflicts.
```

**Out of scope:** new strings.

## Task 38: Verify in the browser

**Depends on:** Task 37
**Files:**
- Create: `.ai/playbooks/service-jobs-and-returns.md` (the `/test` skill caches it)

**Steps:**
1. Ask Brad for permission to drive the browser. Then run `/auth` and `/test`.
2. Run every acceptance criterion in the spec, phases 1 and 2, on a seeded satellite company.
3. Screenshot each new screen at 1440 px. Save the screenshots under `.context/`.
4. Record each criterion as pass or fail in the run log `.ai/runs/2026-10-22-service-jobs-and-returns.md`.

**Verify:**
```bash
grep -c "FAIL" .ai/runs/2026-10-22-service-jobs-and-returns.md
# Expected: 0.
```

**Out of scope:** fixing a failure inside this task. A failure goes back to its task.
