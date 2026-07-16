# Task: PR #1137 Review-3 Fix Pass (Minor Correctness Items)

Branch: `loop/1010-20260714010219`
PR: https://github.com/crbnos/carbon/pull/1137
Issue: #1010

All Critical/Major items from CodeRabbit have been addressed. This pass addresses actionable Minor (correctness) items from the first CodeRabbit review pass that are still open.

## Items to Fix

### Fix 1: `step="any"` on fractional quantity inputs
**File:** `apps/mes/app/routes/x+/batch.$batchId.tsx` (lines 321-346)
The two `<Input type="number">` fields for `row.quantity` and `row.scrapQuantity` don't have a `step` attribute, which means the browser rejects fractional values (like 2.5) even though the validator accepts them.
- Add `step="any"` to both number inputs for quantity and scrapQuantity in the batch completion form.
- Preserve existing `min`, `value`, `disabled`, and `onChange` behavior.

### Fix 2: `jobOperationBatchId` missing from realtime UPDATE handler
**File:** `apps/mes/app/routes/x+/operations.tsx` (line 261)
The realtime UPDATE handler constructs updated operation records but only copies `workCenterId` and `priority`. When `jobOperationBatchId` changes (e.g. a batch is dissolved), the kanban card shows stale batch membership.
- In the UPDATE handler spread, also copy `jobOperationBatchId: updated.jobOperationBatchId`.

### Fix 3: Zero-quantity production rows guard
**Files:**
- `packages/database/supabase/functions/shared/batch-time-split.ts` (lines 165-179)
- `packages/utils/src/batch-time-split.ts` (same logic)

Both files' quantities-building loop persist a Production entry even when `m.quantity === 0`. Zero-quantity Production ledger rows are noise.
- Add guard: only push a `{ type: "Production", ... }` entry when `m.quantity > 0`.
- Keep the Scrap entry behavior unchanged (only when scrapQuantity > 0).
- Both files must be kept in sync (they're intentional mirrors).

### Fix 4: Duration millisecond precision consistency
**File:** `packages/utils/src/batch-time-split.ts` (lines 206-225)
`totalSeconds` rounds the parent span, but the final window is forced to the original millisecond endpoint — the reported `durationSeconds` can differ from the actual timestamp difference.
- Derive each window's `durationSeconds` from its actual `windowEndMs - windowStartMs` rather than from the allocated share.
- The final window should report exactly `(windowEndMs - windowStartMs) / 1000` seconds.
- Keep the same split in the Deno mirror (`packages/database/supabase/functions/shared/batch-time-split.ts`).

### Fix 5: Locale translations
Many locale files have empty `msgstr` for new batch-related strings. Fill them in.

**ERP locales** — fill these keys in each file:
- "Batch Planning" 
- "Batchable"
- "Batchable — multiple jobs can run on this process at the same time"
- "Candidate Operations"
- "New batch"
- "No active batches. Drag an operation onto \"New batch\" to start one."
- "No batchable operations"
- "No material properties"

Files: `packages/locale/locales/ko/erp.po`, `packages/locale/locales/ja/erp.po`, `packages/locale/locales/it/erp.po`, `packages/locale/locales/pl/erp.po`, `packages/locale/locales/tr/erp.po`, `packages/locale/locales/fr/erp.po`, `packages/locale/locales/hi/erp.po`, `packages/locale/locales/es/erp.po`, `packages/locale/locales/ru/erp.po`

**MES locales** — fill these keys:
- "Complete Batch"
- "End Batch"
- "Running"
- "Start Batch"

Files: `packages/locale/locales/pl/mes.po`, `packages/locale/locales/de/mes.po`, `packages/locale/locales/ja/mes.po`, `packages/locale/locales/ko/mes.po`, `packages/locale/locales/ru/mes.po`, `packages/locale/locales/hi/mes.po`, `packages/locale/locales/zh/mes.po`, `packages/locale/locales/tr/mes.po`, `packages/locale/locales/pt/mes.po`

Use accurate translations (AI or approved translations OK — these are locale fallback fills).

PR #1104 already addressed Korean MES translations — do NOT duplicate work, skip `ko/mes.po` if the strings are already translated there.

## Process

1. Check out `loop/1010-20260714010219` worktree or work directly in the repo.
   Preferred: use `/home/openclaw/carbon` (main worktree is on `main`, need a separate worktree).
   
   ```bash
   cd /home/openclaw/carbon
   git fetch origin
   git worktree add /home/openclaw/carbon-loop-1010-review-3 loop/1010-20260714010219
   cd /home/openclaw/carbon-loop-1010-review-3
   git merge origin/main
   ```

2. Apply all 5 fixes above.

3. Run type checks:
   ```bash
   cd /home/openclaw/carbon-loop-1010-review-3
   pnpm --filter @carbon/mes tsc --noEmit
   pnpm --filter @carbon/erp tsc --noEmit
   pnpm --filter @carbon/utils run test
   ```
   All should pass.

4. Commit:
   ```bash
   git add -A
   git commit -m "loop(1010-review-3): fix Minor CodeRabbit items — step=any, realtime sync, zero-qty guard, duration precision, locale fills"
   git push origin loop/1010-20260714010219
   ```

5. Write outcome to `/home/openclaw/carbon/.ai/runs/1010-review-3/outcome.json`:
   ```json
   {
     "state": "shipped",
     "prUrl": "https://github.com/crbnos/carbon/pull/1137",
     "fixes": ["step-any-inputs", "realtime-batchId-sync", "zero-qty-guard", "duration-precision", "locale-translations"],
     "unverified": []
   }
   ```

6. Post a summary comment on PR #1137.
