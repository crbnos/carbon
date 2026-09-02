# Skip corrupted rows in backups; purge them before a restore

> Status: in-progress
> Author: Aashu (with Claude)
> Date: 2026-09-01
> Supersedes the "do not rebuild it" note in `.claude/rules/company-backup-restore.md` — see D1.

## TLDR

A company export refuses to run when any NOT-NULL foreign key in the company's
rows points outside the company's scope (the "corrupted rows" — in practice a
cross-tenant reference). That refusal is correct and stays the default. This spec
adds two explicit, user-driven recoveries: (1) after a **backup** fails for this
reason, a **Skip corrupted rows and retry** button re-runs the export excluding
exactly those rows (and anything that depends on them), records what was excluded
in the manifest, and discloses the count in the Backups list; (2) after a
**restore** fails for the same reason (its automatic pre-restore snapshot hits the
same rows), a **Remove corrupted data and restore** button — behind a destructive
confirmation — permanently deletes those rows from the live database and restarts
the restore. Demo templates are out of scope (their data is ours to fix).

## Problem Statement

Prod company `CG4Zvt9pMsvfgxLb2ijPPy` cannot back up:

```
Refusing to export CG4Zvt9pMsvfgxLb2ijPPy: 4 NOT-NULL reference(s) escape company scope,
so the backup could never be restored:
  pickMethod.itemId → item (1 row)
  jobOperationDependency.jobId → job (3 rows)
  jobOperationDependency.operationId → jobOperation (3 rows)
  jobOperationDependency.dependsOnId → jobOperation (3 rows)
```

`findExportScopeViolations` (`company-backup.ts`) throws before writing any table
file. The user has no way forward except asking support to delete rows by hand. The
same guard runs inside `buildCompanyBackup` for the pre-restore snapshot, so
**Restore** on that company also dies at step 1 (nothing is wiped — it just stops).

An earlier attempt (D3 of `2026-08-25-backup-durability.md`) made the export skip
*silently* and was reverted on 2026-08-26 because it muted the only cross-tenant
leak detector in the system. This spec keeps the detector loud: the export still
fails first, the user must act, and the artifact records what was dropped.

Research: N/A — internal recovery flow over existing guards; no external precedent
applies.

## Proposed Solution

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Default behaviour | Unchanged: export refuses; restore snapshot refuses | Detector stays loud. Skipping is opt-in per failed run, never a standing setting. |
| D2 | Where "skip" is offered | Only on the **failed** export banner, as a retry | A checkbox on the Create form would make bypassing the guard routine. |
| D3 | Retry parameters | Reuse the failed run's `label` + `includeStorage` (stored in the failure marker) | One click; the user asked for *this* backup. |
| D4 | What is excluded | Direct violators **plus cascade**: any row whose NOT-NULL FK (refColumn `id`) targets an excluded row, transitively, in catalog (topological) order | Otherwise the backup fails the restore-side closure preflight and the user is stuck again. |
| D5 | Manifest | Additive optional `excludedRows` field; `BACKUP_VERSION` stays 1 | Old manifests read as "nothing excluded". No compatibility break. |
| D6 | Disclosure | Backups row gets a secondary line `N rows excluded` with a hover/expander listing `table.column → refTable (n)` | Copy rules D9 of prior spec: numbers not adjectives; exact names in a details surface. |
| D7 | Restore recovery | **Delete** the violating rows (with cascade, children first) from the live DB, then restart the restore | The pre-restore snapshot must be a faithful copy; deleting fixes the data instead of hiding it. |
| D8 | Confirmation for D7 | Destructive `Confirm` modal naming the exact count and tables; copy says "permanently" | Irreversible action. |
| D9 | Where the purge runs | Synchronously in the route action, one Kysely transaction, via a `.server.ts` helper | Row counts are tiny; the user gets an immediate result/toast; no new job. |
| D10 | Failure classification | New `ExportScopeViolationError` with structured `violations[]`; both jobs store `reason: "scope-violations"` + `violations` in their marker | UI shows the CTA only for this failure class, never for storage errors etc. |
| D11 | Code location | Scope SQL (`buildScopeFilter`, `findExportScopeViolations`, new exclusion/purge builders) moves to `packages/jobs/src/backups/scope.ts` (pure, kysely `sql` only); `company-backup.ts` re-exports | ERP route needs the purge through `@carbon/jobs/backups`, which must stay free of runtime `@carbon/*` imports (jobs AGENTS rule). |
| D12 | Demo template snapshot | Out of scope | Demo data is code we control; fix the dataset if it ever trips. |
| D13 | i18n | All new UI copy via `<Trans>` / `useLingui().t` | Repo rule; no English-only strings. |

## Data Model Changes

No database migration.

**Manifest** (`packages/jobs/src/backups/schema.ts`):

```ts
export type Manifest = {
  // …existing…
  /** Rows deliberately left out because a NOT-NULL FK escaped company scope
   *  (or depended on such a row). Absent/empty = full export. */
  excludedRows?: Array<{
    table: string;
    column: string;
    refTable: string;
    rows: number;
    /** "violation" = the FK itself escaped scope; "cascade" = it pointed at an excluded row. */
    cause: "violation" | "cascade";
  }>;
};
```

**Marker metadata** (`externalIntegrationMapping.metadata`, JSON, no schema change):

- `company-export` marker on failure gains `reason?: "scope-violations"`,
  `violations?: Array<{table; column; refTable; rows}>`, `label`, `includeStorage`.
- `company-restore` marker on failure gains `reason?: "scope-violations"`,
  `violations?`, and already-needed `filePath`, `includeStorage` (so the purge
  action can restart the same restore).

**Event payload** (`packages/lib/src/events.ts`): `carbon/company-export` gains
`skipCorrupted?: boolean`. The `export-company` edge function passes it through
(boolean-validated).

## API / Service Changes

### `packages/jobs/src/backups/scope.ts` (new; pure)

- `buildScopeFilter(...)` — moved from `company-backup.ts` unchanged.
- `class ExportScopeViolationError extends Error { violations: ScopeViolation[] }`
  where `ScopeViolation = { table; column; refTable; rows }`.
- `findExportScopeViolations(...)` — moved; now returns `ScopeViolation[]`
  (callers format the message; `buildCompanyBackup` throws the typed error).
- `computeScopeExclusions(db, exportable, byName, companyId, companyGroupId)` →
  `{ predicates: Map<tableName, RawBuilder>, excludedIds: Map<tableName, unknown[]>, summary: Manifest["excludedRows"] }`.
  Walks `exportable` in catalog order. For table T, exclusion predicate =
  OR over its NOT-NULL FK edges (refColumn `id`, ref table exportable, not
  retained) of `fk NOT IN (SELECT id FROM parent WHERE parentScope OR companyId IS NULL)`
  (cause `violation`) and `fk IN (excludedIds[parent])` when non-empty (cause
  `cascade`). If T has an `id` column, `excludedIds[T] = SELECT id FROM T WHERE scope AND predicate`.
  Counts per edge come from one `count(*)` per edge (same shape as today's check).
- `purgeScopeViolations(db, exportable, byName, companyId, companyGroupId)` →
  `{ deleted: Array<{table; rows}> }`. Runs inside a transaction the caller
  opens: computes exclusions as above, then `DELETE FROM T WHERE scope AND predicate`
  in **reverse** catalog order (children first) so `NO ACTION` FKs never block;
  re-runs `findExportScopeViolations` at the end and throws if anything remains.

### `buildCompanyBackup` (`company-export.ts`)

New option `skipCorrupted?: boolean` (default false).
- `false`: as today, but throws `ExportScopeViolationError`.
- `true`: no throw; `computeScopeExclusions` once; each table dump becomes
  `WHERE scope AND NOT (predicate)` when the table has one; `manifest.excludedRows = summary`.
  Log at `warn` with the summary — this is the loud trail.

### `companyExportFunction`

Reads `skipCorrupted` from the event. On `ExportScopeViolationError` the failure
marker stores `reason`, `violations`, `label`, `includeStorage`.

### `companyRestoreFunction`

Snapshot step: `ExportScopeViolationError` → failure marker stores `reason`,
`violations`, `filePath`, `includeStorage`. Error message unchanged.

### ERP

- `backups.service.ts`: `CompanyExportRun` gains `reason`, `violations`, `label`,
  `includeStorage`; `getCompanyRestoreRuns` rows gain `reason`, `violations`,
  `filePath`, `includeStorage`. `CompanyBackupSummary` gains
  `excludedRows: Manifest["excludedRows"]` (from the manifest).
- `backups.server.ts`: `purgeCorruptedRows(companyId)` → catalog via
  `getCompanyTableCatalog(getDatabaseClient())`, `selectExportableTables`, then
  `db.transaction().execute(trx => purgeScopeViolations(trx, …))`; returns
  `{ deleted }`. Logs the result with company id.
- Route `x+/settings+/backups.tsx` actions:
  - `exportSkipCorrupted`: reads the failed marker; refuses (toast) if
    `reason !== "scope-violations"`; calls `exportCompanyBackup` with the stored
    `label`/`includeStorage` and `skipCorrupted: true`; returns `started: "export"`.
  - `purgeAndRestore` (`restoreRunId`): reads the failed run; refuses unless
    `reason === "scope-violations"`; `purgeCorruptedRows`; `finalizeCompanyRestore`
    on the failed run (drops its marker); `startCompanyRestore` with the stored
    `filePath`/`includeStorage`; returns `{ restoreRunId, deleted }`.
- Edge function `export-company`: forward `skipCorrupted === true`.

## UI Changes

All copy via Lingui.

**Failed-export banner** (Backups list): when `exportRun.reason === "scope-violations"`
add a primary **Skip corrupted rows and retry** button beside Dismiss, with a one-line
explainer: "The backup will leave out {n} rows whose links point outside this
company. They are listed in the backup's details." Clicking it submits
`exportSkipCorrupted` and drops the optimistic "Creating backup…" row as today.

**Backups list row**: when `file.excludedRows?.length`, second line appends
`· {total} rows excluded`; hovering/clicking a small info affordance shows
`table.column → refTable ({n}, violation|cascade)` lines.

**Progress modal (export, failed)**: replace the "please contact Carbon support"
sentence with the error text (already shown) — no new button here; the banner owns
the action.

**Restore review row (failed)**: when `run.reason === "scope-violations"` show
**Remove corrupted data and restore** (destructive variant) next to Dismiss. Opens
`Confirm` (destructive): title "Permanently delete {n} rows?"; body lists the
tables and counts and says the rows will be deleted from this company, cannot be
recovered, and the restore will then start. Confirm → `purgeAndRestore` →
toast "Removed {n} rows" → progress modal opens for the new restore run.

## Acceptance Criteria

- [ ] On local DB (both companies carry 1 `pickMethod` + 3 `jobOperationDependency` cross-company rows), Create backup fails with the existing message and the banner shows **Skip corrupted rows and retry**.
- [ ] Clicking it produces a `ready` backup; its manifest `excludedRows` totals 4 rows across `pickMethod` and `jobOperationDependency` (jobOperationDependency counted once per row, not per edge); the list row reads `4 rows excluded` and the details list the four edges.
- [ ] Restoring that skipped backup into a company **without** corrupted rows passes `assertReferentiallyClosed` and completes.
- [ ] A failed export for any other reason (e.g. missing companyGroup) shows Dismiss only.
- [ ] Restore on a corrupted company fails at the snapshot; the failed row shows **Remove corrupted data and restore**; other restore failures do not.
- [ ] Confirming deletes exactly the 4 rows (and any dependents) — `findExportScopeViolations` returns empty afterwards — and a new restore run starts and completes; the deleted counts appear in the toast and server log.
- [ ] Cancelling the confirm deletes nothing.
- [ ] Unit tests: `computeScopeExclusions` cascade (child of excluded parent is excluded; table without `id` is excluded by predicate); `purgeScopeViolations` order (children before parents); manifest without `excludedRows` still validates.
- [ ] `pnpm --filter @carbon/jobs test`, `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp`, `pnpm lingui:extract` all pass; `.claude/rules/company-backup-restore.md` updated to describe the opt-in skip and purge.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Purge deletes more than the user expects via cascade | Med | Confirm modal lists every table + count computed at click time; transaction; server log. |
| Skip becomes the habitual path and leaks go unnoticed | Med | Only reachable after a visible failure; `warn` log with violations on every skipped export; manifest records it. |
| `NOT IN` semantics with NULL ids | Low | Every predicate guards `fk IS NOT NULL`; `id` is a PK. |
| Concurrent restore/export while purging | Low | Existing per-company concurrency keys; purge is one short transaction. |

## Open Questions

> All resolved with the user on 2026-09-01 before writing.

- [x] Retry parameters — **Answer:** reuse the failed run's label + include setting; no standing checkbox.
- [x] Cascade exclusion to dependents — **Answer:** yes, and count them in the manifest.
- [x] Disclosure in the list — **Answer:** `N rows excluded` line plus details of `table.column → refTable`.
- [x] Pre-restore snapshot hitting the same rows — **Answer:** don't skip in the snapshot; offer "Remove corrupted data permanently" with a confirmation modal, then continue the restore. Demo-template snapshot out of scope.

## Changelog

- 2026-09-01: Plan written (`.ai/plans/2026-09-01-skip-corrupted-rows-in-backups.md`); implementation started.
- 2026-09-01: Created after interview; supersedes the reverted D3 of the 2026-08-25 backup-durability spec with an explicit, user-driven variant.
