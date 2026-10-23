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
- 2026-10-23: Tasks 14–16 committed. Issue types `serviceJobInventory`, `serviceJobTrackedEntities` and `serviceJobUnconsume`; operations `completeServiceJob`, `reopenServiceJob` and `setServiceJobCoverage` over one posting, `post-service-job` (registered for the MES); `refreshSalesReturnOrderStatus` in `sales.service.ts`.
  - Journals the tests assert: 1 part at 70 → Dr Cost of Service 70 / Cr Inventory 70. Complete 1.5 h × 40 → Dr Cost of Service 60 / Cr Labor Absorption 60. Reopen reverses it. Warranty 2 h × 40 → Dr Warranty 80. Coverage Warranty→Billable with a part issued → Dr Cost of Service 70 / Cr Warranty 70.
  - Checks: 37 issue and post-service-job tests, 35 utils tests, 81 api tests, and 67 post-receipt, post-shipment and maintenance tests pass. The typecheck passes. `check:manifest` is current. Conformance passes.
- 2026-10-23: Task 19 committed. `createServiceInvoice` operation and its pure line builder. Invoice lines carry `serviceJobId`, and `postSalesInvoice` posts them as revenue only. The live test (1.5 h × 95 + 1 part × 120 = 262.50) proves AR and Sales lines only, with no item ledger row. Without the posting change it fails, so the test is real.
  - Checks: 10 invoice tests and 43 project billing and sales invoice tests pass. The erp typecheck passes. The snapshot adds `service.createServiceInvoicePermission`. `check:manifest` is current.
  - Known gap: voiding a service invoice does not move the job back from Invoiced. The task did not ask for it.
- 2026-10-23: Tasks 17–18 committed. Receiving a Service or Warranty line posts no value and opens the job (Billable or Warranty, Open, Depot). Voiding the receipt cancels the job, or is refused once the job has work. Shipping a serviced unit back posts no value and completes the RMA. A warranty replacement posts Dr Warranty Expense / Cr Inventory.
  - Checks: post-receipt and post-shipment tests pass (66), as do service-job and issue tests (11) and the inventory, create and memo tests (49). The erp typecheck and conformance pass.
- 2026-10-23: Tasks 20, 21 and 26 committed together (both touched `path.ts`). The Jobs list, the new job page and the 3-pane job page all copy the port's maintenance dispatch files. The RMA line gets a return type, an asset and a problem, "Add from assets", a job link and next steps (Ship back, Scrap, No-charge replacement, Change to Return for Service).
  - Checks: the erp and utils typecheck passes. ERP unit tests pass (710), as do the sales, post-receipt and post-shipment tests (202) and conformance. `check:manifest` is current.
  - I fixed `mcp-tool-permissions.test.ts`: two operations need two modules (`sales_changeReturnLineToService`, `service_createServiceInvoice`) and now have override entries. The Task 19 commit had left this test failing.
  - Screenshot checks against the precedents are deferred to Task 38 (no browser overnight).
  - "Keep at zero value" did NOT ship, per the plan's escape hatch: no server path adds a tracked unit to stock at zero cost. After a no-charge replacement, the old unit can only be scrapped.
- 2026-10-23: Tasks 22–25 committed. The job page gets time, parts and charges, the estimate (send, record response, PDF), and Complete, Reopen, coverage change and Create Invoice. New operations `issueServiceJobPart` and `unissueServiceJobPart` wrap the issue posting. The customer asset pages move to `/x/service-jobs/assets` and show the asset's open jobs, its jobs and its RMA lines, plus "New Service Job".
  - Checks: the erp and documents typecheck passes. ERP unit tests pass (710), as do the PDF test, the post-service-job, invoice and issue tests (13) and conformance.
- 2026-10-23: Task 33 committed. The shared `~/components/ScheduleMatrix` (`@dnd-kit/core`) and People matrix drag and drop, backed by the `movePersonCell` operation (`update: production`), which reschedules like the existing move. Clicking a cell still opens the hours modal.
  - Checks: the erp typecheck passes. `schedule-matrix.test.ts` passes (5 tests), and so do the ERP unit tests and the permission tests. There is no live database test: `apps/erp/test/database` has no people-assignment harness.
- 2026-10-23: Task 27 committed. Each dataset seeds 5 service jobs (Open from an RMA receipt, Awaiting Approval, In Progress, Completed Warranty, Invoiced Billable), 8 time rows, 4 estimate lines and 1 charge. Each also gets a labor item set as `serviceLaborItemId`, and an In Progress RMA with a received Return for Service line. The temporary 'In Progress' exclusion is removed. New floors: `serviceJob` 5, `serviceJobTime` 8, `serviceJobEstimateLine` 4, `serviceJobItem` 1.
  - Checks: the database typecheck passes. `db:check:datasets` passes for all four datasets, including the re-apply. In satellite, the Warranty completion posted Dr 6120 / Cr 5060 807.50, and the Billable completion posted Dr 5010 (COGS fallback) / Cr 5060.

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
| 15 | Three operations (`completeServiceJob`, `reopenServiceJob`, `setServiceJobCoverage`) over one posting building block | Each one is a single user action. |
| 15 | A Warranty job refuses to post while `warrantyExpenseAccount` is empty | It is a feature default, not an optional one, so it has no fallback. Cost of Service falls back to COGS. |
| 14 | `serviceJobInventory` refuses a serial or batch part; those go through `serviceJobTrackedEntities` | The maintenance version skips the stock movement and the cost for a tracked part. |
| 14 | `serviceJobUnconsume` with no quantity returns everything still issued, and deletes a line that has nothing left | Task 22's part delete uses it. |
| 16 | A short-closed line that received nothing counts as resolved | Without this, such an RMA could never complete. |
| 16 | `setSalesReturnOrderLineDisposition` also refreshes the RMA status | Disposing of a stock line can complete the RMA. |
| 19 | The invoice refuses a labor item with billable hours and no sale price | It mirrors Complete refusing a labor item with no cost. A silent $0 line would under-bill. |
| 18 | `ShipmentAccountDefaults` does not gain `warrantyExpenseAccount`. The posting resolves the warranty account itself and passes it as `cogsAccountOverride` | A legacy backfill in `accounting.service.ts` builds that type, and the builder does not need the field. |
| 17 | A serialized Service or Warranty line with no assigned serial is refused at receipt | The job and the asset need the serial. |
| 18 | A void of a ship-back puts the asset back At Depot. `quantityShipped` never goes below 0 | Shipments posted before this change never counted. |
| 21 | No `$jobId._index.tsx`. Notes, findings, resolution, repairable and assignee save through `update.tsx` | Maintenance has no index route. Its notes write from the browser, which Rule A forbids. |
| 21 | Asset and Coverage are read-only in the properties panel. A "Billed Item" field shows for Fixed Price jobs | A coverage change posts a journal (Task 24). The invoice needs an item to bill at a fixed price. |
| 26 | Scrap of a serviced unit sets the asset to Returned and posts nothing | The unit has no value on our books. |
| 26 | Lines added from assets get unit price 0 and no `salesReturnOrderLineTrackedEntity` row. The receipt falls back to the asset's serial | The unit stays the customer's. The sales notes call that table legacy. |
| 26 | `changeReturnLineToService` sets the job's coverage, then changes the line, in two steps, not one transaction | Each step goes through its own operation's gate. |
| 26 | Customer assets and job links need `service_view`. A sales-only user sees neither | They come from the service module's RLS. |
| 22 | Time, charges and estimate lines open as drawers in the record outlet; the part picker stays a modal | The plan says drawers. Maintenance uses modals for time entries, but its part picker is a modal too. |
| 22 | A charge line is editable (`$jobId.item.$itemId.tsx`), and one delete route serves both parts (Return to Stock) and charges | Time and estimate lines are editable, so charges are too. |
| 24 | Start, Send Estimate, Complete and Create Invoice submit with no confirm dialog. A refused Complete shows an error toast | Maintenance's Complete does the same. |
| 24 | The properties panel shows the estimate's status and who responded, read-only | After acceptance, nothing else on the page shows it. |
| 33 | **For Brad:** dragging a chip onto a day where the person already works a different station is refused, with "This person already works another work center that day. Open the day to split their hours." Same station merges. | `peopleAssignment_person_day_key` allows one row per person, day and shift, and the plan did not cover this case. The first drag to "the next day" often hits it, so Brad may want another behavior. |
| 27 | The seeded jobs carry no issued parts, only time and charges | An issued part needs the issue posting's stock ledger, cost layer and journal rows, which the tiers do not model. |
| 27 | The Invoiced job's invoice is Draft | `createServiceInvoice` leaves a Draft. Tier 09's invoice posting refuses lines that are not Part lines. |
| 27 | The wipe voids 'Service Job' journals, like the other document sources | A re-apply must void the journals of documents it deletes. |
| 3 | Contract project seeding moved from `seedServiceWork` to a new `seedContractProjects` | `seedServiceWork` also created contract projects, which are not service work. |

## Blocked

None yet.
