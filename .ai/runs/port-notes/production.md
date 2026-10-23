# Port notes: production (plan Phase 4)

Agent `production`. Worktree `kelowna-port`. Nothing committed.

## Carried (carry list line → new home)

### A. Conflicting hunks

- [x] `production/production.server.ts` — the conflict was imports only (the branch imported
  `runMRP` from `production.mcp.server`). Covered by `runMRP` below; nothing else to carry.
- [x] `production/production.service.ts`
  - `planningSegmentFilter` import restored (`./ui/Planning/planning-action-scope`). This fixes
    the undefined name at `getProductionPlanning`.
  - `JobProject` / `getJobProjects` restored (before `getActiveProductionEvents`). The
    priority boards use it.
  - `runMRP`: kept in the service (main's home) and it now passes `planningGroupMrpDeps`
    (`@carbon/ee/pegging.server`) as `runMrp`'s 4th argument. Every ERP caller reaches MRP
    through `service.runMRP`: the `runMRP` operation and the 4 internal calls in
    `production.server.ts`, `purchasing.server.ts:2192`, `sales.server.ts:2062` and
    `api+/mrp.ts`. So every server-side caller passes the deps without a change at its call
    site. Service files may import `.server` packages (module-files.md), so no new
    `defineServiceFn` was needed. Jobs (`scheduled/mrp.ts`, `demo-planning.ts`) already pass
    them.
  - The other branch hunks of this file (`getJobProjectCharge`, the FK hints, `insertJob` /
    `updateJob` project fields, segment ordering, Transfer/Borrow worklist,
    `settleNewSupplyPlanningActions` segment key) were already merged. I checked each one.
- [x] `purchasing/purchasing.service.ts` — `planningSegmentFilter` import restored. The other
  branch hunks (segments, `planningGroupId`, FK hint) were already merged.
  `deduplicateForecasts` now keys on `planningSegmentId` too. This is the branch's
  route-local dedupe, which main moved into this file.
- [x] `api+/mrp.ts` — main's imports kept. It calls `service.runMRP`, so it gets the deps.
- [x] `x+/job+/new.tsx` → `createJob` (production.server.ts) +
  `jobChargeNumberRefusal` / `jobBudgetCheck` (production.service.ts):
  - The charge number is checked with `chargeNumberError` after `jobCreationRefusal`. The
    refusal is `validation`.
  - The budget check runs for consume-to-project jobs: quantity × the item's unit cost. A
    Block refuses with category `conflict`. A Warn returns `budgetNote`.
  - `insertJob` gets `projectId || null`, `projectElementId || null`, `consumeToProject` and
    `receiveToProjectStock`.
  - The route maps a refusal to a form field with `jobFormRefusalField` (production.models).
    It flashes `Job created. <note>` on a warn.
- [x] `x+/job+/$jobId.details.tsx` → `updateJobDetails`:
  - The charge number is checked before the Make to Asset rule, as on the branch.
  - The budget amount is quantity × unit cost less the job's non-Burden `projectLedger` sum.
  - The project fields are passed to `updateJob`, and `budgetNote` is returned.
  - The route flashes `Updated job. <note>`. I removed the now-unused imports (`sql`,
    `chargeNumberError`, `checkProjectBudget`).
- [x] `x+/job+/update.tsx`:
  - Linking a sales order line is refused for a job that consumes to a project or receives
    into project stock → `setJobSalesOrderLine`. `readUnlockedJobs` now selects
    `consumeToProject, receiveToProjectStock`.
  - The `chargeNumber` field → new operation `setJobChargeNumber` (`@mcp`, `update:
    production`). Its rules: Draft/Planned only, `chargeNumberError`, and it clears
    consume/receive by the project's treatment and stock. `updatedAt` uses
    `datetime.timestamp()`, not `new Date()`. The route splits `"projectId|elementId"`.
- [x] `x+/job+/$jobId.status.tsx` — the `runMRP` import is covered by the service. The
  `item!job_itemId_fkey` hint now sits on the two job reads that main moved into
  `production.service.ts` (release readiness and the per-job status read).
- [x] `x+/job+/$jobId.tsx` — `getJobProjectCharge` was already merged.
- [x] `x+/production+/planning.tsx`, `x+/purchasing+/planning.tsx` — the bodies were merged.
  The missing imports are restored: `resolvePlanningSegmentScope`, `PlanningOverdueBorrows`,
  and `getProjectBorrows` (from `~/modules/projects/projects.service`).
- [x] `x+/priority+/dates.tsx`, `operations.tsx` — the bodies were merged. The
  `getJobProjects` import is restored (from `production.service`).
- [x] `x+/production+/planning.update.tsx` — main's route only dispatches. The branch logic
  went into the operations in `production.server.ts`:
  - `orderPlannedJobs`:
    - item `planningSegmentId` (default `""`);
    - `getPlanningSegmentOwners`, which refuses an unknown segment with `notFound` "Project
      not found";
    - a group segment gives the job `planningGroupId`, and a project segment gives it
      `projectId` and `receiveToProjectStock: true`;
    - `ordered` carries the segment and the jobId;
    - after settle, `moveActionPegsToSupply` (on `ctx.asSystem.pg`);
    - the supply forecasts key and upsert on `planningSegmentId`.
  - `applyPlanningActions`: with no `type`, Open Transfer/Borrow rows go to
    `applyTransferPlanningActions`, are skipped from the change loop, and are returned as
    `transfers`.
- [x] `x+/purchasing+/planning.update.tsx` — the route needs no change (it uses the
  operations' input shapes). The branch logic went into `purchasing.server.ts`:
  - `orderPlannedPurchases`:
    - segments, as for jobs;
    - `purchaseOrderLine!purchaseOrderLine_purchaseOrderId_fkey(... projectId,
      planningGroupId ...)`;
    - lines merge only within the same owner;
    - `projectId` or `planningGroupId` is set on new lines;
    - peg moves;
    - the forecasts are keyed by segment.
  - `applyPlanningActions`: transfers, the "created N Draft project stock transfers" message
    part, and `transfers` in the result.
  - `updatePlanningPurchaseOrderLine`: the FK hint.

### B. Files main deleted

- [x] `production/production.mcp.server.ts` (`runMRP` with deps) → `production.service.ts`
  `runMRP` (above).
- [x] `packages/server-functions/src/post-production-event/index.ts` →
  `production.service.ts` `postProductionEvent`. The changes:
  - `Project` / `ProjectElement` dimensions;
  - `loadJobProjectCharge`, with the project account in place of WIP;
  - the "Project Labor" / "Project Overhead" descriptions;
  - project dimension tags on lines of that account;
  - in the transaction, the projectLedger mirror: reverse the open rows (each reversal names
    the reversal line on its original line's account), then write the Labor/Machine and
    Overhead rows with their journal line ids.

  Imports come from `~/modules/projects/project-posting`.
- [x] `packages/server-functions/src/get-method/index.ts` → `production.service.ts`:
  - `projectId` in the itemToJob job read;
  - `jobStockStripes`;
  - `loadSupersessionRedirect` and `settleConsumeFirstLines` read `itemStockQuantities` only
    in the job's stripes (`['', projectId]`);
  - all 4 `settleConsumeFirstLines` calls pass `projectId`. The other 3 flows read the job
    with `single(db, "job", …)`, which reads every column.

  The `getStorageUnitId` signature was already done by foundation.
- [—] `production.server.test.ts`, `x+/job+/$jobId.status.test.ts`,
  `test/mcp-upsert-job-material.test.ts`: not restored (main deleted them).
  `post-production-event/project-event.test.ts`: not ported (Phase 8).

## Behaviour notes

- **The form field of a refusal.** A route only sees `{ category, message, status }`, so it
  cannot learn `chargeNumberError`'s `field`. Every charge-number refusal is now shown on the
  Charge Number picker (`projectId__projectElementId`). On the branch, the
  `consumeToProject` and `receiveToProjectStock` refusals were shown on their own checkbox.
  The message is the same. A budget Block is still shown on `quantity`. It uses category
  `conflict`, because `rule` was already mapped to `itemId`.
- **Order of the createJob checks.** The charge number is now checked after
  `jobCreationRefusal`, which also covers the Make to Asset item rule. On the branch it was
  checked between the change-notice check and the Make to Asset check. Only the order of
  refusals differs.
- **Empty charge number.** `insertJob` now writes `projectId || null` (it was `?? null`), so
  an empty string from a form never reaches the FK.
- **setJobChargeNumber.** It returns `internal` when the project read fails. The branch
  ignored that error.
- **New and changed responses (the MCP digest changes, Phase 9 `generate:mcp`).**
  - The new operation `production_setJobChargeNumber`.
  - `createJob` and `updateJobDetails` may return `budgetNote`.
  - Both `applyPlanningActions` return `transfers`.
  - `orderPlannedJobs` and `orderPlannedPurchases` take `items[].planningSegmentId`.

## Requests for other owners

- **projects agent:** `production.service.ts`, `production.server.ts` and
  `purchasing.server.ts` import `chargeNumberError`, `checkProjectBudget`,
  `getPlanningSegmentOwners`, `moveActionPegsToSupply` and `applyTransferPlanningActions`
  from `~/modules/projects/projects.server`. When these move to `projects.service.ts`,
  repoint the imports.
  - Until `projects.server.ts` stops importing `@carbon/server-functions` (lines 23–25), the
    module cannot load at runtime. `production.server.ts` → `router.server.ts` now depends on
    it.
- **owner of `production/ui/Planning/usePlanningActions.ts`:** production's
  `applyPlanningActions` answers `{ data: { transfers, applied, … }, error }`. The hook reads
  `transfers` only at the top level, which is the purchasing shape. Two changes are needed:
  - also read `result.data?.transfers`, so the production toast links its transfers;
  - in `usePlanningResultMessage`'s data branch, add the "created N Draft project stock
    transfers" part.
- **purchasing owner (`purchasing.server.ts`):** another agent is editing this file too. I
  changed only:
  - the planning operations (`orderPlannedPurchases`, `updatePlanningPurchaseOrderLine`'s
    select, `applyPlanningActions`);
  - the projects import line, which now also brings `applyTransferPlanningActions`,
    `getPlanningSegmentOwners` and `moveActionPegsToSupply`.

  `biome check --write` re-sorted its imports.
- **tests (Phase 8):**
  - `apps/erp/test/release-jobs.test.ts` uses `runMRP` with no import (the merge dropped it).
    Mock `~/modules/production/production.service`'s `runMRP`.
  - Port `post-production-event/project-event.test.ts` against
    `production.service.postProductionEvent`.

## Verification

- `cd apps/erp && npx tsgo --noEmit`: 0 errors in `modules/production/**`,
  `purchasing.service.ts`, `purchasing.server.ts`, `routes/x+/job+/**`,
  `routes/x+/{production,purchasing,priority}+/**` and `api+/mrp.ts`. The remaining 110
  errors are in other agents' files (projects, service, contracts, tests, shared.server,
  jira/linear).
- `npx biome check --write` on every file I touched: no errors. The warnings left in
  `production.service.ts` (unused suppressions, `useLiteralKeys`,
  `useIterableCallbackReturn`) were already in main.
