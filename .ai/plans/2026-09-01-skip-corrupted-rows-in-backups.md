# Skip corrupted rows in backups; purge before restore — implementation plan

**Spec / source:** `.ai/specs/2026-09-01-skip-corrupted-rows-in-backups.md`
**Branch:** `feat/skip-corrupted-data-in-backups` (worktree `carbon-feat-skip-corrupted-data-in-backups`)
**Local DB with the corruption:** `postgresql://postgres:postgres@localhost:59795/postgres` — companies `dab44qldq0gg27p2p9e0` (Carbon Development) and `JqvzHghaGpe7vTMU1Y27jP` (test comp) each carry 1 cross-company `pickMethod` row + 3 cross-company `jobOperationDependency` rows. **Do not delete them** (Task 11 uses a rolled-back transaction); the user tests the purge in the UI.
**Never `git commit`.**

## Progress
- [x] Task 1: Extract scope SQL into `packages/jobs/src/backups/scope.ts` (pure) and add exclusion/purge builders
- [x] Task 2: Unit-test the pure builders (compile-only Kysely)
- [x] Task 3: `Manifest.excludedRows`, event `skipCorrupted`, edge function pass-through
- [x] Task 4: `buildCompanyBackup({ skipCorrupted })` + export job marker fields
- [x] Task 5: Restore job — classify snapshot failure, store `filePath`/`includeStorage`
- [x] Task 6: ERP service types/readers + `exportCompanyBackup` arg
- [x] Task 7: ERP server `purgeCorruptedRows`
- [x] Task 8: Route actions `exportSkipCorrupted` and `purgeAndRestore`
- [x] Task 9: UI — banner retry button, "N rows excluded" row detail, restore-row CTA + confirm modal
- [x] Task 10: Docs — rule file + spec status
- [x] Task 11: Verification — typecheck, tests, lingui extract, DB-backed dry run

## Dependencies
Task 2 needs 1 · Task 3 independent of 1–2 · Task 4 needs 1, 3 · Task 5 needs 1 · Task 6 needs 3 · Task 7 needs 1 · Task 8 needs 5, 6, 7 · Task 9 needs 6, 8 · Task 10 independent · Task 11 last.
Parallelizable: {1, 3} then {2, 4, 5} then {6, 7} then 8 → 9. Task 10 any time.

---

## Task 1: Extract scope SQL into `packages/jobs/src/backups/scope.ts` and add exclusion/purge builders

**Depends on:** none
**Files:**
- Create: `packages/jobs/src/backups/scope.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — remove `mapWithConcurrency`, `RETAINED_REF_TABLES`, `buildScopeFilter`, `findExportScopeViolations`; add `export * from "../../../backups/scope";`
- Modify: `packages/jobs/src/backups/schema.ts` — append `export * from "./scope";` at the bottom (so `@carbon/jobs/backups` exposes it without a new package subpath; see `.ai/lessons.md` "A new package exports subpath 500s until every running dev server restarts")

**Steps:**
1. Create `scope.ts`. Header comment: "Company-scope SQL for backups: scope predicates, the export closure guard, and the opt-in exclusion/purge of rows whose NOT-NULL FK escapes scope. Keep free of runtime `@carbon/*` imports (type-only OK) — imported by the ERP via `@carbon/jobs/backups` and by bare-`tsx` scripts." Imports:
   ```ts
   import type { KyselyDatabase } from "@carbon/database/client";
   import { type Kysely, type RawBuilder, sql } from "kysely";
   import type { TableInfo } from "./schema";
   ```
2. Move verbatim from `company-backup.ts` (delete there): `mapWithConcurrency` (lines ~184–201), `RETAINED_REF_TABLES` (~410–415), `buildScopeFilter` (~463–491). Keep their doc comments.
3. Add types + error:
   ```ts
   export type ScopeViolation = { table: string; column: string; refTable: string; rows: number };
   export class ExportScopeViolationError extends Error {
     readonly violations: ScopeViolation[];
     constructor(companyId: string, violations: ScopeViolation[]) {
       super(formatScopeViolations(companyId, violations));
       this.name = "ExportScopeViolationError";
       this.violations = violations;
     }
   }
   export function formatScopeViolations(companyId: string, v: ScopeViolation[]): string {
     const lines = v.map((x) => `${x.table}.${x.column} → ${x.refTable} (${x.rows} row${x.rows === 1 ? "" : "s"})`);
     return `Refusing to export ${companyId}: ${v.length} NOT-NULL reference(s) escape company scope, so the backup could never be restored:\n  ${lines.join("\n  ")}`;
   }
   ```
   (Message text must stay byte-identical to today's — the prior spec and prod logs quote it.)
4. Add the pure edge enumerator, used by the guard, the exclusion and the purge so all three agree:
   ```ts
   export type ScopeEdge = { table: TableInfo; column: string; parent: TableInfo };
   /** NOT-NULL FKs (refColumn "id") from an exportable table to another exportable, non-retained table. */
   export function scopeEdges(table: TableInfo, exportableNames: Set<string>, byName: Map<string, TableInfo>): ScopeEdge[]
   ```
   Same filters as today's loop in `findExportScopeViolations`: `fk.refColumn === "id"`, `!RETAINED_REF_TABLES.has(fk.refTable)`, `exportableNames.has(fk.refTable)`, column exists and `!isNullable`.
5. Add `parentExistence(parent, byName, companyId, companyGroupId)` — the existing `parentScope OR <scope.column> IS NULL` (direct) / `parentScope` (via) expression, extracted.
6. Add the pure predicate builder:
   ```ts
   /** SQL predicate selecting the rows of `table` that must be EXCLUDED: a NOT-NULL FK escaping scope
    *  ("violation"), or pointing at a row already excluded from its parent ("cascade"). null = nothing to exclude. */
   export function buildExclusionPredicate(
     table: TableInfo, exportableNames: Set<string>, byName: Map<string, TableInfo>,
     companyId: string, companyGroupId: string | null, excludedIds: Map<string, unknown[]>
   ): { predicate: RawBuilder<unknown>; terms: Array<{ edge: ScopeEdge; cause: "violation" | "cascade"; predicate: RawBuilder<unknown> }> } | null
   ```
   For each edge: violation term = `` sql`(${sql.id(col)} IS NOT NULL AND ${sql.id(col)} NOT IN (SELECT id FROM ${sql.id(parent.name)} WHERE ${parentExistence}))` ``; cascade term (only when `excludedIds.get(parent.name)?.length`) = `` sql`${sql.id(col)} IN (${sql.join(ids.map(v => sql`${v}`))})` ``. `predicate` = terms OR-joined via `sql.join(terms, sql` OR `)`. Return null when no terms.
7. Rewrite `findExportScopeViolations` to return `Promise<ScopeViolation[]>` (not strings), built from `scopeEdges` + the violation term (`count(*)` per edge, concurrency 6, same as today). Preserve the doc comment; add: "Callers format with `formatScopeViolations` or throw `ExportScopeViolationError`."
8. Add the DB-backed exclusion computation:
   ```ts
   export type ScopeExclusions = {
     predicates: Map<string, RawBuilder<unknown>>;   // table → predicate to AND-NOT into the dump
     excludedIds: Map<string, unknown[]>;            // tables with an `id` column only
     summary: Array<{ table: string; column: string; refTable: string; rows: number; cause: "violation" | "cascade" }>;
   };
   export async function computeScopeExclusions(db, exportable: TableInfo[], byName, companyId, companyGroupId): Promise<ScopeExclusions>
   ```
   Iterate `exportable` **in the given (catalog/topological) order**, sequentially (parents before children matters). For each table: `buildExclusionPredicate`; if null continue. For each term: `SELECT count(*)::text AS n FROM t WHERE scope AND term` → push to summary if n>0. If the table has an `id` column: `SELECT id FROM t WHERE scope AND predicate` → `excludedIds.set(name, ids)` when non-empty. Set `predicates.set(name, predicate)` only if any term count > 0 (avoid needless `NOT (...)` on clean tables).
9. Add the purge:
   ```ts
   /** Permanently delete the rows `computeScopeExclusions` would exclude. Call INSIDE a transaction.
    *  Deletes children first (reverse catalog order) so NO ACTION FKs never block. Throws if anything remains. */
   export async function purgeScopeViolations(trx, exportable, byName, companyId, companyGroupId): Promise<{ deleted: Array<{ table: string; rows: number }> }>
   ```
   `const ex = await computeScopeExclusions(trx, …)`; for tables in `[...exportable].reverse()` with a predicate: `DELETE FROM t WHERE scope AND predicate` → collect `numDeletedRows` (Kysely: `const r = await sql`…`.execute(trx); r.numAffectedRows`). Then `const left = await findExportScopeViolations(trx, …)`; if `left.length` throw `new Error("Purge left scope violations behind: " + formatScopeViolations(companyId, left))`.
10. In `company-backup.ts`: delete the moved code, add `export * from "../../../backups/scope";` next to the existing `export * from "../../../backups/schema";`. Fix the `type RawBuilder` import if now unused. `company-backup.transforms.ts` imports `RETAINED_REF_TABLES` from `./company-backup` — still resolves via the re-export; no change.
11. Append `export * from "./scope";` to `schema.ts`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-skip-corrupted-data-in-backups && pnpm --filter @carbon/jobs typecheck
# Expected: exit 0, no errors
pnpm --filter @carbon/jobs test -- src/inngest/functions/tasks/company-backup.closure.test.ts src/backups
# Expected: all existing tests pass
```

**Out of scope:** changing what counts as a violation; touching `company-backup.transforms.ts` logic.

---

## Task 2: Unit-test the pure builders

**Depends on:** 1
**Files:**
- Create: `packages/jobs/src/backups/scope.test.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.test.ts` (DummyDriver Kysely for compile-only SQL) and `packages/jobs/src/inngest/functions/tasks/company-backup.closure.test.ts` (`col`/`table`/`fk` builders)

**Steps:**
1. Build a compile-only `db` exactly as in the precedent. Build `col`, `table`, `fk` helpers as in the closure test (copy them).
2. Tests for `scopeEdges`: (a) nullable FK excluded; (b) FK to `user` (retained) excluded; (c) FK to non-exportable table excluded; (d) NOT-NULL FK to exportable → included.
3. Tests for `buildExclusionPredicate(...)` compiled via `sql`SELECT 1 WHERE ${predicate}`.compile(db).sql`:
   - violation term present: contains `"itemId" is not null and "itemId" not in (select id from "item" where`;
   - cascade term only when parent has excluded ids: with `excludedIds = new Map([["jobOperation", ["op1"]]])` → contains `"operationId" in (`; with empty map → does not;
   - table without `id` column (like `jobOperationDependency`) still returns a predicate;
   - returns null when the table has no qualifying edges.
4. Test `formatScopeViolations("C", [{table:"pickMethod",column:"itemId",refTable:"item",rows:1}])` equals the exact prod string (`Refusing to export C: 1 NOT-NULL reference(s) escape company scope, so the backup could never be restored:\n  pickMethod.itemId → item (1 row)`).
5. Test `ExportScopeViolationError` exposes `.violations` and `.name === "ExportScopeViolationError"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- src/backups/scope.test.ts
# Expected: all tests pass
```

**Out of scope:** DB-backed tests (Task 11 covers with a dry run).

---

## Task 3: `Manifest.excludedRows`, event `skipCorrupted`, edge function pass-through

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/backups/schema.ts` — `Manifest` type
- Modify: `packages/lib/src/events.ts` — `"carbon/company-export"` data
- Modify: `packages/database/supabase/functions/export-company/index.ts` — forward flag

**Steps:**
1. In `Manifest` add after `excludedTables`:
   ```ts
   /** Rows deliberately left out because a NOT-NULL FK escaped company scope ("violation")
    *  or pointed at such a row ("cascade"). Absent/empty = full export. Written only when
    *  the export ran with `skipCorrupted`. */
   excludedRows?: Array<{ table: string; column: string; refTable: string; rows: number; cause: "violation" | "cascade" }>;
   ```
2. In `events.ts` `"carbon/company-export".data` add `/** Opt-in: exclude rows whose NOT-NULL FK escapes company scope instead of refusing. */ skipCorrupted?: boolean;`.
3. In the edge function destructure `skipCorrupted` from the body and send `skipCorrupted: skipCorrupted === true` in the event data.

**Verify:**
```bash
pnpm --filter @carbon/lib typecheck && pnpm --filter @carbon/jobs typecheck
# Expected: exit 0
```

**Out of scope:** bumping `BACKUP_VERSION`; validating manifests.

---

## Task 4: `buildCompanyBackup({ skipCorrupted })` + export job marker fields

**Depends on:** 1, 3
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-export.ts`

**Steps:**
1. Import `computeScopeExclusions`, `ExportScopeViolationError`, `type ScopeViolation` from `./company-backup` (re-exported). Remove the now-unused `findExportScopeViolations` import if no longer used directly (it is still used — see step 3).
2. Add `skipCorrupted?: boolean;` to `buildCompanyBackup`'s `opts` with doc: "Exclude (and record in `manifest.excludedRows`) rows whose NOT-NULL FK escapes company scope, plus rows depending on them. Default false = refuse (the guard is a tenant-leak detector; skipping is a user-confirmed recovery, see spec 2026-09-01)."
3. Replace the violation block:
   ```ts
   let exclusions: ScopeExclusions | null = null;
   if (opts.skipCorrupted) {
     exclusions = await computeScopeExclusions(db, exportable, byName, companyId, companyGroupId);
     if (exclusions.summary.length > 0) {
       log.warn("Company export skipping out-of-scope rows", { companyId, excludedRows: exclusions.summary });
     }
   } else {
     const scopeViolations = await findExportScopeViolations(db, exportable, byName, companyId, companyGroupId);
     if (scopeViolations.length > 0) throw new ExportScopeViolationError(companyId, scopeViolations);
   }
   ```
   `company-export.ts` has no logger today: add `const log = getLogger("jobs", "company-export");` with `import { getLogger } from "@carbon/logger";` (same as `company-backup.ts`). Keep the existing long comment about the refusal being deliberate; append one sentence: "`skipCorrupted` is the ONE sanctioned bypass — user-confirmed after a visible failure, and the manifest records what was dropped."
4. In the per-table dump: `const exclusion = exclusions?.predicates.get(table.name); const exclusionFilter = exclusion ? sql` AND NOT (${exclusion})` : sql``;` and append `${exclusionFilter}` to the `WHERE` right after `${ledgerFilter}`.
5. In the manifest literal add `excludedRows: exclusions?.summary ?? []`.
6. `companyExportFunction`: destructure `skipCorrupted` from `event.data`, pass `skipCorrupted: skipCorrupted === true` to `buildCompanyBackup`.
7. Extend `upsertExportMarker`'s `metadata` type with `reason?: "scope-violations"; violations?: ScopeViolation[]; label?: string | null; includeStorage?: "none" | "all";`. In the `catch`: 
   ```ts
   await upsertExportMarker(client, companyId, userId, {
     status: "failed", startedAt, error: message.slice(0, 2000), label: label ?? null, includeStorage,
     ...(err instanceof ExportScopeViolationError ? { reason: "scope-violations", violations: err.violations } : {})
   });
   ```

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
# Expected: exit 0
```

**Out of scope:** `company-template.ts` / `company-restore.ts` snapshot calls (they keep default `skipCorrupted: false`).

---

## Task 5: Restore job — classify snapshot failure, store `filePath`/`includeStorage`

**Depends on:** 1
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/company-restore.ts`

**Steps:**
1. Import `ExportScopeViolationError, type ScopeViolation` from `./company-backup`.
2. Extend `RestoreMeta` with:
   ```ts
   /** The backup being restored + file choice — kept so a recovery action can restart the same restore. */
   filePath?: string;
   includeStorage?: "none" | "all";
   /** Set when the pre-restore snapshot refused because the LIVE data has out-of-scope rows. */
   reason?: "scope-violations";
   violations?: ScopeViolation[];
   ```
3. In the first `writeRestoreMarker` (status running) add `filePath, includeStorage` to the patch.
4. In the main `catch (err)` of `companyRestoreFunction` (the one writing `status: "failed"`), spread `...(err instanceof ExportScopeViolationError ? { reason: "scope-violations", violations: err.violations } : {})` into the patch.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
# Expected: exit 0
```

**Out of scope:** the revert/finalize functions; `company-template.ts`.

---

## Task 6: ERP service types/readers + `exportCompanyBackup` arg

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/settings/backups.service.ts`

**Steps:**
1. `exportCompanyBackup` args: add `skipCorrupted?: boolean;` (passed through in the body as-is).
2. Add near the top: `export type ScopeViolationSummary = { table: string; column: string; refTable: string; rows: number };` (typed locally — the app must not import job internals; mirror the comment on `CompanyTemplateRun`).
3. `CompanyBackupSummary`: add `excludedRows: NonNullable<Manifest["excludedRows"]>;` (default `[]` in `listCompanyBackupFolders`, set from `m.excludedRows ?? []` when the manifest parses).
4. `getCompanyRestoreRuns`: extend the `meta` cast and returned object with `reason: meta.reason ?? null`, `violations: meta.violations ?? []`, `filePath: meta.filePath ?? null`, `includeStorage: meta.includeStorage ?? null`.
5. `CompanyExportRun`: add `reason: "scope-violations" | null; violations: ScopeViolationSummary[]; label: string | null; includeStorage: "none" | "all" | null;` and populate from `meta` in `getCompanyExportRun`.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0 (RestoreReviewRow's RestoreRun type is structurally satisfied by the wider object)
```

**Out of scope:** UI.

---

## Task 7: ERP server `purgeCorruptedRows`

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/modules/settings/backups.server.ts`

**Steps:**
1. Import `purgeScopeViolations, selectExportableTables` from `@carbon/jobs/backups` (available via the Task 1 re-export).
2. Add:
   ```ts
   /**
    * Permanently delete this company's rows whose NOT-NULL FK escapes company scope (and rows
    * depending on them) — the data the export guard refuses on. Only ever called from the
    * user-confirmed "Remove corrupted data and restore" action. One transaction; children first.
    */
   export async function purgeCorruptedRows(companyId: string): Promise<{ deleted: Array<{ table: string; rows: number }> }> {
     const db = getDatabaseClient();
     const serviceRole = getCarbonServiceRole();
     const company = await serviceRole.from("company").select("companyGroupId").eq("id", companyId).single();
     if (company.error) throw new Error(company.error.message);
     const catalog = await getCompanyTableCatalog(db);
     const { exportable } = selectExportableTables(catalog);
     const byName = new Map(catalog.tables.map((t) => [t.name, t]));
     const result = await db.transaction().execute((trx) =>
       purgeScopeViolations(trx, exportable, byName, companyId, company.data.companyGroupId ?? null)
     );
     log.warn("Backups: purged out-of-scope rows before restore", { companyId, deleted: result.deleted });
     return result;
   }
   ```
   If `getDatabaseClient()`'s type is not assignable to `Kysely<KyselyDatabase>` for `purgeScopeViolations`, STOP and report — do not cast.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```

**Out of scope:** any deletion outside `purgeScopeViolations`.

---

## Task 8: Route actions `exportSkipCorrupted` and `purgeAndRestore`

**Depends on:** 5, 6, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — `action` switch only

**Steps:**
1. Import `purgeCorruptedRows` from `~/modules/settings/backups.server`.
2. Add case `"exportSkipCorrupted"`:
   ```ts
   const run = await getCompanyExportRun(client, companyId);
   if (run.data?.status !== "failed" || run.data.reason !== "scope-violations") {
     return { success: false, message: "There is no failed backup to retry" };
   }
   const result = await exportCompanyBackup(client, { companyId, userId, label: run.data.label ?? undefined, includeStorage: run.data.includeStorage ?? "none", skipCorrupted: true });
   if (result.error) return { success: false, message: await getEdgeFunctionErrorMessage(result.error, "Failed to start backup") };
   return { success: true, message: "Backup started", started: "export" as const };
   ```
3. Add case `"purgeAndRestore"`:
   ```ts
   const restoreRunId = String(formData.get("restoreRunId") ?? "");
   const runs = await getCompanyRestoreRuns(client, companyId);
   const failed = runs.data?.find((r) => r.restoreRunId === restoreRunId);
   if (!failed || failed.status !== "failed" || failed.reason !== "scope-violations" || !failed.filePath) {
     return { success: false, message: "This restore can't be retried this way" };
   }
   if (runs.data?.some((r) => r.status !== "failed")) {
     return { success: false, message: "Finish your current restore — keep or revert it — first." };
   }
   try {
     const { deleted } = await purgeCorruptedRows(companyId);
     await finalizeCompanyRestore({ companyId, restoreRunId });
     const newRunId = await startCompanyRestore({ companyId, userId, filePath: failed.filePath, includeStorage: failed.includeStorage ?? "all", label: failed.label ?? failed.filePath });
     const rows = deleted.reduce((s, d) => s + d.rows, 0);
     return { success: true, message: `Removed ${rows} row${rows === 1 ? "" : "s"} — restoring`, restoreRunId: newRunId, deleted };
   } catch (err) {
     return { success: false, message: err instanceof Error ? err.message : "Failed to remove corrupted data" };
   }
   ```
   (Action messages here are server strings like the existing ones in this file — the route already returns English messages from `action`; keep consistent. The UI-rendered copy in Task 9 is Lingui-wrapped.)
4. Widen the `fetcher` generic in the component to include `deleted?: Array<{ table: string; rows: number }>`.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```

**Out of scope:** UI rendering (Task 9).

---

## Task 9: UI — banner retry button, "N rows excluded" row detail, restore-row CTA + confirm modal

**Depends on:** 6, 8
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/backups.tsx` — component
- Modify: `apps/erp/app/modules/settings/ui/Backups/RestoreReviewRow.tsx`
- Create: `apps/erp/app/modules/settings/ui/Backups/ExcludedRowsInfo.tsx`; export from `ui/Backups/index.ts`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Backups/BackupContentsInfo.tsx` (Popover "i" pattern); `apps/erp/app/components/Modals/Confirm/Confirm.tsx` (modal layout); existing Delete `Confirm` usage in `BackupRow`
- All new strings via `<Trans>` / `useLingui().t` (`@lingui/react/macro`) — see `.claude/rules/i18n-lingui-system.md`; never `t` from `@lingui/core/macro`.

**Steps:**
1. **Failed-export banner** (`{exportFailed && (...)}` block): when `exportRun?.reason === "scope-violations"`, render under the error text a `<span className="text-xs text-muted-foreground">` with `<Trans>Retrying with skip leaves out {count} rows whose links point outside this company. They are listed in the backup's details.</Trans>` where `count = exportRun.violations.reduce((s, v) => s + v.rows, 0)`; and in the button `HStack` add before Dismiss: `<Button onClick={() => fetcher.submit({ intent: "exportSkipCorrupted" }, { method: "post" })} isLoading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "exportSkipCorrupted"}><Trans>Skip corrupted rows and retry</Trans></Button>`. The existing `fetcher.data` effect already handles `started: "export"` (drops the optimistic row).
2. **`ExcludedRowsInfo.tsx`**: props `{ excludedRows: Array<{ table; column; refTable; rows; cause }> }`. Copy the Popover/trigger structure from `BackupContentsInfo` (no fetcher). Trigger: `LuInfo` button, `aria-label={t\`Excluded rows\`}`. Content: title `<Trans>Rows left out of this backup</Trans>`, one line per entry `` `${e.table}.${e.column} → ${e.refTable}` `` left, `e.rows.toLocaleString()` right, and a muted `cause === "violation" ? t\`link outside company\` : t\`depends on an excluded row\``.
3. **`BackupRow`**: compute `const excluded = file.excludedRows.reduce((s, e) => s + e.rows, 0)`. In the ready-branch second line, after the size, append `{excluded > 0 ? <> {" · "}<Trans>{excluded} rows excluded</Trans> <ExcludedRowsInfo excludedRows={file.excludedRows} /></> : null}` (use Lingui `plural` macro from `@lingui/react/macro` if available in the repo — grep `plural(` in `apps/erp/app`; otherwise the `<Trans>` with the number is acceptable).
4. **`RestoreReviewRow.tsx`**: extend `RestoreRun` with `reason: "scope-violations" | null; violations: Array<{ table: string; column: string; refTable: string; rows: number }>;`. Add prop `onPurgeAndRestore: () => void`. In the failed branch, when `run.reason === "scope-violations"`, render before Dismiss: `<Button variant="destructive" onClick={onPurgeAndRestore}><Trans>Remove corrupted data and restore</Trans></Button>`. Also switch the two existing hardcoded strings in this file ("Failed —", "Restore", "restoring…", "reverting…", "rows", "Keep", "Revert", "Dismiss") to `<Trans>`/`t` while here.
5. **Route component**: add `const [purgeRun, setPurgeRun] = useState<(typeof restoreRuns)[number] | null>(null);`. Pass `onPurgeAndRestore={() => setPurgeRun(run)}` to each `RestoreReviewRow`. Render, when `purgeRun`, a `Modal` copied from `Confirm.tsx`'s JSX (Modal/ModalOverlay/ModalContent/ModalHeader/ModalTitle/ModalBody/ModalFooter from `@carbon/react`) but with a plain destructive `Button` instead of `fetcher.Form`:
   - title: `t\`Permanently delete ${total} rows?\`` where `total = purgeRun.violations.reduce(...)`;
   - body: `<Trans>These rows link to data outside this company, so a safety copy of your current data can't be made. Deleting them cannot be undone. The restore will start right after.</Trans>` followed by a `<ul>` of `` `${v.table}.${v.column} → ${v.refTable}: ${v.rows}` ``;
   - confirm button `<Trans>Delete and restore</Trans>` → `fetcher.submit({ intent: "purgeAndRestore", restoreRunId: purgeRun.restoreRunId }, { method: "post" }); resolveRun(purgeRun.restoreRunId); setPurgeRun(null);`
   - cancel `<Trans>Cancel</Trans>` → `setPurgeRun(null)`.
6. In the existing `fetcher.data` effect, change the `result.success && result.restoreRunId` branch to `if (result.deleted) toast.success(result.message);` before `setActive(...)` so the removed-row count is shown, then open the modal as today.
7. Progress modal (`BackupProgressModal.tsx` ~line 293): replace the sentence "The system created an invalid backup — please contact Carbon support." with `<Trans>This backup could not be completed.</Trans>` (the error text below already names the cause; matches the banner copy and copy rule D9).

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
cd /Users/aashu/work/carbon/carbon-feat-skip-corrupted-data-in-backups && pnpm lingui:extract
# Expected: exits 0; `git diff --stat packages/locale/locales/en/erp.po` shows the new msgids added
```

**Out of scope:** restyling existing rows; MES app.

---

## Task 10: Docs — rule file + spec status

**Depends on:** none
**Files:**
- Modify: `.claude/rules/company-backup-restore.md` — the "Out-of-scope rows are FATAL" bullet
- Modify: `.ai/specs/2026-09-01-skip-corrupted-rows-in-backups.md` — status → `in-progress`, changelog line

**Steps:**
1. In the rule, keep the first two paragraphs of the bullet. Replace the sentence starting "Do not rebuild it." through "…lowering the guard." with:
   "The ONE sanctioned bypass (spec `2026-09-01-skip-corrupted-rows-in-backups.md`): after a visible failure the user may click **Skip corrupted rows and retry**, which re-runs the export with `skipCorrupted: true` — `computeScopeExclusions` (`src/backups/scope.ts`) excludes the violating rows *and their dependents*, the job logs a `warn` with the list, and `manifest.excludedRows` records it. A restore blocked by the same rows (its pre-restore snapshot runs the same guard) offers **Remove corrupted data and restore**, which `purgeScopeViolations` deletes in one transaction (children first) after a destructive confirm. Never make either the default, and never skip silently."
2. Add `scope.ts` to the file's `paths:` frontmatter is unnecessary (already covered by `packages/jobs/src/backups/**`). Add one line under the module description mentioning `src/backups/scope.ts` holds the scope predicates/guard/exclusion/purge.
3. Spec: set `> Status: in-progress`; changelog `- 2026-09-01: Plan written (.ai/plans/…); implementation started.`

**Verify:**
```bash
grep -n "Skip corrupted rows and retry" .claude/rules/company-backup-restore.md
# Expected: one match
```

**Out of scope:** `docs/content/docs/platform/backups.mdx` (user-facing docs; leave unless the user asks).

---

## Task 11: Verification — typecheck, tests, lingui extract, DB-backed dry run

**Depends on:** all
**Files:**
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-aashu-work-carbon/bb6cf834-ab54-4876-94f2-28d9a88f9535/scratchpad/scope-dryrun.ts`

**Steps:**
1. `pnpm --filter @carbon/jobs test` and `pnpm --filter @carbon/lib typecheck && pnpm --filter @carbon/jobs typecheck && pnpm --filter erp typecheck`.
2. `pnpm run lint` (Biome) — fix anything in touched files only.
3. DB dry run (does NOT persist): write the scratch script that imports `getCompanyTableCatalog, selectExportableTables` from `<worktree>/packages/jobs/src/backups/schema.ts` and `computeScopeExclusions, findExportScopeViolations, purgeScopeViolations` from `<worktree>/packages/jobs/src/backups/scope.ts`; builds a Kysely with `PostgresDialect` + `pg.Pool({ connectionString: "postgresql://postgres:postgres@localhost:59795/postgres" })`; for company `JqvzHghaGpe7vTMU1Y27jP` (group from `SELECT "companyGroupId" FROM company`):
   - prints `findExportScopeViolations` → expect the 4 edges (1/3/3/3);
   - prints `computeScopeExclusions(...).summary` → expect `pickMethod.itemId→item 1 violation`, and the three `jobOperationDependency` edges at 3 each (all `violation`, no `cascade` — neither table has dependents);
   - runs `db.transaction().execute(async trx => { const r = await purgeScopeViolations(trx, …); console.log(r); throw new Error("ROLLBACK"); })` and catches the error → expect `deleted` = `[{ jobOperationDependency: 3 }, { pickMethod: 1 }]` (order: children first) and no "left behind" error;
   - afterwards re-run `findExportScopeViolations` → expect still 4 (rolled back).
   Run with `cd <worktree> && pnpm --filter @carbon/jobs exec tsx <script>`. If `tsx` cannot import `schema.ts` (CJS interop error naming `@carbon/database`), STOP and report — do not flip any package's `type` field (see `.ai/lessons.md`).
4. Report to the user the manual QA to run in the browser (they own the clicks): (a) Backups → Create backup on **test comp** → fails → banner shows the new button → click → backup becomes Ready with `4 rows excluded` and the info popover lists the four edges; (b) Restore that backup → fails at snapshot → row shows **Remove corrupted data and restore** → confirm modal lists 4 rows → confirm → toast "Removed 4 rows — restoring" → progress modal → Keep/Revert. Note the jobs worker (`packages/dev` `up`) must be restarted to pick up the `@carbon/jobs` changes if it does not hot-reload.

**Verify:**
```bash
pnpm --filter @carbon/jobs test && pnpm --filter erp typecheck
# Expected: both exit 0
```

**Out of scope:** committing; deleting the local corrupted rows.

---

## Run log — 2026-09-01

- Tasks 1–11 done. `pnpm --filter @carbon/jobs test` → 38 files / 572 tests pass (8 new in `scope.test.ts`); `@carbon/jobs`, `@carbon/lib`, `erp` typecheck clean; Biome clean on touched files; `pnpm lingui:extract` + `lingui:clean` added the new msgids to all 13 locales.
- DB dry run (rolled back) against `JqvzHghaGpe7vTMU1Y27jP`: `computeScopeExclusions.summary` = pickMethod.itemId→item 1 + jobOperationDependency {dependsOnId, jobId, operationId} 3 each, all `violation`; `purgeScopeViolations.deleted` = `[jobOperationDependency 3, pickMethod 1]` (children first), zero violations inside the trx, all 4 still present after rollback.
- Not done here (user-owned): browser QA of both flows; restart of the jobs worker (`packages/dev` `up`) if it does not pick up `@carbon/jobs` changes. Not committed (user rule).
