# Sub-assembly motion path + waypoint rotation

Status: **Implemented** (on `feat/sub-assembly-motion-path`, not yet merged) · Branch: `feat/sub-assembly-motion-path` · 2026-10-08

## TL;DR

- A finished sub-assembly gets its **own** motion path for the moment it joins the main build, instead of riding the using step's motion.
- The path is edited from the **using step's panel** (one "Edit Path" row per sub-assembly that step fits). A sub-assembly no step uses has the control on its own panel.
- Playback at the using step: **each unit flies in on its own path, one after another, then the step's own parts insert**.
- The path editor gains **rotation**: select a waypoint, turn it with 3 snap-to-15° rings, and a see-through copy shows the part's pose there. This works for normal steps and for sub-assemblies.
- **No migration.** The path lives in the header row's existing `motion` column. A unit with no path keeps today's behavior: it glides in from the side, then rides the step's motion.
- ERP editor and MES floor view both get it, because both render through `@carbon/viewer`'s `AssemblyPlayer`.

## Problem

1. **No path of its own.** At the step that uses a sub-assembly, the unit's parts are merged into that step's moving set (`packages/viewer/src/AssemblyPlayer.tsx:430-438`). They glide in from a fixed spot to the right of the build (`AssemblyPlayer.tsx:637-652`) and then move with the step's motion. An author can't say "lower the gearbox in from above," and the sub-assembly panel (`AssemblySubAssemblyProperties.tsx`) has no Motion control.
2. **No rotation.** The path editor only moves parts, never turns them (`packages/viewer/src/MotionPathEditor.tsx:20-22`). It saves only `linear`/`L` (`motion.ts:709-739`). A part that gets flipped or turned on its way in, for example to install from the other side, can't be shown.

## Goals

- An author sets a path for a sub-assembly as one rigid unit, and it plays wherever that unit joins the build.
- An author turns a part (or a rigid group, or a unit) at any waypoint.
- Instructions that already exist play exactly as they do today until someone edits them.

## Non-goals

- Paths for steps *inside* a sub-assembly. They already have them; nothing changes there.
- Making the motion planner output rotations or sub-assembly paths. Header rows are `planConfidence = 'manual'` and are skipped by the planner (`production.service.ts:10215`).
- Turns of 180° or more between two neighbouring waypoints. Rotation takes the shortest way, so a bigger turn needs an extra waypoint (see Design Decisions).
- Changes to the camera's orbit controls.

## Design

### Data model

There's no schema change. Every `assemblyInstructionStep` row already has `"motion" JSONB NOT NULL DEFAULT '{"type": "none"}'` (`20260610151942_assembly-instructions.sql:61`), header rows included.

- **The sub-assembly's path = its header row's `motion`.** `none` means "no path set," which gives the fallback.
- **A new relative motion type** in `packages/viewer/src/types.ts` (and in the `Motion` union):

  ```ts
  /** Editor-authored path with rotation. Poses are RELATIVE to the moving set's
   *  seated pose, turning about its seated centroid, so one motion applies to a
   *  single part, a rigid group, or a whole sub-assembly. First = start,
   *  last = seat (offset [0,0,0], rotation [0,0,0,1]). */
  export type WaypointsMotion = {
    type: "waypoints";
    waypoints: { offset: Vec3; rotation: Quat }[]; // length >= 2
  };
  ```

  The existing `path` type stores absolute world poses for a single part (`types.ts:44-53`), so it can't express a rotating group. `path` stays as it is for the planner.
- The editor saves `linear`/`L` when every waypoint rotation is identity, so paths with no rotation keep today's format. It saves `waypoints` only when some waypoint is rotated.
- Validators get the new branch (the ERP schema also refuses a last waypoint that is not the seat and a rotation that is not a unit quaternion; the MES plays a raw row only if `isPlayableMotion` accepts it, else as `none`): `motionSchema` (`apps/erp/app/modules/production/production.models.ts:1306`) and the MES allow-list `playerMotionTypes` (`apps/mes/app/components/AssemblyView.tsx:218`). The dataset `AssemblyStepMotionSpec` only lists shapes the planner bakes, so it stays as it is. Validation rules: at least 2 waypoints, unit quaternions, and the last waypoint equal to the seat.

### Viewer (`packages/viewer`)

**`motion.ts`**
- `motionToKeyframes`, `motionDuration`, `motionTravelDistance`, `naturalizeMotion` (and the camera-framing helpers `insertionDirection`/`insertionStartOffset` at `AssemblyPlayer.tsx:2501-2530`): add the `waypoints` case. Each part's pose at a waypoint = seated pose, turned by `rotation` about the moving set's seated centroid, then shifted by `offset`. Between waypoints, position is interpolated linearly and rotation uses slerp (shortest arc). Duration covers both travel and turning: travel at the existing `INSERTION_SPEED_MM_PER_S`, plus a turn allowance, clamped to `MIN/MAX_DURATION_S`.
- `motionToWaypoints` / `waypointsToMotion`: round-trip rotation too. Rotation is dropped (and `linear`/`L` saved) when every rotation is identity.
- `buildStepClip`: accepts **units**, a list of `{ nodeIds, motion, glide? }` that play one after another before the step's own insertion. A unit whose motion is `none` gets today's glide and then moves with the step's motion, exactly as now. A unit with a motion plays its own path; no glide is added, because the path already starts wherever the author put it.
- `stepClipTiming`: the step's slot = sum of the unit segments + the step's own motion + hold. A step with no animation of its own (motion `none`, or flagged) fades its parts in only after its units seat (`fadeProgress`). `buildCarryPlans` (`subassembly.ts`) decides per step which units fly, which glide, and whether an unused header joins on its own path. An authored `durationSeconds` still scales everything to fit (current rule).

**`AssemblyPlayer.tsx`**
- The "carried" merge at `:430-438` and the carry-in `glide` at `:637-652` become a per-unit list built from `subPlan.carriesIn` (`subassembly.ts:184-187`). Each unit = the header id, `subAssemblyPartIds(header)`, and the header's `motion`. Units play in `carriesIn` order, which is sub-assembly order.
- Framing (`:2003`) unions every unit's start pose, not just the fixed side offset.
- `editMotion` becomes `{ stepId, motion, nodeIds? }`. With `nodeIds` set (editing a unit's path), the editor's anchor centroid is computed from those parts. The active step stays the using step, so the author sees the build the unit joins.

**`MotionPathEditor.tsx`**
- A **Move / Rotate** switch sits in the viewer while a path is edited (labels passed in by the host as `pathToolLabels`, so they are translated). **Move** (the default for every edit session) drags waypoints and shows no rings. **Rotate** shows 3 rotation rings (drei `TransformControls`, `mode="rotate"`, `rotationSnap` = 15°) on the selected waypoint (the start waypoint when none is selected), and the spheres stop dragging: the gizmo's invisible free-rotation grip covers the sphere, so allowing both made one drag move and spin the part. The snap counts from where each drag starts; every waypoint starts unturned or already snapped, so turns stay on 15° steps. drei 9.122.0 is already installed, so no new dependency. (`PivotControls` was considered but has no snapping.)
- Ghost preview: a translucent copy of the moving parts at the selected waypoint's pose, rendered by the editor with its own see-through material. It never touches the scene's real meshes.
- The seat waypoint stays locked: it can't be moved or rotated.

### ERP UI (`apps/erp/.../Assemblies`)

- **Using step's panel** (`AssemblyInstructionProperties.tsx`, Playback section at `:644-720`): under the step's own Motion row, one row per sub-assembly this step carries in, labelled "{Sub-assembly name} path". The row shows "Automatic" or "Custom path" and has an `Edit Path` / `Done Editing Path` button and a `Reset` action that sets `none`.
- **Unused sub-assembly's panel** (`AssemblySubAssemblyProperties.tsx`): the same row when `usedInStepId` is null. That sub-assembly joins at its own row, and `subassembly.ts:187` already puts it in its own `carriesIn`.
- **Route** (`apps/erp/app/routes/x+/assembly+/$id.tsx:613-680`): `onEditMotion(stepId, { unitHeaderId? })`. Saving goes through the existing `$id.steps.motion.$stepId` action with the header id. That action calls `updateAssemblyStepMotion`, which updates by id, so headers work with no new route.
- Every new string uses Lingui `<Trans>`/`t`. There's a new help term for the unit path row, next to the existing `assembly-step-motion` term.

### MES

There's no MES-specific code beyond the `playerMotionTypes` allow-list. MES already selects `motion` for all steps, headers included (`apps/mes/app/services/operations.service.ts:664`).

## Design Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Where the unit's path is stored | Header row's existing `motion` column | Column exists on every row; headers are planner-skipped (`manual`); no migration |
| 2 | Rotation storage | New relative `waypoints` type; keep `path` unchanged | `path` is absolute and single-part (`types.ts:44-53`); a unit or rigid group needs relative poses (same reason the editor saves `linear`/`L` today) |
| 3 | Backwards compatibility | Rotation-free edits still save `linear`/`L` | Existing data and the planner's formats are untouched |
| 4 | Unit + step parts sequencing | Units first (one by one), then the step's parts | User answer (Q1, Q3) |
| 5 | Unit with no path | Today's glide + ride the step's motion | User answer (Q2) |
| 6 | Where the unit path is edited | Using step's panel; unused unit → its own panel | User answer (Q3, Q4) |
| 7 | Rotation interpolation | Slerp, shortest arc; ≥180° turns need an extra waypoint | Standard, predictable; snapping makes 2×90° easy |
| 8 | Rotate UI | drei `TransformControls` rotate rings, 15° snap, ghost preview, behind a Move / Rotate switch | User answer (Q7) + follow-up: rings and sphere-drag fought over the same spot |
| 9 | Save path | Reuse `$id.steps.motion.$stepId` with the header id | Updates by id; no new route |

## Acceptance criteria

1. On a step that fits sub-assembly "Gearbox", the Playback section shows a "Gearbox path" row. Edit Path → drag the start waypoint above the build → Done. On replay, Gearbox drops in from above, and only after it seats do the step's own bolts insert.
2. Without editing, the same instruction plays exactly as before: the unit glides in from the right and then rides the step's motion.
3. A step that fits two sub-assemblies, each with a path: they fly in one after another in sub-assembly order, then the step's parts.
4. A sub-assembly that no step uses shows the path row on its own panel and plays its path where it joins.
5. On a normal step, Edit Path → select a waypoint → rotate 180° about X (it snaps in 15° steps) → the ghost shows the part flipped. On replay, the part turns along the path and ends seated in its true orientation.
6. A rigid-group step rotated at a waypoint turns as one body about its centroid. Parts keep their positions relative to each other.
7. Paths with no rotation are saved as `linear`/`L` (check the row's `motion` JSON). Rotated ones are saved as `waypoints`.
8. The MES operation view plays the same unit paths and rotations as the ERP editor.
9. Reset on a unit path sets the header's `motion` back to `none`, and playback returns to the fallback.
10. `npm run typecheck` passes and viewer unit tests cover `waypoints` keyframes, the round-trip, and unit sequencing timing.

## Verification (2026-10-08)

Browser-checked on the seeded satellite instruction (Draft v2): criteria 1, 2, 3, 4, 7 and 9 directly; 5 and 6 via the unit rotation (a 40-part sub-assembly turned 165° as one body) plus viewer unit tests. Criterion 8 (MES) is covered only by the shared player, the allow-list and the MES typecheck — not opened in the MES app. Viewer tests 149/149; viewer, ERP, MES, docs typecheck clean; Biome clean.

## Open Questions (resolved)

- [x] Q1 Sequencing when a step fits a unit and has its own parts — **Answer:** unit first, then parts.
- [x] Q2 A unit with no path — **Answer:** keep today's behavior (glide + ride the step's motion).
- [x] Q3 Where the unit's path is edited — **Answer:** the using step's panel.
- [x] Q4 Several units at one step — **Answer:** one after another, in sub-assembly order.
- [x] Q5 An unused sub-assembly — **Answer:** the path is edited on its own panel.
- [x] Q6 Is rotation in scope — **Answer:** yes, in this spec, for both steps and units.
- [x] Q7 Rotate UI — **Answer:** rings with 15° snap and a ghost preview.

## Research

N/A. This is internal viewer and editor work, and the codebase answers every question (the motion types, the planner skip rule, the drei version).

## Changelog

- 2026-10-08: Draft written after resolving Q1–Q7.
- 2026-10-08: Approved. Planning corrections: `TransformControls` (it can snap) instead of `PivotControls`; the ghost uses its own material; dataset motion type unchanged.
- 2026-10-09: Move / Rotate switch (rings only in Rotate). Self-review fixes: own parts fade in after the units seat; schema checks seat + unit quaternions; MES uses `isPlayableMotion`; camera frames the unit's turned start pose; `buildCarryPlans` extracted and tested; MCP tool metadata regenerated.
