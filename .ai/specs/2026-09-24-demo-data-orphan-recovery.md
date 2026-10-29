# Demo data: stop leaving orphan rows on revert, and recover when they exist

> Status: draft
> Author: Aashu
> Date: 2026-09-24

## TLDR

Reverting demo data (and any own-backup restore) can leave per-user rows
(`employeeAbility`, `employeeShift`, `trainingCompletion`) pointing at parents
the revert deleted. The next demo apply then fails at its safety snapshot with
"NOT-NULL reference(s) escape company scope". Fix the cause in `wipeAndLoad`
(drop rows whose parent no longer exists, in the same transaction), and give the
demo-data page the same "Remove corrupted data" recovery the Backups restore
flow already has.

## Problem Statement

Seen on dev company `dap2gkh860gg2ccl14sg` (Carbon Development): applying
"Aerospace & Satellite" failed with

```
Refusing to export dap2gkh860gg2ccl14sg: 3 NOT-NULL reference(s) escape company scope …
  employeeAbility.abilityId → ability (2 rows)
  employeeShift.shiftId → shift (1 row)
  trainingCompletion.trainingAssignmentId → trainingAssignment (1 row)
```

Verified in the DB: the 4 rows reference `ability` / `shift` /
`trainingAssignment` ids that do not exist at all (FKs are validated, so the
rows were orphaned while FK triggers were off). The counts match exactly what
the demo seed inserts (`packages/database/src/datasets/tiers/01-foundation.ts`
L648-659: 2 abilities + 1 shift; `10-ops.ts` L621: 1 completion).

How it happens:

1. Demo apply seeds abilities/shifts/training + the per-user links above.
2. Revert calls `wipeAndLoad(..., remap: false)` (`company-template.ts` ~L493).
3. On `remap: false`, `selectWipeableTables` keeps user-scoped identity tables
   (`isUserScopedIdentityTable`, `company-backup.ts` ~L544) but wipes their
   parents. The wipe runs with `session_replication_role = 'replica'`, so
   `ON DELETE CASCADE` never fires. The parents are not in the pre-apply
   snapshot, so the reload doesn't bring them back. Result: orphans.
4. The next apply's pre-template snapshot (`buildCompanyBackup`) hits the export
   closure guard and refuses.

The same bug hits a normal Backups restore of an own backup: any per-user link
created after the backup, to a parent also created after the backup, is
orphaned.

Second problem: when the guard does fire during a demo apply, the demo page only
shows the raw error. The restore flow already handles this exact failure
(marker `reason: "scope-violations"` + a confirmed "Remove corrupted data and
restore" action); demo data doesn't.

## Proposed Solution

### Part 1: root cause (jobs)

After the load in `wipeAndLoad`, inside the same transaction and only when
`remap === false`, delete rows of the **kept** user-scoped identity tables whose
NOT-NULL FK points at a row that no longer exists. This does exactly what the
suppressed `ON DELETE CASCADE` would have done.

- New helper in `packages/jobs/src/backups/scope.ts`:
  `deleteDanglingRows(trx, tables, byName, companyId, companyGroupId)`, which returns
  `Array<{ table; rows }>`. For each table (reverse catalog order), for each NOT-NULL
  FK (`refColumn = "id"`, ref table not in `RETAINED_REF_TABLES`):
  `DELETE … WHERE <table scope> AND <col> NOT IN (SELECT id FROM <parent>)`.
  "Missing" means **missing anywhere**, not "outside company scope". Pre-existing
  cross-company references are real corruption and stay behind the
  user-confirmed purge (Part 2); this helper only cleans up what the wipe itself
  broke.
- `wipeAndLoad` calls it with
  `catalog.tables.filter(t => isUserScopedIdentityTable(t) && scopeColumn === "companyId")`
  when `!remap` (on remap those tables are already wiped). Logs the deleted
  counts when non-zero.

### Part 2: reuse the scope-violation recovery (demo data)

**Job (`company-template.ts`)**
- `TemplateMeta` gains `reason?: "scope-violations"`, `violations?`,
  `violationRowsByTable?` (same shape as `RestoreMeta`).
- Apply's `catch`: when `err instanceof ExportScopeViolationError`, write those
  fields and throw `NonRetriableError` (same as restore at ~L580-605: the
  verdict is deterministic, so a retry would only flicker the marker).
- Apply's `running` patch resets `reason`/`violations`/`violationRowsByTable` to
  null so a new run never inherits a previous failure's reason
  (`writeTemplateMarker` merges the existing metadata).

**App service (`backups.service.ts`)**
- `CompanyTemplateRun` gains `reason`, `violations`, `violationRowsByTable`
  (typed like `CompanyExportRun`), projected in `getCompanyTemplateRun`.

**Route (`demo-data.tsx`)**: new `purgeAndApply` intent, mirroring
`purgeAndRestore` (`backups.tsx` ~L349):
1. Load the marker; refuse unless `status === "failed"`,
   `reason === "scope-violations"`, `templateRunId` matches, and
   `datasetKey` is present.
2. `purgeCorruptedRows(companyId)` (reused as is). On throw: return its message
   ("nothing was deleted").
3. `startCompanyTemplate({ companyId, userId, datasetKey })`. There is no separate
   finalize: apply already accepts a `failed` marker and overwrites it, and a
   scope-violation run never recorded a snapshot. That avoids racing a
   finalize job against the new apply on the single per-company marker. If this
   half fails, the message says the rows were removed but the apply didn't start
   (same two-step wording as restore).

**UI**
- Extract the purge confirmation modal from `backups.tsx` (~L737-800) into
  `ui/Backups/PurgeCorruptedRowsModal.tsx`. Props: `rowsByTable`, `body` text,
  `confirmText`, `onConfirm`, `onCancel`, `isSubmitting`. Backups keeps its current
  copy; demo data passes its own.
- `TemplateReviewRow`: on `status === "failed"` with
  `reason === "scope-violations"`, show the plain-language line (same `Plural`
  wording as `RestoreReviewRow`) plus the `ExcludedRowsInfo` popover with the
  raw error. Add a destructive **"Remove corrupted data and apply"** button that
  opens the modal; on confirm, submit `intent=purgeAndApply`. Other failures
  keep today's rendering.
- All new copy goes through Lingui (`Trans` / `Plural` / `t`).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Root-cause fix shape | Delete dangling kept identity rows after an own-restore load | User choice. Smallest change; keeps today's "identity rows are kept" semantics; also fixes plain Backups restore. |
| What counts as dangling | Parent row missing entirely (not "outside company scope") | Matches what CASCADE would have done. Deleting real cross-company references stays user-confirmed via the purge. |
| Where the fix lives | `wipeAndLoad` (shared by restore + template revert) | One place covers both callers. |
| Recovery after confirm | Purge, then re-apply the same dataset (the new run overwrites the failed marker) | User choice. Matches `purgeAndRestore`. |
| Purge implementation | Reuse `purgeCorruptedRows` unchanged | Same guard, same data, same group-shared refusal. |
| Confirm modal | Extract a shared component from `backups.tsx` | "Reuse the exact same functionality"; avoids two copies of the destructive-confirm UI. |
| Marker fields | Same names/shapes as restore's (`reason`, `violations`, `violationRowsByTable`) | Lets UI helpers (`totalScopeRows`, `ExcludedRowsInfo`) work unchanged. |

## Data Model Changes

N/A. No schema change; marker metadata is JSON.

## API / Service Changes

- `scope.ts`: `+ deleteDanglingRows`
- `company-restore.ts` `wipeAndLoad`: call it when `!remap`
- `company-template.ts`: `TemplateMeta` fields; catch branch; running-patch reset
- `backups.service.ts`: `CompanyTemplateRun` fields + projection
- `demo-data.tsx`: `purgeAndApply` action

## UI Changes

- New `ui/Backups/PurgeCorruptedRowsModal.tsx`; `backups.tsx` switches to it.
- `TemplateReviewRow.tsx`: scope-violation failure line, info popover, and
  "Remove corrupted data and apply" button + modal.

## Acceptance Criteria

- [ ] Unit test: `deleteDanglingRows` deletes an `employeeAbility` row whose
      `abilityId` doesn't exist, and leaves one whose ability exists (in this or another
      company).
- [ ] Unit/closure test: an own-restore `wipeAndLoad` where the backup lacks an
      `ability` that a live `employeeAbility` references ends with no orphan
      and a clean `findExportScopeViolations`.
- [ ] Manual: apply a demo dataset, revert, apply again: the second apply succeeds
      (no scope-violation error).
- [ ] Manual (dev company `dap2gkh860gg2ccl14sg`, existing orphans): apply shows
      "4 rows link to data outside this company…", an info popover listing the 3
      edges, and a "Remove corrupted data and apply" button. The confirm modal lists
      `employeeAbility 2`, `employeeShift 1`, `trainingCompletion 1`. Confirming deletes
      them and the apply runs to `ready`.
- [ ] A failed apply for any other reason still shows today's error + Dismiss,
      with no purge button.
- [ ] Backups page purge modal looks and behaves as before (shared component).
- [ ] `purgeAndApply` refuses when the marker isn't a failed scope-violation run.
- [ ] All new strings extracted by Lingui; typecheck + existing backup tests pass.

## Open Questions

- [x] How should own-restore handle kept identity rows whose parent it wipes?
      **Answer:** Drop dangling rows after the load (not wipe + reload them);
      smallest change, and it also fixes normal restore.
- [x] After confirming "Remove corrupted data", re-apply automatically or not?
      **Answer:** Purge, drop the failed run, re-apply the same dataset in one
      click, as `purgeAndRestore` does.

## Changelog

- 2026-09-24: Initial draft (both questions resolved with Aashu).
- 2026-09-24: Planning: `purgeAndApply` no longer finalizes the failed run first
  (apply overwrites a failed marker; avoids a finalize/apply race).
