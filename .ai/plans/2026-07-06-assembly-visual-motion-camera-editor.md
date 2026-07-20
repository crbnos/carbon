# Plan: Visual motion-path editor + per-step camera capture (assembly instructions)

Date: 2026-07-06
Branch: `claude/confident-maxwell-dy4fvr`
Status: **Phases 1–4 implemented** (viewer helpers + tests, red-path editor, camera
capture, editor/route integration). Gates green: `@carbon/viewer` typecheck + 64 unit
tests, `erp` + `mes` typecheck, biome clean. **Phase 5 (browser verification) pending.**

## Goal

Restore two authoring capabilities to the assembly instruction editor that the
number-based motion editor replaced:

1. **Draggable motion path.** When authoring a step's motion, the part's insertion
   path renders as a **red line in the 3D viewer** with **drag-and-drop waypoints**.
   Editing waypoints edits the motion. (Replaces typing Vec3 direction/distance.)
2. **Set camera view per step.** A button that saves the *current* viewer camera
   as the step's `camera` pose, so playback frames that step exactly as the author
   set it. Plus a "Clear" that returns the step to auto-framing.

> Note: neither feature exists in git history — this is a **rebuild**, not a revert.
> The number-based editor has been the only motion editor since the first commit;
> `step.camera` has only ever been set by the geometry planner, never by UI.

## What already exists (grounding — verified in code)

Persistence is **already done** — this is a UI-only feature:

- `assemblyInstructionStepValidator` (`production.models.ts:1214`) already accepts
  `motion: jsonField(motionSchema.optional())` and
  `camera: jsonField(cameraSchema.nullable().optional())`. `motionSchema`
  (`:1053`) already includes the `path` variant (`keyframes: {t, position, quaternion}[]`,
  min 2). `cameraSchema` (`:1095`) = `{position: vec3, target: vec3, fov: number}`.
- The step-save route `x+/assembly+/$id.steps.$stepId.tsx` validates that schema and
  calls `upsertAssemblyInstructionStep` — **no route/DB/migration changes needed.**
- Viewer already **consumes** both fields: `motionToKeyframes`/`buildStepClip`
  (`packages/viewer/src/motion.ts`) animates `path` motions; `AssemblyScene` reads
  `step.camera` (`AssemblyPlayer.tsx:931+`) to frame the shot, else auto-frames.
- Viewer stack: react-three-fiber 8.18 + drei 9.122 + three 0.163. drei ships
  `Line`, `TransformControls`, `DragControls`, `PivotControls`, `Html`, `Sphere`
  (all present in installed `.d.ts`) — nothing new to add to deps.
- `nodeId → Object3D` map (`useAssembly.ts:108`, `nodesById`) is already threaded
  into `AssemblyScene` — the bridge for placing handles at part positions.
- Live camera is reachable inside `AssemblyScene`: `camera = useThree(s=>s.camera)`
  (`AssemblyPlayer.tsx:510`), `controls = useThree(s=>s.controls)` (`:511`,
  OrbitControls via `makeDefault`). `{camera.position, controls.target, camera.fov}`
  is exactly a `CameraPose`.

The gaps to close:

- Editor (`AssemblyInstructionProperties.tsx` → `StepForm`) supports only
  `motionTypes = ["none","linear","L","helix"]` (`:165`) and maps `path → none`
  (`makeMotionDraft`, `:236`). It emits no camera. No Hidden `camera` field exists.
- `AssemblyPlayer` exposes no way to edit a path or read out the camera
  (`AssemblyPlayerProps`, `:33`): callbacks are only `onStepChange`, `onSelectParts`,
  `onGraphLoaded`. `readOnly` disables selection (MES uses it).

## Design decisions (recommended defaults — flag any for veto)

1. **Serialize to RELATIVE motion (`linear`/`L`), not absolute `path`.** Discovered
   while grounding: a `path` motion's keyframes are absolute world positions, and
   `motionToKeyframes` validates the last keyframe equals *each part's* seated pose —
   so `path` only works for single-part steps and would throw on multi-part rigid
   groups. `linear`/`L` are relative (direction+distance applied to each part's own
   seated pose), exactly how the planner already animates grouped steps. So the editor
   emits **`linear` for 2 waypoints, `L` for 3+ waypoints**. Waypoints are world-space
   for display, anchored so the **last waypoint is the seated reference** (centroid of
   the step's parts' seated positions); intermediate + first waypoints are draggable,
   the last is locked to seated. `path` handling is left untouched (planner may still
   produce it; we convert it to waypoints on open).
2. **Orientation (v1): pure translation.** Parts translate without rotating — no
   per-waypoint quaternion authoring (which is why `path` buys us nothing here). Full
   6-DOF is out of scope for v1.
3. **The path editor is the only motion editor.** Selecting a step samples its current
   motion (`linear`/`L`/`helix`/`path`/`none`) into editable world waypoints via a new
   `motionToWaypoints` helper, so any step is draggable; drags serialize back via
   `waypointsToMotion`. The numeric editor is **removed** (see Resolved decisions).
4. **Waypoint ops:** drag existing (translate gizmo), **double-click a segment** to
   insert a waypoint, **select + Delete/trash button** to remove. Minimum 2
   waypoints (start + seated).
5. **Autosave on drag-end**, debounced, via the existing step fetcher — consistent
   with direct-manipulation UX. No explicit Save click for path edits.
6. **Camera button lives in the properties panel** (with the rest of step editing);
   the viewer exposes an **imperative `captureCameraPose()`** via `forwardRef` so the
   button can read the live pose. "Set view" saves `camera`; "Clear" saves `null`.
7. **Edit is Draft-only** (`isDisabled`/`readOnly` already gate this); MES playback
   (`readOnly`) is untouched. Editing **pauses playback** and pins the part at a
   preview pose so mixer rebuilds don't fight the handles.

## Architecture

Three panels coordinate through the route (`$id.tsx`), which already owns shared
selection state (`selectedNodeIds`, `selectedStepId`, `draftPartNodeIds`):

- **Lift a motion-edit session** into `$id.tsx`: `editingMotion: {stepId} | null`
  plus a `draftMotion` for the step being edited. The viewer renders the red path
  for `editingMotion.stepId`; `StepForm` toggles the session and mirrors
  `draftMotion` into its existing `motion` state / Hidden field.
- **Camera capture** uses a `playerRef` (imperative handle) held by `$id.tsx`,
  passed to `StepForm` as an `onCaptureCamera`/`onClearCamera` callback pair.

### New/changed files

| File | Change |
|---|---|
| `packages/viewer/src/motion.ts` | Add `motionToWaypoints(motion, seatedPosition, opts)` and `waypointsToMotion(worldWaypoints, seatedPosition)` (pure): sample any motion to world waypoints, and convert dragged waypoints back to `linear`/`L`/`none`. Reuse existing `motionToKeyframes`. |
| `packages/viewer/src/MotionPathEditor.tsx` (new) | In-scene overlay: drei `Line` (red) through waypoints + draggable `TransformControls` handles; last handle locked; double-click insert / Delete remove. Emits world-space waypoints on change. |
| `packages/viewer/src/AssemblyPlayer.tsx` | Add props `editMotion?: {stepId, motion} \| null`, `onMotionChange?(stepId, motion)`. Render `<MotionPathEditor>` in `AssemblyScene` (sibling of `<primitive object={scene}>`) when editing the active step. `forwardRef` + `useImperativeHandle` exposing `captureCameraPose(): CameraPose` (bridged from an in-scene reporter that closes over `camera`/`controls`). Pause playback while editing. |
| `packages/viewer/src/index.ts` | Export the new helpers/types if consumed by ERP. |
| `apps/erp/app/routes/x+/assembly+/$id.tsx` | Hold `editingMotion` + `draftMotion` state and `playerRef`; thread `editMotion`/`onMotionChange` to `AssemblyPlayer`; pass camera + edit callbacks to `AssemblyInstructionProperties`. |
| `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx` | `StepForm`: add "Edit path in 3D" toggle (starts/stops the session; syncs `draftMotion` ↔ `motion`); support the `path` motion type in `makeMotionDraft`/`serializeMotion` (stop mapping `path → none`); add "Set camera to current view" + "Clear view" buttons and a `<Hidden name="camera" value=…>` field so camera persists on save. Keep numeric editor under an "Advanced" disclosure. |
| `apps/erp/app/modules/production/AGENTS.md`, `docs/specs/animated-work-instructions-contracts.md` | Doc the visual editor + camera authoring (keep-docs-in-sync). |

## Phases & tasks

### Phase 1 — Viewer helpers (pure, testable)
- [ ] `motionToWaypoints(motion, seatedPosition, {defaultDistance?})`: sample any
      motion into ordered world-space waypoints (start … seated) via `motionToKeyframes`,
      deduping coincident points. For `none` (or unsamplable), synthesize a short
      straight default offset so a path always exists to drag.
- [ ] `waypointsToMotion(worldWaypoints, seatedPosition)`: force last waypoint to
      seated, drop degenerate segments; 1 segment → `linear`, 2+ → `L`, none → `none`.
      Directions/distances match `motionToKeyframes`' reconstruction (verified: exact
      round-trip for linear/L).
- [ ] Verify: `pnpm --filter @carbon/viewer typecheck` + extend `motion.test.ts`
      (round-trip linear/L, multi-part safety, none→default, degenerate→none).

### Phase 2 — Editable red path in the viewer
- [ ] `MotionPathEditor.tsx`: drei `Line` (red, `lineWidth≈3`) through waypoints;
      `TransformControls` (translate) on each non-terminal handle; terminal handle a
      static locked marker. Double-click a segment inserts a midpoint; selecting a
      handle + Delete removes it (min 2). Convert handle positions → world waypoints,
      call `onMotionChange(stepId, waypointsToPathMotion(...))` on drag-end (debounced).
- [ ] Wire into `AssemblyScene`: render only when `editMotion?.stepId === activeStep.id`
      and not `readOnly`. Disable `OrbitControls` while dragging a handle (TransformControls
      `dragging-changed` → toggle `controls.enabled`). Pause the mixer; pin the edited
      part at the current preview pose so clip rebuilds don't clobber handles.
- [ ] Extend `AssemblyPlayerProps` with `editMotion`/`onMotionChange`; keep all existing
      props/behavior. `readOnly` path unchanged (MES unaffected).

### Phase 3 — Camera capture (imperative)
- [ ] `forwardRef` on `AssemblyPlayer`; `useImperativeHandle` exposing
      `captureCameraPose()`. In-scene `CameraPoseReporter` writes a getter
      (`() => ({position: camera.position.toArray(), target: controls.target.toArray(),
      fov: (camera as PerspectiveCamera).fov})`) into a ref the handle reads.
- [ ] No behavior change to existing `step.camera` consumption.

### Phase 4 — Editor + route integration
- [ ] `$id.tsx`: add `editingMotion`/`draftMotion` state + `playerRef`; pass
      `editMotion={editingMotion && {stepId, motion: draftMotion}}`,
      `onMotionChange={(stepId, m) => setDraftMotion(m)}` to `AssemblyPlayer`; pass
      `onCaptureCamera`/`onClearCamera` (read `playerRef.current.captureCameraPose()`,
      submit to the step route) and edit-session toggles to `AssemblyInstructionProperties`.
- [ ] `StepForm`: support `path` in `makeMotionDraft`/`serializeMotion`; add "Edit path
      in 3D" toggle that opens the session and binds the viewer's `draftMotion` back into
      `motion` (so the Hidden `motion` field + autosave use it); add "Set camera to current
      view" / "Clear view" buttons and `<Hidden name="camera">`. Numeric editor moves under
      an "Advanced" disclosure (kept, not removed).
- [ ] Autosave path edits on drag-end via the step fetcher (debounced ~500ms).

### Phase 5 — Verify
- [ ] `pnpm --filter @carbon/viewer typecheck`, `pnpm exec turbo run typecheck --filter=erp`,
      `pnpm run lint`, viewer unit tests.
- [ ] Browser (agent-browser `/auth` + `/test`): create/open a Draft instruction on a
      converted model → select a step → "Edit path" shows a red line with handles → drag a
      waypoint, add one, delete one → play the step and confirm the part follows the new
      path → "Set camera to current view", reload, confirm the step frames to the saved pose
      → "Clear view" returns to auto-frame. Confirm MES playback (readOnly) is unchanged.
- [ ] Screenshots in the PR (surface-designs rule).

## Risks / watch-items

- **Mixer vs handles.** The clip effect (`AssemblyPlayer.tsx:658`) rebuilds on step/seek
  and restores seated poses on cleanup. The editor overlay must live outside that lifecycle
  and edit must pause playback (decision #7), or drags will fight the animation.
- **World vs local space.** Handles are world-space; `buildStepClip` localizes to parent.
  Keep all editing in world space and only convert at `waypointsToPathMotion`; verify with a
  part that has a non-identity parent transform.
- **TransformControls + OrbitControls conflict.** Standard drei pattern: toggle
  `controls.enabled` on `dragging-changed`. Must restore on unmount.
- **`readOnly`/MES regression.** All new UI gates on `!readOnly` + Draft. Add an explicit
  check that the MES `Assembly.tsx` consumer compiles and behaves unchanged.
- **fov edge case.** Orthographic camera has no `fov`; guard with `PerspectiveCamera`
  instanceof (already the pattern at `:820`), fall back to 45.

## Out of scope (v1)

- 6-DOF waypoint rotation (orientation authoring).
- Editing `helix`/`L` *parameters* by 3D manipulation (numeric "Advanced" editor stays).
- Timeline-keyframe scrubbing UI beyond the existing playback scrubber.

## Resolved decisions (2026-07-06)

- **Remove the numeric motion editor entirely.** The visual path editor is the only
  motion editor. Any planner-produced motion (`linear`/`L`/`helix`/`none`) is converted
  to an editable `path` on selection via `motionToWaypoints`; there is **no** numeric
  Vec3/parameter fallback. `motionTypes` / `MotionDraft` / `serializeMotion` /
  `VectorInput` / `ScalarInput` and the `showMotionEditor` disclosure in `StepForm` are
  deleted. Consequence: helix/L can no longer be edited *parametrically* — only as a
  dragged path. (Accepted.)
- **Autosave path edits on drag-end** (debounced), via the step fetcher. No Save click.
- **Camera button in the properties panel**, reading the live pose through the
  `AssemblyPlayer` imperative ref.
