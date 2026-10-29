# Cross-company restore: preserve readable ids, rewrite model artifact paths

**Status:** Approved (design)
**Date:** 2026-09-18
**Branch:** `feat/supabase-bucket-migration` (user's explicit choice)

## Summary / Problem

A cross-company restore into a fresh company silently produces a broken company.
Verified on the local stack: company `D9NBZmY2FhSSeFCxWkdahi` ("alone"), restored
from source company `cvnu9ldl6de9mjn9edvg`.

Two independent defects, both invisible on a same-company restore (where `remap`
is a no-op) and both only reachable cross-company — which is why prior manual
testing passed.

1. **Items pages are empty.** 1096 `item` rows and 860 `part` rows restored fine,
   but the `parts` view returns 0. The view inner-joins `part.id =
   item."readableId"`; restore had replaced every `part.id` with a 21-char nanoid.
2. **Assemblies will not load.** `modelUpload` path columns still point at the
   SOURCE company (`cvnu9ldl6de9mjn9edvg/models/...`). The files were copied to the
   target company's prefix correctly; only the DB columns are stale.

## Goals

- A cross-company restore preserves human-authored readable ids on item-child tables.
- A cross-company restore rewrites every `modelUpload` storage-path column.
- A future table or path column that needs this treatment fails a test rather than
  silently producing a broken restore.

## Non-goals

- Repairing already-restored companies (no data-migration script). The user can
  re-restore after the fix.
- Changing the additive reseed/import path's collision handling (see Decision 3).
- Revisiting the August composite-PK fix — it is correct and stays.

## Root causes

### Bug 1 — readable ids rewritten (introduced 2026-08-31, `2a19048def`)

`2a19048def` correctly removed the `hasId` (PK exactly `id`) gate from
`buildIdMaps` so that ~25 composite-PK tables get fresh ids. Five of those tables
back their `id` with a global `UNIQUE (id)`, so leaving source ids in place made a
cross-company restore collide with the source company's still-live rows.

But five OTHER tables have PK `(id, companyId)` where `id` is not an identifier at
all — it is a human-authored readable key that foreign-keys (by value, with no FK
constraint) to `item."readableId"`:

| table | example id |
|---|---|
| `part` | `ADCS-001` |
| `material` | `MAT-AL7075-PLT` |
| `consumable` | `CN-GREASE-001` |
| `service` | `SVC-TVT` |
| `tool` | `TL-PROBE-VNA` |

Verified in healthy company `dame5i2iq0gg29pkj26g`: all five join 1:1 to
`item."readableId"` (22/22, 6/6, 2/2, 1/1, 2/2). In the restored company all five
hold nanoids and join zero rows.

**Structural separation that makes the fix safe:** the five tables the August fix
targeted (`changeOrderRequiredAction`, `balloon`, `inspectionDocument`,
`inspectionFeature`, `demandProjection`) all carry a global `UNIQUE (id)`. The five
readable-id tables carry ONLY the composite PK — verified via `pg_index`. So
excluding the readable-id five cannot reintroduce the collision the August fix
solved: they are disjoint sets, separated by a real schema property.

### Bug 2 — model artifact paths not rewritten (introduced 2026-07-20, `1cce52f44a`)

That commit changed `STORAGE_PATH_COLUMNS` from `{modelPath, thumbnailPath}` to
`{thumbnailPath}`, with the rationale that raw models had moved to the transient
`temp-staging` bucket and were therefore never carried by a backup. The same commit
added `glbPath` and `graphPath` columns to `modelUpload` and did not add them to the
set.

**The rationale is stale.** `company-export.ts:246` builds the asset list by
LISTING the private bucket recursively under `{companyId}/`, not by reading path
columns — so everything under `{companyId}/models/` is backed up, raw CAD included.

Measured on the restored company (8 `modelUpload` rows):

| column | rows still pointing at source company |
|---|---|
| `thumbnailPath` | 0 (in the set — works) |
| `modelPath` | 8 |
| `glbPath` | 4 |
| `graphPath` | 4 |

## Design

### Change 1 — `READABLE_ID_TABLES` exclusion in `buildIdMaps`

Add to `packages/jobs/src/inngest/functions/tasks/company-backup.ts`, beside
`STORAGE_PATH_COLUMNS`:

```ts
export const READABLE_ID_TABLES = new Set([
  "part", "material", "consumable", "service", "tool"
]);
```

`buildIdMaps` (`company-backup.transforms.ts`) skips these tables, minting no map,
so `buildRowTransforms` copies `id` verbatim (it already keeps ids for tables absent
from `idMaps` — covered by the existing "does NOT crash on an int/serial-id table
absent from idMaps" test).

Why an explicit list rather than a derived rule: a schema-derived predicate was
tested and rejected. `composite PK + text id + no global UNIQUE(id)` matches **65**
tables including `workflow`, `kanban`, `inventoryCount`, `stockTransfer` — all of
which legitimately need remapping. No structural marker distinguishes the five
(no `itemId` column, no FK on `id`).

### Change 2 — restore `modelPath` and add the new artifact columns

```ts
export const STORAGE_PATH_COLUMNS = new Set([
  "thumbnailPath", "modelPath", "glbPath", "graphPath"
]);
```

Replaces the stale "raw models are not backed up" comment with the listing-based
reality.

### Change 3 — regression guards (pure, no DB)

In `company-backup.closure.test.ts`:

1. **Readable-id preservation:** `buildIdMaps` over a fixture including `part` and a
   normal table asserts `part` gets no map and the normal table does; a
   `buildRowTransforms` case asserts `part.id` survives verbatim under `remap=true`.
2. **Disjointness invariant:** assert `READABLE_ID_TABLES` contains no table that
   the August fix requires remapping (the `UNIQUE (id)` five), encoded as a literal
   list — so a future edit that adds one to both fails.
3. **Path-column coverage:** assert `STORAGE_PATH_COLUMNS` contains every known
   `modelUpload` artifact column, from a literal list of that table's path columns.
   A newly added artifact column must be added to both lists, and the test names
   what is missing.

The guards are fixture-based, matching the existing suite (no DB access).

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| How to identify readable-id tables | Explicit `READABLE_ID_TABLES` constant | Derived rule tested and rejected — matches 65 tables including ones that must remap. User chose explicit. |
| Behaviour on additive reseed/import | Skip in both paths | A readable id must never be rewritten regardless of path. Restore is wipe-first so it is safe; on reseed a same-named part would hit the composite PK and fail loudly rather than corrupt data. User chose this. |
| `modelPath` in `STORAGE_PATH_COLUMNS` | Include, with `glbPath`/`graphPath` | Backup enumerates the bucket by listing, so raw models ARE carried; 8 rows measured stale. User chose this. |
| Repair existing restored companies | Out of scope | Re-restoring after the fix is simpler and safer than a one-off data migration. |
| Guard style | Pure fixture tests | Existing suite is pure; a schema-reading test would need a live DB in CI. |

## Acceptance criteria

1. `buildIdMaps` over a fixture containing `part` returns no map for `part`, and
   returns a map for a normal composite-PK table (e.g. `workflow`).
2. `buildRowTransforms` with `remap=true` leaves `part.id = "ADCS-001"` unchanged
   while re-stamping `companyId`.
3. `STORAGE_PATH_COLUMNS` contains `thumbnailPath`, `modelPath`, `glbPath`, `graphPath`.
4. A test fails if a `READABLE_ID_TABLES` entry also appears in the `UNIQUE (id)`
   remap-required list.
5. A test fails if a known `modelUpload` artifact path column is missing from
   `STORAGE_PATH_COLUMNS`, naming the missing column.
6. `pnpm --filter @carbon/jobs test` and `typecheck` pass.
7. Manual (user): re-restore into a fresh company; Parts list shows rows and an
   assembly loads its model.

## Open Questions

- [x] How should `buildIdMaps` identify readable-id tables? — **Answer:** explicit
  `READABLE_ID_TABLES` constant. A derived schema rule was tested and matches 65
  tables including ones that must keep remapping.
- [x] Should the five be skipped on the additive import path too? — **Answer:** yes,
  skip in both. Restore is wipe-first; on reseed the composite PK fails loudly
  rather than corrupting. A readable id must never be rewritten.
- [x] Should `modelPath` rejoin `STORAGE_PATH_COLUMNS`? — **Answer:** yes, with
  `glbPath`/`graphPath`. The "not backed up" rationale is contradicted by the
  listing-based backup, and 8 rows are provably stale.

## Changelog

- 2026-09-18 — Initial spec, written after resolving three design questions with the user.
