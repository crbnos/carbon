# Task: PR #1137 Review-2 Fix Pass (Remaining Items)

Branch: `loop/1010-review-1`
Worktree: `/home/openclaw/carbon-loop-1010-review-2`
PR: https://github.com/crbnos/carbon/pull/1137

## Already Done (DO NOT redo)
- Fix 1: `endProductionEvent` companyId scoping — done in commits 940a5bee8 and 0a0d0289b
- Critical: two-phase Completing batch status — done in commit 0a0d0289b

## Remaining Fixes (do all of these)

### Fix 2: Add KeyboardSensor to BatchPlanningBoard drag-and-drop
**File:** `apps/erp/app/modules/production/ui/BatchPlanning/BatchPlanningBoard.tsx`

Only `PointerSensor` is registered in `useSensors`. Add `KeyboardSensor` for accessibility:
- Import `KeyboardSensor` from `@dnd-kit/core`
- Import `sortableKeyboardCoordinates` from `@dnd-kit/sortable` if available
- Add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` to the useSensors call
- Verify `@carbon/erp` typechecks

### Fix 3: Re-run generate:types (or manually verify composite FK columns reflected)
Check `packages/database/package.json` for the generate script. Run:
```bash
pnpm --filter @carbon/database run generate:types
```
If it requires a live Supabase instance, verify that `packages/database/src/types.ts` contains the composite FK columns from the latest migrations. If regeneration is not feasible, document why in the commit message.

### Fix 4: jobOperationBatchId should be `string | null` in lib/types.ts
**File:** `packages/database/supabase/functions/lib/types.ts`

The `get_active_job_operations_by_location` RPC return type has `jobOperationBatchId: string` but the underlying column is nullable. Change it to `jobOperationBatchId: string | null`. Also check the SQL `RETURNS TABLE` declaration in the migration and ensure it is consistent (no `NOT NULL`).

### Fix 5: Cancelled batch guard in MES batch UI and action handlers
**Files:**
- `apps/mes/app/routes/x+/batch.$batchId.tsx` — change terminal check from `batch.status === "Completed"` to `batch.status !== "Active"` for UI controls
- `apps/mes/app/routes/x+/batch.event.tsx` — add `if (batch.status !== "Active") return json({ error: "Batch is not active" }, { status: 400 });` guard in the action handler
- `apps/mes/app/routes/x+/batch.complete.tsx` (if it exists) — same Active-only guard

Verify `@carbon/mes` typechecks.

### Fix 6: assertOperationsEligible must reject cross-location mismatches
**File:** `packages/database/supabase/functions/batch-operations/index.ts`

In `assertOperationsEligible` (and/or the create/add paths), after fetching operations, join `jobOperation → job` to verify `job.locationId === batch.locationId`. Reject operations whose job has a different location. Apply to BOTH `create` and `add` paths.

---

## After all fixes

1. Run:
   - `pnpm --filter @carbon/mes tsc --noEmit`
   - `pnpm --filter @carbon/erp tsc --noEmit`
   Both should exit 0 (or document any errors that are pre-existing).

2. Commit all changes with message:
   `loop(1010-review-2): fix remaining CodeRabbit Majors — KeyboardSensor, Cancelled guard, assertOperationsEligible location check, jobOperationBatchId nullability`

3. `git push origin loop/1010-review-1`

4. Write outcome to `/home/openclaw/carbon/.ai/runs/1010-review-2/outcome.json`:
```json
{
  "state": "shipped",
  "prUrl": "https://github.com/crbnos/carbon/pull/1137",
  "fixes": ["keyboard-sensor", "cancelled-guard", "location-check", "jobOperationBatchId-nullable"],
  "unverified": []
}
```
(adjust `unverified` for anything that couldn't be proven locally)

Working directory for all git operations: `/home/openclaw/carbon-loop-1010-review-2`
