# Task: PR #1137 Review-2 Fix Pass

Branch: `loop/1010-review-1` (already checked out as worktree)
Worktree: find with `git worktree list | grep 1010`
PR: https://github.com/crbnos/carbon/pull/1137

## Context
The review-1 pass addressed the Critical/Major CodeRabbit items. CodeRabbit responded with 7 follow-up comments — 6 are still actionable. Fix all 6 on the existing branch, then push.

Before starting:
1. `cd <worktree-path>`
2. `git fetch origin main && git merge origin/main`

---

## Fix 1: `endProductionEvent` missing companyId scoping

**File:** `apps/mes/app/services/operations.service.ts`  
**File:** `apps/mes/app/routes/x+/batch.event.tsx` (caller)  
**File:** `apps/mes/app/routes/x+/operations.tsx` event route (other caller) — check if it already passes companyId

CodeRabbit says `endProductionEvent` still lacks a `companyId` param and `.eq('companyId', companyId)` filter. Add it:

```ts
export async function endProductionEvent(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    endTime: string;
    employeeId: string;
    companyId: string;
  }
) {
  return client
    .from("productionEvent")
    .update({ endTime: data.endTime, updatedBy: data.employeeId })
    .eq("id", data.id)
    .eq("companyId", data.companyId)
    .select("*");
}
```

Update all callers (`batch.event.tsx`, `event.tsx`) to pass `companyId` from the authenticated session via `requirePermissions`. Verify `@carbon/mes` typechecks.

**Acceptance:** `endProductionEvent` has a `companyId` param; all callers pass it; `@carbon/mes` tsc exits 0.

---

## Fix 2: Add KeyboardSensor to BatchPlanningBoard drag-and-drop

**File:** `apps/erp/app/modules/production/ui/BatchPlanning/BatchPlanningBoard.tsx`

Only `PointerSensor` is registered in `useSensors`. Add `KeyboardSensor` for accessibility:

```ts
import { ..., KeyboardSensor, ... } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"; // if available

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates, // or omit if not using sortable
  })
);
```

Check the existing imports and dnd-kit version to use the right coordinate getter. Verify `@carbon/erp` typechecks.

**Acceptance:** `KeyboardSensor` is registered alongside `PointerSensor`; `@carbon/erp` tsc exits 0.

---

## Fix 3: Re-run generate:types after composite FK migrations

**Context:** CodeRabbit says the generated `packages/database/src/types.ts` doesn't reflect the composite FK columns added in the review-1 pass, suggesting `pnpm run generate:types` wasn't re-run against the latest migrations.

Run:
```bash
cd /home/openclaw/carbon
pnpm --filter @carbon/database run generate:types
```

Then commit the updated `packages/database/src/types.ts`. If the Supabase CLI requires a running DB and isn't available locally, check if there's a `db:generate` or similar script in `packages/database/package.json` and use it. If the generation requires a live Supabase instance (not feasible here), note this in the commit message and skip — the existing generated file should still be correct as far as the migrations define.

Check `packages/database/package.json` for the generate script and what it needs. If it needs a running instance and one isn't available, verify the types file reflects the composite FK columns manually and move on.

**Acceptance:** `types.ts` reflects the composite FK columns from the latest migrations, or a note is added explaining why regeneration requires a live Supabase instance.

---

## Fix 4: jobOperationBatchId should be `string | null` in lib/types.ts RPC return

**File:** `packages/database/supabase/functions/lib/types.ts`

The `get_active_job_operations_by_location` RPC's `RETURNS TABLE` declaration needs `jobOperationBatchId TEXT` (nullable). Check the SQL migration:

```bash
grep -n "jobOperationBatchId" packages/database/supabase/migrations/20260714013500_batchable-operations-rpc.sql
```

If the SQL column is `TEXT` (not `TEXT NOT NULL`), the `lib/types.ts` return type should be `jobOperationBatchId: string | null`. Update the TypeScript type directly in `lib/types.ts` (this is the Deno edge-function types file, not the generated `packages/database/src/types.ts`). Also update the SQL `RETURNS TABLE` declaration to mark it nullable if needed.

**Acceptance:** `lib/types.ts` has `jobOperationBatchId: string | null`; SQL RETURNS TABLE is consistent.

---

## Fix 5: Cancelled batch guard in MES batch UI and action handlers

**File:** `apps/mes/app/routes/x+/batch.$batchId.tsx`  
**File:** `apps/mes/app/routes/x+/batch.event.tsx`  
**File:** `apps/mes/app/routes/x+/batch.complete.tsx` (if it exists)

CodeRabbit says:
- `isCompleted`/`isRunning` logic doesn't treat `Cancelled` as non-actionable — only `Completed` is blocked, leaving `Cancelled` batches still interactive.
- The server-side action handlers in `batch.event.tsx` and `batch.complete.tsx` need an `Active`-only guard so direct POSTs to terminal (`Completed` or `Cancelled`) batches are rejected.

Fixes:
1. In `batch.$batchId.tsx`: change the terminal check from `batch.status === "Completed"` to `batch.status !== "Active"` (disables timer and completion controls for both Completed and Cancelled).
2. In `batch.event.tsx` action: add `if (batch.status !== "Active") return json({ error: "Batch is not active" }, { status: 400 });` before processing.
3. In `batch.complete.tsx` action (if it exists): same Active-only guard.

Verify `@carbon/mes` typechecks.

**Acceptance:** All UI controls and server-side action handlers for batch timers/completion require `batch.status === "Active"`; direct POSTs to Completed/Cancelled batches return 400.

---

## Fix 6: assertOperationsEligible must reject cross-job location mismatches

**File:** `packages/database/supabase/functions/batch-operations/index.ts`

CodeRabbit says `assertOperationsEligible` doesn't currently join `jobOperation → job` to verify `job.locationId === batch.locationId`. This allows operations from jobs at different locations to be batched together.

Add location validation:
1. In `assertOperationsEligible` (or the create/add paths), after fetching the operations, join or query to get `job.locationId` for each operation.
2. Reject if any operation's `job.locationId !== batch.locationId`.
3. Apply this check to BOTH the `create` batch path and the `add` operation path.

The check should happen alongside the existing company and eligibility validation.

Verify the Deno edge function typechecks (or at minimum that the TypeScript is valid).

**Acceptance:** `assertOperationsEligible` (or callers) validate that all submitted operations' jobs share the batch's `locationId`; cross-location operations are rejected with a clear error.

---

## After all fixes

1. Run `pnpm --filter @carbon/mes tsc --noEmit` and `pnpm --filter @carbon/erp tsc --noEmit` — both should exit 0.
2. Commit all changes with message: `loop(1010-review-2): address review-2 feedback — endProductionEvent companyId, KeyboardSensor, Cancelled guard, assertOperationsEligible location check`
3. `git push origin loop/1010-review-1`

Write outcome to `/home/openclaw/carbon/.ai/runs/1010-review-2/outcome.json`:
```json
{
  "state": "shipped",
  "prUrl": "https://github.com/crbnos/carbon/pull/1137",
  "fixes": ["fix1", "fix2", "fix3", "fix4", "fix5", "fix6"],
  "unverified": []
}
```
(adjust `unverified` for anything that couldn't be proven locally)
