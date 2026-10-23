# Service jobs and customer returns — run log

**Plan:** .ai/plans/2026-10-22-service-jobs-and-returns.md
**Spec:** .ai/specs/2026-10-22-service-jobs-and-returns.md
**Branch:** projects-port-main (worktree `kelowna-port`)
**Mode:** autonomous, overnight (Brad, 2026-10-23: "when the branch is updated, let's execute on the service plan autonomously")

## Log

- 2026-10-23: The carry from `projects-wbs-research-spec` finished at `184adfe6e2` (kelowna-49). The spec and plan edits were committed as `62fe17b63f`.
- 2026-10-23: The plan was grounded on the port's operation architecture (`bb0dc937d8`). Every write is a `defineServiceFn` operation, and `packages/server-functions` does not exist on the port.
- 2026-10-23: Shared worktree. kelowna-1d is editing `production.service.ts` (the shop-time region) and `sales.service.ts` (the contract amend op). This run does not edit either file until kelowna-1d reports that its commits landed.
- 2026-10-23: kelowna-1d's fixes landed (`e285f0fa62`, `76b0c3c45c`). `production.service.ts`, `sales.service.ts` and the timesheet files are free.
- 2026-10-23: Tasks 1 and 2 run as one unit. On the port, both edit `apps/erp`, and the ERP typecheck is only green after both.

- 2026-10-23: Tasks 1–3 committed together as `4596289b23` (160 files, −25k lines). The pre-commit dataset check blocks a commit with Tasks 1–2 alone, because the datasets still seeded service orders after the `serviceOrder` sequence left `seed-data.ts`.
  - Checks: typecheck erp, mes, api, utils, documents, ee, database, checks (all pass). Database posting tests: 33 files, 239 tests pass. `db:check:datasets`: all four pass. `check:manifest`: digest current.
  - `@carbon/ee` `src/pegging/peg-writer.write.test.ts` › "writes no peg change when a second run has the same inputs" fails (expected 0 superseded, got 2). It imports only `peg-writer` and `mrp-pegging`, which this run did not change. Not investigated further; flagged for Brad.
- 2026-10-23: Tasks 4–6 committed as `3a7c43341d`. Migrations `20261023065359_remove-service-order-rls` and `20261023065804_remove-service-orders`, applied to the kelowna-port database. `loadSerialBuildNodes` no longer reads `customerAssetComponent`.
  - Checks: the scoped typecheck passes (9 tasks). `src/authz` passes 35/35. `db:check:datasets` and `db:check:backups` pass. `test/database/`: 944 tests, 3 failures. Two were parallel deadlocks that pass on a rerun. `method-import-guards.test.ts` › "refuses a Draft an editor activates while the import waits for it" fails every time ("The import never waited for the row lock"). It touches no table this run changed. Flagged for Brad.
- 2026-10-23: Task 7 committed: the old spec is archived and the old rule, AGENTS file and service-orders reference page are deleted. Service-order sentences are removed from 9 rules, 2 module AGENTS files and 7 docs pages.

## Decisions made without Brad

| Task | Decision | Why |
|---|---|---|
| 1 | Kept `releaseProjectBillableItemStamps` (the project half of the old `releaseServiceOrderStamps`) | Deleting a Draft invoice must still set T&M project billable items back to Unbilled. Only the service-order stamping was removed. |
| 1 | Left `billedServiceLineIds` in `postSalesInvoice` as it is | It also covers project billable item lines. Task 19 extends it for `serviceJobId`. |
| 2 | The Service module and the asset breadcrumb point at Customer Assets until Task 20 | The Jobs list does not exist yet. |
| 2 | Kept "Repair" in the `setSalesReturnOrderLineDisposition` operation's input enum | That enum mirrors the database `disposition` enum shared with quality. Changing it changes the MCP contract. |
| 3 | The validator's "tracked item return line must be Repair" check now applies only to Completed returns | The satellite "bus-repair" line is a serial-tracked unit and is no longer Repair. Receipts are seeded only for Completed returns. |
| 5 | The migration sets `projectId` to NULL on `itemLedger`, `costLedger`, `pickingListLine` and `inventoryCountLine` rows of a Service project, instead of deleting them | Deleting would change stock history. The local database had none. A database with jobs or PO, charge or invoice lines on a Service project's elements stops the migration with an error. |
| 5 | `openProjectMaterialLines` uses `CREATE OR REPLACE VIEW`, not drop and recreate | Nothing depends on the view, and its columns are unchanged. `clobbers` passes. |
| 3 | Contract project seeding moved from `seedServiceWork` to a new `seedContractProjects` | `seedServiceWork` also created contract projects, which are not service work. |

## Blocked

None yet.
