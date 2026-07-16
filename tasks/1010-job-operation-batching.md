# Task Brief: Job Operation Batching — Issue #1010

**Objective:** Implement the full Job Operation Batching feature per the spec at
`/home/openclaw/carbon/.ai/specs/2026-07-03-job-operation-batching.md`.

**Binding will be written at:** `/home/openclaw/carbon/.ai/runs/1010-20260714010219/binding.loop.md`
**Worktree will be at:** (crbn new loop/1010-20260714010219 prints the path — cd into it)
**Issue:** https://github.com/crbnos/carbon/issues/1010
**Branch:** agent/1010-job-operation-batching

## What you need to implement

This is a large feature. Read the full spec first. Key areas:

### 1. DB Migration
- `process.batchable` boolean column (clone `completeAllOnScan` pattern)
- `jobOperationBatch` table with RLS
- `jobOperation.jobOperationBatchId` nullable FK + index
- `productionEvent.jobOperationBatchId` nullable FK + index
- `jobOperationBatchStatus` enum
- `sequence` rows for BAT prefix (per-company seed)
- Re-declare `get_active_job_operations_by_location` (newest def: `20260531084723_rework-serial-flow.sql`) adding `processBatchable`, `jobOperationBatchId`, `batchReadableId`
- New RPC `get_batchable_operations(location_id, process_id)`
- RLS policies: copy newest migration idiom (::text[] casts)
- Run `pnpm run generate:types` after migration

### 2. Edge Function: `batch-operations`
New Supabase edge function at `packages/database/supabase/functions/batch-operations/`.
Follow `.ai/rules/workflow-edge-function.md`. Discriminated union payload:
- `create` — validate eligibility, getNextSequence (BAT…), insert batch, tag members, propagate workCenter
- `add` — same gate per candidate
- `remove` — blocked once any productionEvent exists; removing last member dissolves
- `update` — assign/clear workCenterId, propagate to members
- `dissolve` — blocked once any productionEvent exists (error names recovery)
- `complete` — slice events proportionally (largest-remainder on seconds), insert productionQuantity rows, multi-row Done update, mark batch Completed

### 3. ERP Module Changes
`apps/erp/app/modules/production/`:
- `production.service.ts`: add getJobOperationBatch, getBatchableOperations, getActiveBatchesByProcess, createJobOperationBatch, addToJobOperationBatch, removeFromJobOperationBatch, dissolveJobOperationBatch
- `production.models.ts`: validators per spec
- `resources` module: processValidator + ProcessForm `batchable` checkbox

### 4. MES Changes
`apps/mes/`:
- `getJobOperationBatch` service wrapper
- Operations loader: rows sharing `jobOperationBatchId` collapse to one card
- MES batch view route (`x/batch/$batchId`)
- Complete Batch form with per-member quantity inputs

### 5. UI: Batch Planning Board
New route `x/schedule/batching` in ERP:
- Process + location pickers (batchable processes only)
- Candidate operations left pane with material facet filters (form/substance/grade/dimension/finish + text search)
- Batch lanes right pane with drag-and-drop (`@dnd-kit`)
- Work center assignment on lanes
- Dissolve action

### 6. Schedule Board & MES Kanban Updates
- Schedule board item cards: BAT badge for batched ops, context menu "Batch planning" / "Remove from batch"
- MES kanban: collapse batched ops to one card

## Key constraints
- Never merge jobs — each keeps identity
- Time split proportional to operationQuantity (not even split)
- `pnpm --filter @carbon/harness` sets cwd to packages/harness/ — use ABSOLUTE paths for --cwd
- `DROP VIEW IF EXISTS` + `CREATE VIEW` for any view changes
- Run typecheck + lint before opening PR
- All floor gates must pass

## Expected output
A PR on branch `agent/1010-job-operation-batching` against `main` with all acceptance criteria met or a draft PR with unverified items noted.
