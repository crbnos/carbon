---
id: "1010-20260714010219"
kind: feature
risk: high
issue: 1010
title: "Job Operation Batching — combine shared preparation across concurrent production orders"
acceptance:
  - "Toggling batchable on a process makes its unstarted job operations appear on the batch planning board; unflagged processes absent from process picker and their operations never offer batch actions"
  - "Filtering candidates by substance=Steel + grade=A36 + dimension=1/4in shows exactly the operations whose BOM lines resolve to those material properties; aluminum operations disappear; operations with no material-bearing BOM lines group under 'No material properties'"
  - "Dragging 3 operations (different jobs, different items) into 'New batch' creates a jobOperationBatch with BAT-sequence readableId, tags all 3, and both boards render one card; dragging one out again untags it; a 30-member batch is accepted (no cap)"
  - "Assigning the batch a work center writes that workCenterId to every member operation; adding an op to a work-centered batch sets the op's work center"
  - "Server rejects with specific error: mixing processes, non-batchable process, started operation, already-batched operation, add/remove/dissolve after any batch production event (dissolve error names recovery: complete the batch)"
  - "Starting the batch in MES creates productionEvent rows tagged with jobOperationBatchId; batch card shows running timer"
  - "Completing a batch (members qty 5/20/10, one 70-minute machine event) yields per-member events of 10/40/20 minutes (largest-remainder on seconds, contiguous windows), per-member productionQuantity rows matching entered quantities (+ scrap rows where entered), one issue call per member consuming that job's own BOM, all members Done in one action, each member job's next operation independently flipping to Ready, batch Completed, post-production-event posting GL per member event"
  - "Job costing / estimates-vs-actuals for each member job shows its proportional share with no special-case code path"
  - "Jobs/operations never batched behave byte-for-byte as before; pnpm exec turbo run typecheck --filter=erp --filter=mes, lint, and tests pass"
  - "The superseded feature's terminology (case-insensitive grep pattern st[i]tch) appears nowhere in the shipped code, migrations, or docs for this feature"
---

# Job Operation Batching — combine shared preparation across concurrent production orders

Full spec: `/home/openclaw/carbon/.ai/specs/2026-07-03-job-operation-batching.md`
Task brief: `/home/openclaw/.openclaw/workspace/tasks/1010-job-operation-batching.md`
Worktree: `/home/openclaw/carbon-loop-1010-20260714010219`
Branch: `agent/1010-job-operation-batching`

## Summary

Some processes (laser cutting, heat treat, plating) can run multiple jobs simultaneously. Today Carbon forces one run per job. This feature adds:

1. `process.batchable` boolean — the machine determines simultaneity
2. `jobOperationBatch` table — a lightweight join over N real jobOperation rows
3. `batch-operations` edge function — create/add/remove/dissolve/complete
4. Batch planning board (ERP) — drag-and-drop with material facet filters
5. MES batch card + Complete Batch form — per-member quantity, proportional time split
6. Schedule board + MES kanban updates — BAT badges, collapsed cards

## Key decisions (final)
- Batchability lives on `process.batchable` (NOT on item or routing step)
- Time/cost split: proportional to planned `operationQuantity`, materialized as per-member productionEvent slices at completion (largest-remainder rounding on seconds)
- No batch size cap; minimum 1 member
- No same-item restriction (double opt-in at process level is sufficient)
- Manual board only in v1; no auto-suggestions

## Implementation notes
- Clone `completeAllOnScan` pattern for the boolean field in ProcessForm
- Use `DROP VIEW IF EXISTS` + `CREATE VIEW` (never `CREATE OR REPLACE VIEW`) for get_active_job_operations_by_location re-declaration
- Newest definition of that function: `20260531084723_rework-serial-flow.sql`
- `pnpm --filter @carbon/harness` sets cwd to packages/harness/ — use ABSOLUTE paths for --cwd
- Run `pnpm run generate:types` after migration before typecheck
- Follow `.ai/rules/workflow-edge-function.md` for the edge function
- RLS: `::text[]` casts, policy names "SELECT"/"INSERT"/"UPDATE"/"DELETE"
- Sequence prefix: `BAT`, table `jobOperationBatch`, size 6
- Lesson: `DEFAULT_CONFIG.doerMaxBudgetUsd = 5` is tight for this feature size — use `--doer-budget 12`
