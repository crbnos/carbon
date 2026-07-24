# MES Assembly — exact per-unit (and per-step) issued attribution

**Goal:** Make the per-unit "issued" count in the assembly view accurate for **batch**
(and untracked) parents the same way it already is for **serial** parents — including
surfacing over-issues (scan 2 where 1 is required → shows `2/1`). Do it by capturing the
**unit** and **step** at issue time and attributing consumed inputs to them, instead of
reconstructing a per-unit share from the job-wide total.

## Background / root cause (confirmed)

Reproduced on job **J000003** (`SERIAL-BUY`: 3-unit job, 1/unit required, `quantityIssued = 4`
— a real over-issue) which the UI rendered as `1/1` on unit 3.

- **Serial parent works** because each unit is its own `trackedEntity`. The consume records
  that unit's entity as the activity **output** (`issue/index.ts:2093-2102`,
  `trackedActivityOutput.trackedEntityId = parentTrackedEntityId`). The loader reads
  `getTrackedInputs(unitEntity)` and gets exactly what went into that unit
  (`operations.service.ts:702-712`), so `MaterialRow` shows it raw (per-unit, no clamp).
- **Batch parent can't**, because every unit shares **one lot entity**
  (`assembly.$operationId.tsx:179-182`, `effectiveEntityId = navEntities[0]`). Every consume's
  output points at that same lot — nothing records which unit (or step) a serial went into.
  The loader falls to the `else` branch (`operations.service.ts:723-732`) returning the
  **job-wide** `quantityIssued`, and `MaterialRow` reconstructs a per-unit share via
  `Math.min(required, totalIssued − unitIndex*required)` (`AssemblyView.tsx`, `getIssuedForUnit`).
  The `Math.min(required, …)` clamp hides the over-issue → `1/1`.
- **The unit/step is never captured.** The Consume activity stores only
  `attributes: { Job, "Job Make Method", "Job Material", Employee }` (`issue/index.ts:2082`),
  and the issue payload (`issueTrackedEntityValidator`, `models.ts:161`) carries no step or unit.

## Approach

Stamp the **unit index** and **step id** onto the Consume activity at issue time (the
assembly view knows both), then attribute consumed inputs by unit in the loader. Serial
parents are unchanged (already exact). Batch/untracked become exact for newly-issued parts;
consumes issued before this change (no stamp) fall back to today's heuristic.

Decision (default; confirm): **stamp both `Unit` and `Job Operation Step`.** Unit is what
fixes the count; step is the extra signal (which step within the unit) and is cheap to carry.

## Changes

### 1. Issue payload carries unit + step
`apps/mes/app/services/models.ts` — extend `issueTrackedEntityValidator` (line 161):
```ts
jobOperationStepId: z.string().optional(),
unitIndex: z.number().int().nonnegative().optional(),
```

`apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx`:
- Add optional props `jobOperationStepId?: string` and `unitIndex?: number`.
- Include them in the serial (`~:818-836`) and batch (`~:895-908`) `issueTrackedEntity`
  payloads. The plain-inventory `path.to.issue` form (non-tracked) is out of scope — those
  parts backflush and don't gate.

`apps/mes/app/components/AssemblyView.tsx` — pass them where `<IssueMaterialModal>` is
rendered (`~:1946`): `jobOperationStepId={step?.id}` and `unitIndex={currentUnitIndex}`.
The operation view (`JobOperation.tsx`) omits them (undefined) → no behavior change there.

### 2. Route passes through
`apps/mes/app/routes/x+/issue-tracked-entity.tsx` — destructure the two new fields from
`validation.data` and forward them in the `serviceRole.functions.invoke("issue", { body })`.

### 3. Edge function stamps the Consume activity
`packages/database/supabase/functions/issue/index.ts`, `trackedEntitiesToOperation` case:
- Extend the payload validator (`~:849-868`) with optional `jobOperationStepId`, `unitIndex`.
- Add to the Consume activity `attributes` (`~:2082`):
  ```
  ...(jobOperationStepId ? { "Job Operation Step": jobOperationStepId } : {}),
  ...(unitIndex !== undefined ? { Unit: unitIndex } : {}),
  ```
  Additive JSONB keys — safe alongside existing `attributes->>` lookups. (Ships on merge to
  `main`; the `[functions.issue]` config.toml entry already exists.)

### 4. Loader attributes per unit for batch parents
`apps/mes/app/services/operations.service.ts` — `getJobMaterialsByOperationId`:
- Add `unitIndex: number` and `requiresBatchTracking: boolean` to args; the route already
  computes both (`assembly.$operationId.tsx:170-182`) — pass them in (`~:184-190`).
- For a **batch** parent (`requiresBatchTracking && !requiresSerialTracking`), the existing
  `getTrackedInputs(effectiveEntityId=lot)` already returns every consumed serial descendant
  of the lot. For each tracked material compute:
  - `issuedThisUnit` = Σ `input.quantity` where `activityAttributes["Job Material"] === material.id`
    **and** `activityAttributes["Unit"] === unitIndex` (stamped, exact).
  - `issuedLegacy` = Σ for the same material where `activityAttributes["Unit"]` is absent
    (pre-change consumes) → fall back to the job-wide heuristic share for those only.
  - `quantityIssued = issuedThisUnit + heuristicShareOf(issuedLegacy)`.
  Return this as a **per-unit** value (same contract as the serial branch).
- Serial branch unchanged. Untracked parent (no lot entity) keeps current behavior.

### 5. Component treats batch tracked issued as per-unit
`apps/mes/app/components/AssemblyView.tsx`:
- In `visibleMaterialsWithState`, set `issuedIsPerUnit` for tracked materials under a batch
  parent too: `(requiresSerialTracking || requiresBatchTracking) && isTrackedMat`.
- `getIssuedForUnit`'s per-unit branch already returns `totalIssued` **without** the
  `Math.min` clamp, so an over-issue renders as `2/1` automatically. The clamp stays only on
  the legacy heuristic branch (untracked / unstamped). No clamp change needed.

## Backward compatibility
- In-progress batch builds started before this ships have unstamped consumes → those units use
  the heuristic (current behavior). Every new scan is exact. No migration/backfill required.
- Serial parents and the operation view are behaviorally unchanged.

## Verification
- `pnpm exec turbo run typecheck --filter=mes` and `--filter=@carbon/database` green.
- DB check: after issuing 2 serials on unit 3 of a **batch** parent (1/unit required), the
  Consume activities carry `attributes->>Unit = '2'`; loader returns `quantityIssued = 2` for
  that material on unit 3; `MaterialRow` shows `2/1`. Paging to a completed unit still shows its
  own count (attributed by its `Unit`), not the job-wide total.
- Serial parent unchanged: still exact.
- `/test` browser pass on a batch-parent assembly: scan 1 → `1/1`; scan a 2nd → `2/1`; the
  soft-gate (tracked parts must be scanned before Mark done) still behaves.

## Decisions (confirmed)
1. Stamp **both** `Unit` + `Job Operation Step`.
2. Store `Unit` as a **1-based** unit number (`currentUnitIndex + 1`); loader compares against
   `unitIndex + 1`. Payload/prop named `unitNumber` to signal 1-based.
3. Legacy unstamped batch consumes fall back to the job-wide heuristic (current behavior).
