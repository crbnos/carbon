# Port notes: shared (plan Phase 4, shared/other)

Agent `shared`. Worktree `kelowna-port`. Nothing committed.

## Server-function bodies carried (B)

- [x] `packages/server-functions/src/create/index.ts` → `createDocument` (sales-return-order shipment branch), `apps/erp/app/modules/shared/shared.service.ts`. Repair lines ship back too: one unit per Depot Repair `serviceOrder` that is Completed or Closed and whose `customerAsset` is At Depot (one Kysely read over `repairLineIds`, company-scoped on both tables). The refusal now reads `No lines are dispositioned "Return to Customer" or "Repair"`.
- [x] `convert/index.ts` → `convertDocument` (PO → purchase invoice lines): `projectId` and `projectElementId` are copied.
- [x] `import-csv/index.ts` → `importCsvInput` gains `"payrollPeriodTotal"`; `importCsvTable` gains the `payrollPeriodTotal` case. The permission (`people`) was already in `importPermissions` (`imports.models.ts`), which is what main's `importCsvFile` gates on (the server function's own `IMPORT_PERMISSIONS` map no longer exists).
- [x] `import-csv/payroll-total-import.ts` (180 lines) → `apps/erp/app/modules/shared/payroll-total-import.ts`, unchanged except `./chunks` → `inChunks` from `./shared.service`. SPDX header checked by the fixer (AGPL, correct).
  - Not ported: `payroll-total-import.test.ts`. It mixes pure tests with live-DB tests on the old `local-database-test-fixture`, so it is not trivially movable. Phase 8.
- [x] `seed-company/index.ts` → `seedCompany`, `apps/erp/app/modules/settings/settings.service.ts`: inserts `projectStates` (from `@carbon/database/seed-data`) after the sequences, `createdBy: "system"`.
- [x] `post-nonconformance/index.ts` → `postNonConformance`, `quality.service.ts`: `loadTrackedEntityStripes` (`@carbon/api/stock-stripes`) once for the movements' tracked entities; each `bookAdjustment` ledger row gets `projectId` = the entity's stripe (untracked → null).
- [x] `apps/erp/app/modules/quality/quality-disposition.server.ts` (deleted on main) → its body is `subdivideBatchEntity` in `quality.service.ts`. The source-lot ledger read selects `projectId`; the split's ledger rows carry `projectId = trackedEntityStripe(sourceLedgerRows, source.id)`.

## Conflicted module files (A)

- [x] `items/items.service.ts`: the import of `BASE_IGNORED_FIELDS, comparedFields, diffRows, valuesEqual` from `../shared/diff` (the merge dropped it; the code using it was kept). The branch's TSDoc for `upsertItemUnitSalePrice` moved to the operation (`items.server.ts`), which also needed two fixes for the branch's service body: the input takes `laborWarrantyMonths` / `partsWarrantyMonths` (int ≥ 0, nullable), and it no longer calls `.withoutCompany()` — the branch's service destructures `companyId` and filters the update by it (with `withoutCompany` the filter would be `companyId = undefined`).
- [x] `people/people.service.ts`: `getPayrollPeriodTotals` restored; published as the operation `getPayrollPeriodTotals` (`@mcp read`, `view: people`, paged) in `people.server.ts`. The `laborCategory` / `isOfficer` / `timesheetRequired` changes to `updateEmployeeJob` were already in the tree.
- [x] `settings/settings.service.ts`: see the settings routes below. The branch's four `@mcp` service functions follow main's "one update operation per settings page" rule instead of coming back as building blocks:
  - `updateProjectSettings` → operation `updateProjectSettings` (`settings.server.ts`, `update: settings`).
  - `updateTimekeepingSettings` + `updateTimeCardSetting` → operation `updateTimeSettings` (the Time page). An emptied certification text is stored as null, as before.
  - `updateServiceLaborItemSetting` → `serviceLaborItemId` on `updateInvoicingSettings` (null clears; a non-Service item is refused "Choose a service item", the route's check, now `isCompanyServiceItem` in settings.service).
  - New building block `dcaaTimekeepingRefusal(ctx, sent)`: the branch's route check (turning DCAA on refuses while a Released Standard project has no `costObjective`, "Set a cost objective on N projects first"), plus the validator's rule that DCAA needs both certification texts (the sent text, else the stored one), so the API cannot skip it.
  - `updatePeopleSettings` keeps main's `timeCardEnabled` field (public contract), although the switch moved to the Time page.
- [x] `purchasing/purchasing.service.ts` (non-planning): the branch's `planningGroupId?` on `upsertPurchaseOrderLine` and the `purchaseOrder!purchaseOrderLine_purchaseOrderId_fkey!inner` embed were already in the tree. The planning hunk (`planningSegmentFilter` import, `segments`, `order("planningSegmentId")`) is the production agent's; it is present in the working tree.
- [x] `shared/shared.server.ts` → the `@carbon/ee/action-task-entity` → `@carbon/ee/issue-sync` change, in main's homes:
  - `shared.service.ts`: `getActionTaskWithParent` takes `SyncedEntityType`, reads the entity's `textColumn` as `notes` and throws on a read error (branch version); `getRecordIssueLinks`, `getNewIssueDefaults`, `projectElementLinkRefusal` added; `editableActionTask` takes `SyncedEntityType` and refuses an element of a Closed project; `actionTaskUrl(entityType, parentId, actionId)` uses `syncedEntities[…].detailPath(parentId, id)` (which now includes `/details`); new `pushToIssue` (the `issue-sync-push` trigger). This fixes the known `shared.service.ts:107` error.
  - `shared.server.ts`: the six operations (`create/link/unlinkJiraIssue`, `create/link/unlinkLinearIssue`) take all three entity types (permission `syncedEntityPermissions`, `projectElement` → `update: projects`) and use the branch's engine: `linkNewIssue` / `linkExistingIssue` on `ctx.asSystem.supabase`, the back-link URL from the record's parent, and the `issue-sync-push` (initial on create). The link operations drop main's assignee lookup and description overwrite, as the branch did (the engine pulls and pushes). Unlink checks change-notice lock and Closed project for both trackers; Linear unlink removes only this record's back-link (`removeIssueLink` with the exact URL), as on the branch. Return shapes are main's (`{ issueId }` / `{ actionId }`).
- [x] `routes/api+/integrations.{jira,linear}.issue.{create,link}.ts`: main's `carbon()` actions kept; loaders import `isSyncedEntityType` / `syncedEntityPermissions` from `@carbon/ee/issue-sync` and `getNewIssueDefaults` from `shared.service`.

## Routes

- [x] `x+/settings+/invoicing.tsx`: the Service Labor card's intent `serviceLabor` joins the form union → `updateInvoicingSettings({ serviceLaborItemId })`; imports `Item` and `serviceLaborItemValidator`; toast "Service labor item updated".
- [x] `x+/settings+/people.tsx`: the `timeCard` intent removed (the branch moved the switch to Settings → Time).
- [x] `x+/settings+/time.tsx`: action is `validator(timeSettingsForm).request` → `api.settings.updateTimeSettings`. The controls form posts a hidden `intent=timekeeping`; both fetchers are `useAction`.
- [x] `x+/settings+/projects.tsx`: the two switches go through `api.settings.updateProjectSettings`. The state and label writes still call `projects.service` directly (no operations exist yet; see requests).
- [x] `x+/settings+/approval-rules.tsx`, `timekeeping.tsx`: already carried.
- [x] `x+/person+/$personId.job.tsx`: `isOfficer` / `timesheetRequired` missing from the form post mean off (`?? false`), as on the branch. `updatePersonJob`'s TSDoc names the project time fields and the labor-category refusal.
- [x] `x+/people+/payroll-totals.tsx`: import from `~/modules/people/people.service`.
- [x] `x+/purchase-order+/$orderId.finalize.tsx`: the budget check moved into `finalizePurchaseOrderAndNotify` (`purchasing.server.ts`): after the approval decision, every project-charged line is checked as a new commitment (its own commitment excluded); Block → `rule` error, Warn → `budgetWarning` in the result. The route appends it to the flash, as the branch did.
- [x] `x+/purchase-order+/$orderId.new.tsx`: missing imports added (`chargeNumberError`, `checkProjectBudget` from `projects.server`, `getDatabaseClient`). Main never moved this route to an operation, so neither did I.
- [x] `x+/purchase-order+/$orderId.$lineId.details.tsx`: already carried.
- [—] `x+/purchase-order+/$orderId.status.tsx`: the branch's only change was the `runMRP` import path. On main the route calls an operation; MRP with `planningGroupMrpDeps` is the production agent's.

## Verification

- `cd apps/erp && npx tsgo --noEmit`: no error in any file I touched or own. 115 lines remain, all in other owners' files (some of them import from my modules; see below).
- `service-fn-file` and `route-action-shape`, run on my 23 files: clean. `no-raw-rounding`: only the two existing `Math.round` (label dots, `settings.service.ts`), already in the baseline.
- `biome check --write` on the 23 files: no errors; 6 warnings, all in code I did not write (`useIterableCallbackReturn` in shared.service, an unused suppression in `$orderId.new.tsx`).

## Requests for other owners

- **projects agent (Phase 6):**
  - `routes/x+/project+/$projectId.element.$elementId.tsx:28` and `routes/x+/service-order+/$id_.work.$elementId.tsx:38` import `getRecordIssueLinks` from `shared.server`. Change them to `~/modules/shared/shared.service`.
  - `routes/x+/project+/$projectId.elements.$elementId.create-job.tsx`: `getUnreleasedChangeOrderIssue` is in `~/modules/items/items.service`; `requireCompanyRecord` is in `~/modules/shared/shared.service`.
  - `routes/x+/projects+/transfers.new.tsx:27`: `getUserDefaults` is in `~/modules/users/users.service`.
  - Seven routes import `getCompanyTimeZone` from `~/modules/shared/timezone.server`, which does not exist on main: use `~/modules/shared/shared.service` (`getCompanyTimeZone`, `getLocationTimeZone`). The routes are `customer+/$customerId.assets.tsx`, `project+/$projectId._index.tsx`, `.billing.tsx`, `.costs.tsx`, `.place-in-service.tsx`, and `service-orders+/assets.tsx`, `my-visits.tsx`, `schedule.tsx`.
  - When `chargeNumberError` / `checkProjectBudget` move out of `projects.server.ts`, repoint `purchasing.server.ts` (finalize), `routes/x+/purchase-order+/$orderId.new.tsx` and `$orderId.$lineId.details.tsx`.
  - `routes/x+/settings+/projects.tsx` still writes project states and labels through `projects.service` building blocks (`upsertProjectState`, `deleteProjectState`, `setProjectStateDefault`, `upsertProjectLabel`, `deleteProjectLabel`). Once those are operations, the route should call them through `carbon()`. I own the route; this needs the operations first.
- **Phase 8 (tests):** `packages/server-functions/src/import-csv/payroll-total-import.test.ts` (at FREEZE) → `apps/erp/app/modules/shared/` (pure part) and `apps/erp/test/database/` (live part); it imports `importPayrollTotals` / `readPayrollTotalRow` from `./payroll-total-import`.
- **Phase 9 (MCP digest):** new published operations `people_getPayrollPeriodTotals`, `settings_updateTimeSettings`, `settings_updateProjectSettings`. Changed contracts: `items_upsertItemUnitSalePrice` (warranty fields), `settings_updateInvoicingSettings` (`serviceLaborItemId`), `purchasing_finalizePurchaseOrderAndNotify` (`budgetWarning` in the result; Block refuses). The branch's service-level `@mcp` tools `updateProjectSettings`, `updateTimeCardSetting`, `updateTimekeepingSettings`, `updateServiceLaborItemSetting` and `getPayrollPeriodTotals` are replaced by these operations. New UI strings for `lingui:extract`: "Time settings updated", "Timecard settings updated", "Failed to update timecard settings", "Service labor item updated".
- **Accounting agent / orchestrator:** the plan's Phase 4 "shared/other" line also lists the `post-payment` deposit rule (`post-payment/journal-input.ts`). It was not in my task and I did not touch it. Confirm it has an owner.
