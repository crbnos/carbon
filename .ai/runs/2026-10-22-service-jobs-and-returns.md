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
- 2026-10-23: Tasks 8–11 committed. Migrations `20261023070940_service-job-enum-values`, `20261023071039_service-jobs` and `20261023071226_service-jobs-rls`. The SJ sequence exists for all 34 local companies. Each new table has 4 policies.
  - Checks: typecheck erp, database, api, ee, mes, jobs and documents pass. Database tests pass (121), and so do the ee accounting core tests (372). `db:check:datasets` and `db:check:backups` pass. `check:manifest`: digest current.
- 2026-10-23: Tasks 12–13 committed. `@carbon/utils` `service-job.ts` (24 tests). 22 new `service` operations (8 reads, 14 writes), all exposed as MCP tools.
  - Checks: utils tests and the erp typecheck pass. The posting permissions snapshot is unchanged. `check:manifest` is current, with 1735 operations. Conformance passes.

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
| 10 | The dataset validator excludes the new RMA status 'In Progress' until Task 27 seeds one | Every enum value must be exhibited by a dataset, and none had an In Progress RMA. Task 27's step 4 now removes the exclusion. |
| 10 | 'Service Job' added to `journalEntrySourceTypes`, `Icons.tsx`, the RMA status badge (yellow) and the ee `POSTING_POLICY` (off by default, like every new journal type) | The new enum values broke exhaustive maps in the ERP typecheck. |
| 9 | Composite foreign keys with `ON DELETE SET NULL ("col")` for `customerAsset`, `salesReturnOrderLine`, `reimbursementLine` | Copies the existing `memo` and `reimbursementLine` pattern for composite-key tables. |
| 13 | Estimate lines are locked while the estimate is Sent or Accepted. A Declined estimate is editable again | An accepted Fixed Price total must not drift from its lines. |
| 13 | Send Estimate refuses a job that is not Billable, and an estimate that is already Accepted | The spec allows estimates on Billable jobs only. |
| 13 | A labor item, a charge item and `serviceItemId` must be Service items. An asset, contact and customer location must belong to the job's customer | Ids from a form are checked against the company and the customer. |
| 13 | Status transitions: Start Open→In Progress; Hold Open or In Progress→On Hold; Resume On Hold→In Progress; Cancel from any open status | The spec's state diagram. Complete and Reopen belong to `post-service-job` (Task 15). |
| 3 | Contract project seeding moved from `seedServiceWork` to a new `seedContractProjects` | `seedServiceWork` also created contract projects, which are not service work. |

## Blocked

None yet.
