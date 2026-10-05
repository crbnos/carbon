# Close wizard asks the runs what is due — implementation plan

**Spec:** none. Decisions from the conversation of 2026-10-04 (below).
**Builds on:** .ai/plans/2026-10-04-period-runs-hardening.md (Recalculate, more than one run per period).
**Branch:** revenue-recognition-rentals-spec

## Decisions (Brad, 2026-10-04)

| # | Decision |
|---|---|
| E1 | The close checklist asks the run engines what a run would do now, instead of copying their rules. |
| E2 | Revenue recognition: a dry run of the proposal (synthesizers + due rows) in a transaction that always rolls back. |
| E3 | Depreciation: `buildDepreciationRunLines` for the period end — the lines New Run would create. |
| E4 | Each task shows what is due (count and amount), and offers **Create run**. |
| E5 | Never leave an empty run: Create run, New Run and the dry run create nothing when nothing is due. |

Terms:

- **Run preview**: `{ revenue: { count, amount }, depreciation: { count, amount } }` for one period end.
- **Due**: in the preview, or held by a Draft run of the period that is not posted.

## Progress

- [x] Task 1: Add the `preview-revenue-recognition-run` server function
- [x] Task 2: Move `buildDepreciationRunLines` to the service and add `createDepreciationRun`, which refuses an empty run
- [x] Task 3: Add `getPeriodRunPreview` and feed it to the readiness checks
- [ ] Task 4: Show what is due and a Create run button on the close page
- [ ] Task 5: Update AGENTS.md and the fixed-asset rule
- [ ] Task 6: Verify in the browser

## Dependencies

- Task 3 needs Tasks 1 and 2. Task 4 needs Task 3. Tasks 5 and 6 come last.

---

## Task 1: Add the `preview-revenue-recognition-run` server function

**Files:**
- Create: `packages/server-functions/src/preview-revenue-recognition-run/index.ts`
- Modify: `packages/server-functions/src/invoke.ts`, the permissions snapshot
- Create: `packages/server-functions/src/preview-revenue-recognition-run/preview-revenue-recognition-run.test.ts`

**Steps:**
1. Input `{ periodEnd }`. Permissions `{ view: "accounting" }`.
2. In one transaction, run `RUN_ROW_SYNTHESIZERS`, then `selectDueScheduleRows`.
3. Throw a private sentinel at the end of the transaction, so it always rolls back. Catch only that sentinel.
4. Return `{ count, amount }` of the due rows.
5. Test against the local database:
   1. A Planned row due by the period end counts. A row held by a run does not count.
   2. After the preview, the schedule table and the run table have the same rows as before.

**Verify:** `vitest run src/preview-revenue-recognition-run` with the local `SUPABASE_DB_URL` — all pass.

## Task 2: Move `buildDepreciationRunLines` and add `createDepreciationRun`

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`, `accounting.server.ts`
- Modify: `apps/erp/app/routes/x+/accounting+/depreciation-runs.new.tsx` and every route that imports `buildDepreciationRunLines`

**Steps:**
1. Move `buildDepreciationRunLines` from `accounting.server.ts` to `accounting.service.ts`. It reads only through the Supabase client. Leave no `@mcp` tag.
2. Add `createDepreciationRun(client, { companyId, companyGroupId, periodEnd, userId })` to the service. It builds the lines, returns the error "Nothing to depreciate for this period" when there are none, else calls `insertDepreciationRun`.
3. Use it in the New route. A run with no lines is no longer created.

**Verify:** typecheck `erp`; the accounting tests pass.

## Task 3: Add `getPeriodRunPreview` and feed it to the readiness checks

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`, `accounting.periods.test.ts`
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx` (loader)

**Steps:**
1. Add `getPeriodRunPreview(client, db, companyId, periodEnd)`. It calls the Task 1 function and `buildDepreciationRunLines`. If a later depreciation run is posted, the depreciation preview is empty: per-month posting already put those months in their periods.
2. Give `computePeriodReadiness` a `runPreview` argument. Delete `countUnaccruedRentalLines` and the contract-revenue count it replaces.
3. `unposted-revenue-schedules` fails when the preview has rows or a Draft run holds a row due by the period end. Its count is both; add `amount`.
4. `draft-depreciation` fails when the preview has lines or a Draft run ends in the period. Its count is the assets due plus the Draft runs; add `amount`.
5. Give the MCP entry points (`getPeriodCloseChecklist`, `getPeriodCloseReadiness`) a `db` argument; they compute the preview. `closeAccountingPeriod` takes an optional preview function so the scripted tests can pass zeros.
6. Replace the scripted rental/contract readiness tests with tests that pass a preview value.

**Verify:** typecheck `erp`; `vitest run app/modules/accounting` — all pass.

## Task 4: Show what is due and a Create run button

**Files:** `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`; precedent: the existing "Go to … runs" links in the same file.

**Steps:**
1. Under each failing run task, show "N due · $amount".
2. Add a Create run button that posts intent `create-revenue-run` or `create-depreciation-run` with the period end.
3. In the action, create through `propose-revenue-recognition-run` or `createDepreciationRun`. Redirect to the new run. If nothing is due, flash the refusal; never create an empty run.
4. Update both task descriptions to say the check asks the run what it would do.

**Verify:** typecheck `erp`.

## Task 5: Update AGENTS.md and the fixed-asset rule

Name `preview-revenue-recognition-run`, `getPeriodRunPreview`, `createDepreciationRun`, and the new meaning of the two checks.

## Task 6: Verify in the browser

Use the isolated session from `.ai/playbooks/period-runs.md`. Cases:
1. The October close task shows the revenue due and Create run makes a Draft that holds it.
2. A period with nothing due shows the tasks passing.
3. Depreciation shows assets due for a period with no run.
4. Create run with nothing due flashes a refusal and creates no run.
