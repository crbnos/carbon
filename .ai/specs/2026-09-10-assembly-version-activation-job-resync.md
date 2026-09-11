# Assembly instruction version activation — keep MES playback working on live jobs

Status: Approved (2026-09-10)

## Problem

Activating a new version of an assembly instruction silently breaks the animated
3D playback in MES for every in-flight job using that instruction. The operator
sees a static full 3D model on every step — no animation, no transport bar, no
playback slot — and reasonably reports "the MES animations are broken".

Reported by a customer against `SA-0076`; reproduced end-to-end locally.

### Root cause

`activateAssemblyInstructionVersion` (`apps/erp/app/modules/production/production.service.ts:6488`)
repoints in-flight work to the newly-activated version:

```
jobOperation.assemblyInstructionId  v1 -> v2   ✅ (line ~6564)
jobOperationStep.assemblyInstructionStepId     ❌ never migrated
```

Each version is a **new** `assemblyInstruction` row whose steps get **new ids**
(`copyAssemblyInstructionAsVersion:6413`, `nanoid()` per step). So after
activation the job's operation points at v2 while its step markers still hold
v1 step ids.

MES resolves the animation frame by exact id match
(`apps/mes/app/components/AssemblyView.tsx:1087`):

```ts
assemblyPlayback.steps.findIndex((s) => s.id === step.assemblyInstructionStepId)
```

v2's ids never match v1's markers → `findIndex` returns `-1` → `playbackIndex`
null → `playbackAvailable` false. The per-step **model slide** survives (slides
hang off `modelUpload`, which nothing touched), so the panel falls through to
that slide — an orbitable but static full model, identical on every step.

Verified in the DB: op `jo_WrkvKZyRGCq3D79aBAWvjj` points at v2
`dah77qp0o0ghngq9reug` while all 10 of its markers belong to v1
`dah6hsp0o0gg43i9reg0`.

### Secondary cause (same symptom, different route)

The marker FK is `ON DELETE SET NULL`
(`packages/database/supabase/migrations/20260720025847_assembly-bop-sync.sql:18`).
Deleting instruction steps nulls markers on every live job synced from them.

This is compounded by the sync's own filter
(`production.service.ts:8220`):

```ts
.where("assemblyInstructionStepId", "is not", null)
```

Null-marker steps are treated as **hand-authored** and are therefore never
reclaimed. A user trying to self-heal by clicking "Sync Assembly Steps" gets a
**duplicate** set of steps inserted alongside the broken ones (observed: 10
broken + 10 new = 20 steps, ~half animating, colliding on `sortOrder` and
sharing names).

### Scope of impact

- Only **in-flight** work breaks. Activation's repoint query already excludes
  `Done`/`Canceled` operations and locked jobs, so completed jobs are unaffected.
- Editing a step's *text* is harmless. Breakage requires steps to be **added,
  reordered, or deleted** in the new version — anything that changes the id set.
- Latent since `cb69865131` (2026-07-27), which shipped both the marker column
  and the MES playback feature. Not a recent regression; it requires an
  instruction to be versioned while jobs are live.

## Goals

1. Activating a new version keeps MES playback working on every in-flight job.
2. A step that survives v1→v2 keeps its identity **and** its operator completion
   records, even when reordered or retitled.
3. A user who is already broken can self-heal with "Sync Assembly Steps" without
   producing duplicates.
4. Jobs already broken by this bug are repaired automatically where possible.

## Non-goals

- Changing the `ON DELETE SET NULL` FK semantics. The migration's intent —
  demoting synced steps to hand-authored rather than destroying operator work —
  stays. We fix the *consequence* (unreclaimable orphans), not the cascade.
- Re-planning motion/camera, or any assembler/model-pipeline change.
- Versioning `methodOperationStep` markers (BOP templates). Out of scope; only
  job-side playback is affected.
- Preventing activation while jobs are in flight (rejected: activation is the
  intended way to roll a change out to the floor).

## Design

### 1. Persist step provenance across versions

`copyAssemblyInstructionAsVersion` already builds the exact v1→v2 correspondence
(`stepIdMap`, line 6413) and **discards** it. Persist it, mirroring the existing
instruction-level `rootInstructionId` idiom.

```
assemblyInstructionStep
  + rootStepId TEXT NULL REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL
  + index on ("rootStepId")
```

Semantics match `rootInstructionId` exactly: `NULL` means "I am the root", so a
step's group root is `COALESCE("rootStepId", "id")` — the same
`COALESCE(rootInstructionId, id)` pattern already used in
`20260730153412_assembly-instructions-view.sql`.

`ON DELETE SET NULL` (not CASCADE): deleting an old version must never delete
the current version's steps. A v2 step whose v1 ancestor is deleted simply
becomes its own root.

On copy: `rootStepId = source.rootStepId ?? source.id`. Chains stay flat, so v3
copied from v2 still roots at v1 and lineage survives arbitrarily many versions.

### 2. Remap job markers on activation

After the existing repoint in `activateAssemblyInstructionVersion`, migrate each
affected operation's step markers from the old version's step ids to the new
version's, matching on group root:

```
old marker -> COALESCE(old.rootStepId, old.id) == COALESCE(new.rootStepId, new.id) -> new marker
```

Outcomes per step, which follow directly from the resolved questions:

| Case | Action | Completion records |
|---|---|---|
| Step survives v1→v2 (even reordered/retitled) | `UPDATE` marker + payload | **Preserved** |
| Step added in v2 | `INSERT` | N/A |
| Step deleted in v2 | `DELETE` | Lost (approved — deleted steps just disappear) |

Reuse `syncAssemblyInstructionToOperation` (line 8088) rather than reimplementing
reconciliation; it already updates matched steps, inserts new ones, and deletes
stale ones, and its matched-step path is an `UPDATE`, so
`jobOperationStepRecord` (FK `ON DELETE CASCADE`, verified) survives. The marker
remap runs **before** the sync so the sync sees v2-space markers and matches
them.

Bounded-query property: the existing stale-op lookup is deliberately driven off
`jobOperation` to avoid a 1000-row cap (see the comment at ~6548). Preserve it —
remap and sync per repointed op id, never by first materializing every job.

Failure isolation: one operation failing to sync must not abort the activation
or leave other operations half-migrated. Activation reports how many operations
were resynced and how many failed.

### 3. Let re-sync reclaim orphaned steps

Relax the "hand-authored" assumption at `production.service.ts:8220` so a
re-sync can re-adopt steps orphaned by the `ON DELETE SET NULL` cascade, instead
of inserting duplicates beside them.

Adoption is deliberately conservative — a null-marker step is only re-adopted
when it is unambiguously a former synced step of *this* instruction:

- match by `sortOrder` **and** `name` against a source step, and
- only when no already-marked step claims that source step.

Genuinely hand-authored steps (which match no source step) keep today's
behaviour and are left untouched. Ambiguous matches are left alone rather than
guessed at.

### 4. Backfill already-broken jobs

A migration repairs markers stranded on a non-current version. Detector (already
validated against the local DB, returns the 1 known broken op):

```sql
FROM "jobOperationStep" s
JOIN "assemblyInstructionStep" ais ON ais.id = s."assemblyInstructionStepId"
JOIN "jobOperation" jo ON jo.id = s."operationId"
WHERE ais."assemblyInstructionId" <> jo."assemblyInstructionId"
```

Because `rootStepId` did not exist for rows created before this change, the
backfill is **best-effort** and matches within the version group by `title`,
then by `sortOrder`:

- matched → `UPDATE` the marker to the current version's step id (records kept)
- unmatched → left as-is; a "Sync Assembly Steps" in the UI finishes the repair
  (now safe, per §3)

The migration is idempotent and touches only rows the detector returns. Jobs
whose markers are `NULL` (the FK-cascade route) are not in scope for the
backfill — §3 makes those repairable from the UI.

### UI / copy

No new screens. Activation already reports success via a flash message; extend
it to mention the number of in-flight jobs resynced. All new user-facing copy is
Lingui-translatable (`t`/`<Trans>`), per project convention.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Marker remap strategy | Add `rootStepId` provenance column | The exact map already exists at copy time and is thrown away. Only option that preserves completion records for surviving steps under reorder/retitle. |
| Provenance column shape | `rootStepId`, `COALESCE(root, id)` | Mirrors existing `rootInstructionId` idiom, incl. the view at `20260730153412`. No foreign idiom. |
| Provenance FK on delete | `SET NULL` | Deleting an old version must not delete current steps; orphaned step becomes its own root. |
| Chain shape across v3+ | Flat (`source.rootStepId ?? source.id`) | Lineage survives arbitrarily many versions without recursive resolution. |
| Reconciliation engine | Reuse `syncAssemblyInstructionToOperation` | Already handles update/insert/delete-stale correctly; matched path is `UPDATE`, so records survive. Constraint: reuse, don't reinvent. |
| Deleted-step records | Deleted with the step (cascade) | Explicit user ruling: "if a step is deleted, we don't show it in the end." |
| Orphan re-adoption | `sortOrder` + `name`, unclaimed only | Fixes the duplicate-steps trap without mis-attributing genuinely hand-authored steps. |
| Backfill matching | `title`, then `sortOrder` | `rootStepId` cannot exist retroactively; best-effort with UI re-sync as the completion path. |
| Backfill of NULL markers | Out of scope | §3 makes them self-healable; guessing their lineage is unreliable. |
| FK `ON DELETE SET NULL` | Unchanged | Original intent (preserve operator work) is sound; we fix the unreclaimable-orphan consequence instead. |

## Acceptance criteria

1. Given a job whose operation is synced to instruction v1 with 10 steps, when a
   v2 is created that reorders steps and deletes one, and v2 is activated, then
   opening `/x/assembly/{operationId}` in MES shows the `▶ 3D` playback slot and
   the transport bar, and stepping through advances the animation.
2. Given an operator has completed step 3 of 10, when a v2 that retitles and
   reorders (but does not delete) step 3 is activated, then that step's
   completion record still exists and shows as done in MES.
3. Given a v2 deletes a step the operator had completed, when v2 is activated,
   then that step no longer appears on the job and its record is gone.
4. Given a v2 adds a step, when v2 is activated, then the new step appears on the
   job in its correct `sortOrder`, unmarked as done.
5. Given a job locked or an operation `Done`/`Canceled`, when a version is
   activated, then that operation's steps are not modified.
6. Given a job whose markers were nulled by deleting instruction steps, when the
   user clicks "Sync Assembly Steps", then the orphaned steps are re-adopted and
   the total step count does **not** double.
7. Given the pre-existing broken op `jo_WrkvKZyRGCq3D79aBAWvjj` (markers on
   archived v1, op on v2), when the backfill migration runs, then its markers
   point at v2 steps and MES playback works without any UI action.
8. Running the backfill migration twice produces no additional changes.
9. `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/database`
   and `pnpm run lint` pass.

## Open questions

- [x] How should job step markers be remapped on version activation? —
  **Answer:** Add a `rootStepId` provenance column mirroring `rootInstructionId`,
  persisting the map `copyAssemblyInstructionAsVersion` already computes, and
  remap exactly. Chosen over re-sync-only (wipes all operator progress on every
  activation) and `sortOrder`/title matching (silently mis-attributes completed
  work in exactly the reorder+delete case that was reproduced).
- [x] Should the fix also cover the `ON DELETE SET NULL` orphan issue? —
  **Answer:** Yes. Let re-sync re-adopt orphaned steps so users can self-heal;
  today a re-sync doubles the step list instead. The FK semantics stay unchanged.
- [x] How should already-broken jobs be repaired? — **Answer:** Best-effort
  migration matching by title then `sortOrder`, with UI re-sync as the completion
  path for anything unmatched. Exact remap is impossible retroactively because
  the mapping was never persisted.
- [x] Should activation be blocked while jobs are in flight? — **Answer:** No
  (resolved during writing, §Non-goals). Activation is the intended mechanism for
  rolling a change to the floor; blocking it would break the feature's purpose.
- [x] Should the backfill also repair `NULL` markers? — **Answer:** No (resolved
  during writing). Their lineage is unrecoverable and guessing risks
  mis-attributing operator work; §3 makes them repairable from the UI instead.

## Changelog

- 2026-09-10 — Initial spec. Root cause confirmed and reproduced end-to-end in
  the UI; three open questions resolved with the user before writing.
