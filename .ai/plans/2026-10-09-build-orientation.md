# Per-step build orientation — implementation plan

> **Historical — superseded by the implemented spec.** This plan records how the work started. The code and `.ai/specs/implemented/2026-10-09-build-orientation.md` are the source of truth. Later changes moved the ERP wiring into the `useBuildOrientation` and `useStepMotionEditor` hooks, and saved views into the bench frame.

**Spec:** .ai/specs/implemented/2026-10-09-build-orientation.md
**Research:** N/A. The user gave clear requirements, and this is not ERP-domain logic. The run record logs the skip.
**Branch:** feat/sub-assembly-motion-path

> The user forbids commits without permission. Each task ends at its Verify block. Do not commit.

## Progress
- [x] Task 1: Add the `orientation` column and regenerate the types
- [x] Task 2: Add the pure orientation module to the viewer, with tests
- [x] Task 3: Show the orientation in the player as a camera frame
- [x] Task 4: Save the orientation through the motion route
- [x] Task 5: Wire the turn and Reset handlers in the assembly route
- [x] Task 6: Add the Orientation row to the step's Playback panel
- [x] Task 7: Pass the orientation to the MES player
- [x] Task 8: Update the docs, AGENTS.md files, catalogs and MCP digest
- [x] Task 9: Verify in the browser

## Dependencies
- Task 4 needs Task 1 (generated types).
- Task 3 needs Task 2.
- Tasks 5 and 6 need Tasks 2 and 4.
- Task 7 needs Tasks 1 and 2.
- Task 8 needs Task 6.
- Task 9 needs every other task.
- Tasks 2 and 1 are independent of each other.

---

## Task 1: Add the `orientation` column and regenerate the types

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_assembly-step-orientation.sql` (the CLI picks the timestamp)
- Modify: `packages/database/src/types.ts` and the other generated files — regenerated, never hand-edited
- Copy from (precedent): `packages/database/supabase/migrations/20260925063121_assembly-step-hidden-components.sql`

**Steps:**
1. Run `pnpm db:migrate:new assembly-step-orientation`.
2. Write this SQL into the new file:
   ```sql
   -- The build's orientation from this step on: a unit quaternion [x, y, z, w]
   -- that turns the model frame into the bench frame. Applied by the 3D player
   -- in the ERP editor and in MES. NULL = same as the previous step in the
   -- same build (main build or sub-assembly); a sub-assembly starts upright.
   ALTER TABLE "assemblyInstructionStep"
     ADD COLUMN IF NOT EXISTS "orientation" JSONB;
   ```
3. Run `pnpm db:migrate`.
4. Run `pnpm run generate:types`.

If `pnpm db:migrate` fails because the local stack is down, STOP and report. Do not apply the SQL with `psql` (`.ai/lessons.md`: PostgREST keeps a stale schema cache).

**Verify:**
```bash
grep -n '"orientation"' packages/database/src/types.ts | head -3
# Expected: at least one line inside the assemblyInstructionStep Row type
```

**Out of scope:** RLS, indexes, dataset files. The column is nullable, and `datasets/sql.ts` reads columns from `information_schema`.

## Task 2: Add the pure orientation module to the viewer, with tests

**Depends on:** none
**Files:**
- Create: `packages/viewer/src/orientation.ts`
- Create: `packages/viewer/src/orientation.test.ts`
- Modify: `packages/viewer/src/types.ts` — add `orientation?: Quat | null` to `AssemblyStep`, with a doc comment
- Modify: `packages/viewer/src/index.ts` — export the new module
- Copy from (precedent): `packages/viewer/src/subassembly.ts` (pure module), `packages/viewer/src/subassembly.test.ts`

**Steps:**
1. Start the file with the AGPL SPDX header, as in `subassembly.ts`.
2. Export `type BuildTurn = "tipForward" | "tipBack" | "turnLeft" | "turnRight"`.
3. Export `IDENTITY_ORIENTATION: Quat = [0, 0, 0, 1]`.
4. Export `isOrientation(value: unknown): value is Quat`. It accepts 4 finite numbers with a length within 1e-3 of 1.
5. Export `sameOrientation(a: Quat, b: Quat): boolean`. It compares `|dot(a, b)| > 1 - 1e-6`, so `q` and `-q` match.
6. Export `snapOrientation(q: Quat): Quat`. Build the rotation matrix with three's `Matrix4`. Round each entry to -1, 0 or 1. Convert the matrix back with `Quaternion.setFromRotationMatrix`.
7. Export `upForOrientation(q: Quat): Vec3`. It returns `inverse(q) · (0, 0, 1)`.
8. Export `resolveOrientations(steps)`. Each step has the shape `Pick<AssemblyStep, "id" | "orientation" | "parentStepId" | "usedInStepId" | "isSubAssembly">`. The function returns `{ orientation: Quat; sourceStepId: string | null }[]` in step order:
   1. Keep a `Map<string | null, { orientation; sourceStepId }>`, keyed by `worldOf(steps, step.id)` from `subassembly.ts`.
   2. If `isOrientation(step.orientation)`, set the map entry of the step's build to `{ step.orientation, step.id }`.
   3. Push the build's entry, or `{ IDENTITY_ORIENTATION, null }` when the build has none.
9. Export `turnOrientation(current: Quat, turn: BuildTurn, view: { position: Vec3; target: Vec3 }): Quat`:
   1. Get the camera direction `d = position - target` in the model frame. Turn it into the bench frame: `d_b = current · d`.
   2. Set `h` to `d_b` with `z = 0`, then normalize it.
   3. If the length of `h` is below 1e-6, the camera looks straight down. Use `h = (0, -1, 0)`, the CAD front.
   4. For turnLeft, use axis (0,0,1) and angle −π/2. For turnRight, use axis (0,0,1) and +π/2.
   5. For tipForward, use axis `Z × h` and +π/2. For tipBack, use the same axis and −π/2.
   6. Return `snapOrientation(R · current)`.
10. Write tests in `orientation.test.ts`:
    1. `resolveOrientations`: a main-build step sets a flip. The next main step inherits it with `sourceStepId` of the setter.
    2. `resolveOrientations`: a sub-assembly member after that flip gets `IDENTITY_ORIENTATION` and `sourceStepId: null`. Use the row shapes of `subassembly.test.ts`.
    3. `resolveOrientations`: a turn on a sub-assembly member does not change the next main-build step.
    4. `turnOrientation`: camera at (0, -10, 0), target at the origin, `tipForward` from identity. Assert that the bench up of the model's top `(0,0,1)` moves to (0, -1, 0). The top moves toward the camera.
    5. `turnOrientation`: `turnLeft` then `turnRight` gives a result `sameOrientation` to identity.
    6. `turnOrientation`: `tipForward` twice gives a 180° turn. The model's top points to (0, 0, -1) in the bench frame.
    7. `snapOrientation`: a quaternion 1° off a right angle snaps exactly to that right angle.
    8. `isOrientation`: `[0,0,0,1]` passes. `[0,0,0,2]` and `[1,2,3]` fail.

If `worldOf` does not accept the row shape in step 8, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- orientation
# Expected: every test in orientation.test.ts passes
pnpm --filter @carbon/viewer typecheck
# Expected: exit 0
```

**Out of scope:** the player, the ERP and the MES.

## Task 3: Show the orientation in the player as a camera frame

**Depends on:** Task 2
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx`
- Copy from (precedent): the camera transition `useFrame` at `AssemblyPlayer.tsx:2048` and the per-step framing effect at `:2093`

**Steps:**
1. In `AssemblyPlayer`, compute `orientations = useMemo(() => resolveOrientations(steps), [steps])`.
2. Pass `orientation={orientations[activeStepIndex]?.orientation ?? IDENTITY_ORIENTATION}` to `AssemblyScene`. Add the prop to its type.
3. In `AssemblyScene`, add `frameRef = useRef<{ applied: Quaternion; from: Quaternion; to: Quaternion; start: number } | null>(null)`.
4. Add an effect on `[orientation, controls]`:
   1. If `frameRef.current` is null, snap. Rotate the camera offset about `controls.target` by `inverse(orientation)`. Set `camera.up` to `upForOrientation(orientation)`. Store `applied = from = to = orientation`. Call `controls.update()`.
   2. Else, if `to` equals `orientation` (`sameOrientation`), do nothing.
   3. Else set `from = applied`, `to = orientation`, `start = performance.now()`.
5. In the transition `useFrame`, before the desired-pose code:
   1. If `applied` is not `to`, compute `t = ease(clamp((now - start) / 900))` with a cubic ease-in-out.
   2. Set `next = from.clone().slerp(to, t)`.
   3. Set `delta = next⁻¹ · applied`. Apply `delta` to the camera offset from `controls.target`, and to `camera.up`.
   4. Set `applied = next`. Call `controls.update()`.
   5. If `t < 1`, return. The desired-pose approach waits for the end of the turn.
6. In the controls `onStart` handler, finish a turn at once. Set `applied` to `to` through the same `delta` step.
7. In the framing effect, replace `camera.up.clone()` at line 2224 with `new Vector3(...upForOrientation(orientation))`.
8. Add `orientation.join(",")` to `framingKey` and `orientation` to the effect deps.
9. Make `captureCameraPose` return the pose in the bench frame (`buildFrame.toBench`). A saved view stays where the viewer stands when the build turns. (The first version kept the model frame. The browser test showed that a flip then swung the camera under the bench.)

If the GizmoViewcube tween sets `camera.up` back to Z, record it for Task 9. Do not patch drei.

**Verify:**
```bash
pnpm --filter @carbon/viewer typecheck
# Expected: exit 0
pnpm --filter @carbon/viewer test
# Expected: all tests pass (the 158 earlier tests plus the Task 2 tests)
```

**Out of scope:** `motion.ts`, `MotionPathEditor.tsx` and the box select. They stay in the model frame.

## Task 4: Save the orientation through the motion route

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — `orientationSchema`, and `orientation` in `assemblyInstructionStepMotionValidator`
- Modify: `apps/erp/app/modules/production/production.service.ts` — `updateAssemblyStepMotion` and `toViewerStep`
- Modify: `apps/erp/app/routes/x+/assembly+/$id.steps.motion.$stepId.tsx` — pass `orientation`
- Copy from (precedent): the `camera` field in the same three places

**Steps:**
1. In `production.models.ts`, export `orientationSchema = unitQuaternion`. Place it after `cameraSchema`.
2. Add `orientation: jsonField(orientationSchema.nullable().optional())` to `assemblyInstructionStepMotionValidator`.
3. Add `orientation?: z.infer<typeof orientationSchema> | null` to the `updateAssemblyStepMotion` data type.
4. Spread `orientation` into the update when it is not `undefined`, as `camera` is spread.
5. Extend the doc comment: `orientation: null` clears the step's own orientation.
6. In `toViewerStep`, parse `step.orientation` with `orientationSchema.safeParse`. Map a failure to `null`.
7. In the route action, pass `orientation: validation.data.orientation`. Add `hasOrientation` to the log call.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** `upsertAssemblyInstructionStep`. The step form never writes the orientation.

## Task 5: Wire the turn and Reset handlers in the assembly route

**Depends on:** Tasks 2, 4
**Files:**
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx`
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx` — thread three props to `StepForm`
- Copy from (precedent): `onSetCamera` / `onClearCamera` in `$id.tsx` (around line 711)

**Steps:**
1. Add `orientationFetcher = useFetcher<{ success: boolean }>()`.
2. Read the pending value: if `orientationFetcher.formData` exists, read `stepId` and `orientation` from it.
3. In the `viewerSteps` memo (line 322), replace that step's `orientation` with the pending value. This is the optimistic display.
4. Add `onTurnBuild(stepId, turn)`:
   1. Read the pose with `playerRef.current?.captureCameraPose()`. If it is null, show the same toast as `onSetCamera`.
   2. Find the step's resolved orientation with `resolveOrientations(viewerSteps)`.
   3. Compute `next = turnOrientation(current, turn, pose)`.
   4. Find the orientation the step gets from earlier steps: resolve the steps with this step's `orientation` set to `null`.
   5. If `next` is `sameOrientation` to that inherited value, post `null`. Else post `next`.
5. Post with `orientationFetcher.submit`. Send `stepId` and `orientation` (JSON) to `path.to.assemblyInstructionStepMotion(id, stepId)`.
6. Add `onResetOrientation(stepId)`. It posts `orientation` as the string `null`.
7. Pass the handlers to `AssemblyInstructionProperties` as one grouped `orientation` prop (`BuildOrientationControls`: `onTurn`, `onReset`, `isSaving`). In the final code, `useBuildOrientation` (`ui/Assemblies/useBuildOrientation.ts`) owns the fetcher, steps 1–6 and this object. `$id.tsx` only calls the hook.
8. Thread the `orientation` prop through `AssemblyInstructionProperties` to `StepForm`. Do not pass it to `AssemblySubAssemblyProperties`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** the motion fetcher and its pending-save logic. Keep the orientation on its own fetcher.

## Task 6: Add the Orientation row to the step's Playback panel

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx` — the row in `StepForm`
- Modify: `docs/content/src/glossary/terms.ts` — the term `assembly-build-orientation`
- Copy from (precedent): the Camera `PlaybackRow` in `StepForm` (around line 751) and the `assembly-step-camera` glossary term

**Steps:**
1. Add the glossary term `assembly-build-orientation` next to `assembly-step-camera`. Copy its shape. Definition: "The way the whole build is turned on a step, for example flipped to fit parts on its underside. Later steps of the same build keep it until a step turns the build again."
2. In `StepForm`, compute `resolved = useMemo(() => resolveOrientations(viewerSteps), [viewerSteps])`. Take the entry at this step's index.
3. Set `ownsOrientation = entry.sourceStepId === step.id`.
4. Set `turned = !sameOrientation(entry.orientation, IDENTITY_ORIENTATION)`.
5. Choose the value text:
   1. If `ownsOrientation`: `<Trans>Turned</Trans>`.
   2. Else if `turned`: `<Trans>Same as step {number}</Trans>`, with the number from `subPlan.get(entry.sourceStepId)?.number`.
   3. Else: `<Trans>Upright</Trans>`.
6. Add the `PlaybackRow` after the Camera row. Use `LabelWithHelp termId="assembly-build-orientation"` with the label `<Trans>Orientation</Trans>`.
7. If `!isDisabled`, render an `HStack` of 4 icon buttons and Reset:
   1. Use `IconButton` from `@carbon/react`, `variant="ghost"`, `size="sm"`. Grep an existing `IconButton` use in `apps/erp/app/modules/production/ui/Assemblies/` and copy its props.
   2. Labels and tooltips: t`Tip forward`, t`Tip back`, t`Turn left`, t`Turn right`.
   3. Icons from `react-icons/lu`: `LuArrowUpFromLine`, `LuArrowDownToLine`, `LuRotateCcw`, `LuRotateCw`. Check that each one exists in `node_modules/react-icons/lu/index.d.ts` first.
   4. Each button calls `onTurnBuild(step.id, turn)` and has `isDisabled={isSavingOrientation}`.
   5. If `ownsOrientation`, add a ghost `Button` `<Trans>Reset</Trans>` that calls `onResetOrientation(step.id)`.

If `LabelWithHelp` rejects the new term id at typecheck, STOP and report how term ids are typed.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies apps/erp/app/routes/x+/assembly+ packages/viewer/src docs/content/src/glossary/terms.ts
# Expected: no errors
```

**Out of scope:** the sub-assembly header panel and the step list. The spec puts the row only in `StepForm`.

## Task 7: Pass the orientation to the MES player

**Depends on:** Tasks 1, 2
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — the select at line 664
- Modify: `apps/mes/app/components/AssemblyView.tsx` — the `steps` type and `toViewerStep`
- Copy from (precedent): `hiddenComponentNodeIds` in the same two files

**Steps:**
1. Add `orientation` to the select string after `camera`.
2. Add `orientation: Json | null` to the `AssemblyPlayback["steps"]` type.
3. In `toViewerStep`, set `orientation: isOrientation(step.orientation) ? step.orientation : null`. Import `isOrientation` from `@carbon/viewer`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
```

**Out of scope:** MES authoring. The MES only plays the orientation.

## Task 8: Update the docs, AGENTS.md files, catalogs and MCP digest

**Depends on:** Task 6
**Files:**
- Modify: `docs/content/docs/reference/assembly-instructions.mdx` — the Orientation field
- Modify: `packages/viewer/AGENTS.md` — the orientation concept and the new exports
- Modify: `apps/erp/app/modules/production/AGENTS.md` — the `orientation` column in the data model row
- Modify: `packages/locale/locales/*/erp.po` — by extract only
- Modify: `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json` — by `generate:mcp` only, if it changes
- Copy from (precedent): the Camera and Motion field text in the same `.mdx` file

**Steps:**
1. In the `.mdx` reference, describe the Orientation field after the Camera field. Name the four buttons, Reset, the carry-forward rule and the sub-assembly rule.
2. In `packages/viewer/AGENTS.md`, add an "Orientation" concept bullet. Say that the player shows it as a camera frame, and why.
3. In the production `AGENTS.md`, add `orientation` to the `assemblyInstruction` / `assemblyInstructionStep` row.
4. Run `pnpm lingui:extract`. Leave the non-English `msgstr` values empty. The user fills them.
5. Run `pnpm run generate:mcp`.

**Verify:**
```bash
git diff --stat -- packages/locale/locales/en/erp.po apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json
# Expected: erp.po changed; the digest changed or stayed the same without error
pnpm --filter docs typecheck
# Expected: exit 0
```

**Out of scope:** translations. The user fills them.

## Task 9: Verify in the browser

**Depends on:** Tasks 1–8
**Files:**
- Modify: `.ai/playbooks/assembly-sub-assembly-motion-path.md` — add the orientation checks, or create `.ai/playbooks/assembly-build-orientation.md`

**Steps:**
1. Run `/test` on the seeded satellite instruction, Draft Version 2 (`db3o5hb3i0gh4nc6mmv0`).
2. Use one `AGENT_BROWSER_SESSION`. Restart it about every 40 screenshots.
3. Check each acceptance criterion of the spec, one by one.
4. Check the viewcube risk: click a viewcube face on a turned step, then note what `up` does.
5. Record the results as a pass/fail table in the run record.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-10-09-build-orientation.md
# Expected: one PASS line for each browser-checked acceptance criterion
```

**Out of scope:** the MES in the browser, unless an MES operation already links the instruction. The MES typecheck and the shared player cover it.
