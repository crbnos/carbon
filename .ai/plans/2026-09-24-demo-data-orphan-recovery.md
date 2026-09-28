# Demo data orphan fix + scope-violation recovery — implementation plan

**Spec / source:** `.ai/specs/2026-09-24-demo-data-orphan-recovery.md`
**Branch:** feat/demo-data-completeness

## Progress
- [x] Task 1: `buildDanglingPredicate` + `deleteDanglingRows` in scope.ts (+ tests)
- [x] Task 2: Call it from `wipeAndLoad` on own restores
- [x] Task 3: Template job records scope-violation failures
- [x] Task 4: `CompanyTemplateRun` carries reason/violations
- [x] Task 5: Extract `PurgeCorruptedRowsModal`; backups.tsx uses it
- [x] Task 6: `purgeAndApply` action + demo-data page wiring
- [x] Task 7: `TemplateReviewRow` scope-violation failure UI
- [x] Task 8: Verify (tests, typecheck, lingui) — manual browser check pending (user)

## Dependencies
Task 2 needs 1. Tasks 1–3 independent of 4–5. Task 6 needs 4, 5. Task 7 needs 4, 6. Task 8 last.

---

## Task 1: Dangling-row helpers in scope.ts

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/backups/scope.ts`, adding two exports after `purgeScopeViolations`
- Modify: `packages/jobs/src/backups/scope.test.ts` to add a `describe("buildDanglingPredicate")`
- Precedent: `buildExclusionPredicate` / `violationTerm` in the same file

**Steps:**
1. `export function buildDanglingPredicate(table: TableInfo, byName: Map<string, TableInfo>): RawBuilder<unknown> | null`.
   For each `fk` of `table.foreignKeys` where `fk.refColumn === "id"`, `!RETAINED_REF_TABLES.has(fk.refTable)`,
   `byName.has(fk.refTable)`, and the column exists and is NOT nullable, emit
   `("<col>" NOT IN (SELECT "id" FROM "<refTable>"))`. OR the terms together; return null if there are none.
   Doc comment: the row points at a row that no longer exists ANYWHERE. This is what `ON DELETE CASCADE` would have removed if the wipe hadn't run with `session_replication_role='replica'`. It is not "outside company scope"; those rows go through the user-confirmed purge.
2. `export async function deleteDanglingRows(trx, tables: TableInfo[], byName, companyId, companyGroupId): Promise<Array<{ table: string; rows: number }>>`.
   Walk `[...tables].reverse()`, skip null predicates, and run
   `DELETE FROM <t> WHERE <buildScopeFilter(t, …)> AND (<predicate>)`. Push only non-zero `numAffectedRows`.
3. Tests (compile-only `db` already in the file): a table `employeeAbility` with
   `abilityId → ability` (NOT NULL), `employeeId → user`, and `lastTrainingDate` nullable FK-less. Expect the
   predicate to contain `"abilityId" NOT IN (SELECT "id" FROM "ability")` and not contain `"user"`; a table with only a nullable FK returns null.

**Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/backups/scope.test.ts
# Expected: all tests pass, including the new buildDanglingPredicate cases
```
**Out of scope:** changing `violationTerm`, `purgeScopeViolations`, or the export guard.

## Task 2: Own-restore cleans dangling identity rows

**Depends on:** 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-restore.ts` (`wipeAndLoad`)

**Steps:**
1. Import `deleteDanglingRows` from `../../../backups/scope` (match the existing import path of `ExportScopeViolationError` in this file).
2. Inside the transaction, after the load loop, when `!remap`: build
   `kept = catalog.tables.filter(t => isUserScopedIdentityTable(t) && t.scopeColumn === "companyId")`,
   call `deleteDanglingRows(trx, kept, byName, companyId, targetGroupId)`, and if it returns anything, `logger.warn` / `console.warn` it
   (use whatever logger the file already uses at module level; if none, return it in the result instead and log it at the call site. Do not add a new logger dependency).
3. Update the comment above `selectWipeableTables` usage to mention the cleanup.

**Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/inngest/functions/tasks src/backups && pnpm run typecheck
# Expected: tests pass; tsc exits 0
```
**Out of scope:** changing `selectWipeableTables` semantics or remap behaviour.

## Task 3: Template job records scope violations

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-template.ts`
- Precedent: `company-restore.ts` catch at ~L575-605 and `RestoreMeta` fields

**Steps:**
1. `TemplateMeta`: add `reason?: "scope-violations" | null; violations?: ScopeViolation[] | null; violationRowsByTable?: Array<{table:string;rows:number}> | null;` (import `ScopeViolation`, `ExportScopeViolationError` from wherever company-restore imports them).
2. In the apply's `running` patch, add `reason: null, violations: null, violationRowsByTable: null`.
3. In the apply's `catch (err)`, spread `...(err instanceof ExportScopeViolationError ? { reason: "scope-violations", violations: err.violations, violationRowsByTable: err.rowsByTable } : {})` into the failed patch. After writing, `if (err instanceof ExportScopeViolationError) throw new NonRetriableError(message, { cause: err });`, then `throw err`.

**Verify:**
```bash
cd packages/jobs && pnpm run typecheck
# Expected: exits 0
```
**Out of scope:** the revert and finalize functions.

## Task 4: `CompanyTemplateRun` exposes the failure reason

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/settings/backups.service.ts`: `CompanyTemplateRun` + `getCompanyTemplateRun`
- Modify: `apps/erp/app/routes/x+/settings+/demo-data.tsx`: `optimisticRun` literal gets the new fields
- Precedent: `CompanyExportRun` / `getCompanyExportRun` in the same file

**Steps:**
1. Add `reason: "scope-violations" | null; violations: ScopeViolationSummary[]; violationRowsByTable: RowsByTable[];` to the type, the meta cast, and the projection (defaults `null`, `[]`, `[]`).
2. `optimisticRun` in demo-data.tsx: `reason: null, violations: [], violationRowsByTable: []`.

**Verify:** covered by Task 8's typecheck.

## Task 5: Shared purge confirmation modal

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Backups/PurgeCorruptedRowsModal.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Backups/index.ts`, adding an export
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx`, replacing the inline modal (~L737-800)
- Copy from (precedent): the inline `{purgeRun && (<Modal …>)}` block in backups.tsx

**Steps:**
1. Component props: `rowsByTable: RowsByTable[]; description: ReactNode; confirmLabel: ReactNode; onConfirm: () => void; onCancel: () => void`. Render exactly the current Modal markup: title `Plural` on `totalScopeRows(rowsByTable)`, `description` paragraph, the per-table list (keep its comment), Cancel + destructive confirm.
2. backups.tsx: render `<PurgeCorruptedRowsModal rowsByTable={purgeRun.violationRowsByTable} description={<Trans>…existing text…</Trans>} confirmLabel={<Trans>Delete and restore</Trans>} onCancel={() => setPurgeRun(null)} onConfirm={…existing submit body…} />`. Remove `purgeRowCount` and any imports that become unused.

**Verify:** covered by Task 8 (typecheck + lint); visual check in Task 8.
**Out of scope:** changing the Backups copy or behaviour.

## Task 6: `purgeAndApply` action + page wiring

**Depends on:** 4, 5
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/demo-data.tsx`
- Precedent: `case "purgeAndRestore"` in `apps/erp/app/routes/x+/settings+/backups.tsx`

**Steps:**
1. Import `purgeCorruptedRows` from `~/modules/settings/backups.server`.
2. New `case "purgeAndApply"`:
   - `const current = await getCompanyTemplateRun(client, companyId)`; refuse (`{ success: false, message: "This demo data change can't be retried this way" }`) unless `current.data?.templateRunId === templateRunId && status === "failed" && reason === "scope-violations" && datasetKey && datasetKeys().includes(datasetKey)`.
   - `try { ({ deleted } = await purgeCorruptedRows(companyId)) } catch (err) → { success: false, message: err.message ?? "Failed to remove corrupted data — nothing was deleted" }`.
   - `rows = sum(deleted)`; `try { const startedRunId = await startCompanyTemplate({ companyId, userId, datasetKey }); return { success: true, message: \`Removed ${rows} row(s) — applying demo data\`, templateRunId: startedRunId } } catch → { success: false, message: \`Removed ${rows} row(s), but the demo data didn't start — apply it again. (…)\` }` (same pluralisation as restore).
3. Page component:
   - `const hasLiveRun = run !== null && !resolvedRunIds.includes(run.templateRunId);` and use it in place of `hasRun` in the pendingApplyKey-clearing effect and `optimisticRun` (so an optimistic apply can replace a resolved failed run).
   - Pass to `TemplateReviewRow` a new prop `onPurgeAndApply={() => { setResolvedRunIds(p => [...p, pending.templateRunId]); setPendingApplyKey(pending.datasetKey); }}` and `onPurgeFailed={(id) => { setResolvedRunIds(p => p.filter(x => x !== id)); setPendingApplyKey(null); }}`.

**Verify:** covered by Task 8.
**Out of scope:** the existing apply/keep/revert/dismiss cases.

## Task 7: TemplateReviewRow scope-violation UI

**Depends on:** 4, 5, 6
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/DemoData/TemplateReviewRow.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/RestoreReviewRow.tsx` (failed branch)

**Steps:**
1. Props: add `onPurgeAndApply: () => void` and `onPurgeFailed: (templateRunId: string) => void`.
2. Failed branch: when `run.reason === "scope-violations"`, render (instead of `Failed — {error}`) a `text-xs text-destructive` span with
   `<Plural value={totalScopeRows(run.violationRowsByTable)} one="# row links to data outside this company, so a safety copy of your current data can't be made." other="# rows link …" />` plus
   `<ExcludedRowsInfo excludedRows={run.violations} title={<Trans>Why this failed</Trans>} description={<Trans>Each line is a link from this company's data to a row it doesn't own. Removing those rows lets the demo data apply.</Trans>} technical={run.error} />`.
3. Buttons: when failed + scope-violations, before Dismiss add `<Button variant="destructive" onClick={() => setConfirmPurge(true)}><Trans>Remove corrupted data and apply</Trans></Button>`.
4. `confirmPurge` state renders `PurgeCorruptedRowsModal` with description `<Trans>These rows link to data outside this company, so a safety copy of your current data can't be made. Deleting them cannot be undone. If they turn out to be shared with other companies in this group, nothing is deleted and the demo data isn't applied.</Trans>`, confirmLabel `<Trans>Delete and apply</Trans>`. On confirm: `fetcher.submit({ intent: "purgeAndApply", templateRunId: run.templateRunId, datasetKey: run.datasetKey ?? "" }, { method: "post", action: path.to.demoData })`, `onPurgeAndApply()`, close.
5. A second fetcher `purgeFetcher` for this submit; `useEffect`: when `purgeFetcher.state === "idle" && purgeFetcher.data?.success === false`, call `onPurgeFailed(run.templateRunId)` and `toast.error(purgeFetcher.data.message)` (`toast` from `@carbon/react`, as backups.tsx does).
   NOTE: the row unmounts once hidden, so the effect lives in the ROUTE if the row is hidden optimistically. Put the purge fetcher + effect in the route component instead, pass `onPurgeAndApply(run)` up, and keep only the button + modal in the row.

**Verify:** covered by Task 8.

## Task 8: Verify

**Depends on:** all
**Steps / Verify:**
```bash
cd packages/jobs && pnpm exec vitest run src/backups src/inngest/functions/tasks && pnpm run typecheck
# Expected: all pass, tsc exits 0
cd apps/erp && pnpm run typecheck
# Expected: exits 0
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/routes/x+/settings+/demo-data.tsx apps/erp/app/routes/x+/settings+/backups.tsx apps/erp/app/modules/settings packages/jobs/src/backups packages/jobs/src/inngest/functions/tasks/company-template.ts packages/jobs/src/inngest/functions/tasks/company-restore.ts
# Expected: no errors
```
Manual (user, running stack): on company `dap2gkh860gg2ccl14sg`, apply Aerospace & Satellite. You should see the 4-row message, the info popover, and the button; confirm, and the rows are deleted and the apply reaches `ready`. Then Revert and Apply again: the second apply succeeds.
Do NOT commit (user rule).

## Execution notes (2026-09-24)
- Task 2: added a module-level `getLogger("jobs", "company-restore")` (same pattern as company-export.ts; `@carbon/logger` already a dependency).
- Task 7: the purge fetcher + result effect live in the route (`demo-data.tsx`); the row only owns the button + modal, as the plan's NOTE required. Added a stale-response guard so a retry can't settle on the previous result.
- Task 5: kept the Plural variable name `purgeRowCount` so the existing translated msgid is unchanged.
- Verified: jobs vitest 103/103, jobs tsc, erp tsgo, biome clean, lingui extract adds only the 5 new msgids. Not verified: running app (manual check below).
