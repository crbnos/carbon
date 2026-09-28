# Sub-assembly staging — implementation plan

**Spec / source:** `.ai/specs/2026-09-28-assembly-subassembly-staging.md`
**Research:** `.ai/research/2026-09-28-assembly-subassembly-staging.md`
**Branch:** `feat/asembly-view-isolation` (worktree `/Users/aashu/work/carbon/carbon-feat-asembly-view-isolation`)

Rules for the executor:

- Never `git commit` (the user commits by hand).
- Never rebuild or reset the database. No migration is needed.
- New user-facing copy uses Lingui (`<Trans>` or `` t`…` ``).
- Validation commands are scoped. Whole-repo typecheck runs out of memory.

## Progress
- [x] Task 1: Viewer contract — `joinStepId` replaces `phase`
- [x] Task 2: Viewer `staging.ts` pure helpers + tests
- [x] Task 3: `buildStepClip` glide option + tests
- [x] Task 4: Wire staging into `AssemblyPlayer`
- [x] Task 5: ERP service — join validation, reorder cleanup, mapper
- [x] Task 6: ERP join route + path helper
- [x] Task 7: ERP step Details — "Build off to the side" select + join summary
- [x] Task 8: ERP explorer badge, Regenerate warning, own-parts in route
- [x] Task 9: MES select + mapper
- [x] Task 10: Lingui extraction
- [x] Task 11: Docs (viewer + production AGENTS.md)
- [ ] Task 12: End-to-end verification

## Dependencies
Tasks 1 → 2 → 3 → 4 run in order (all viewer). Task 5 needs 1. Task 6 needs 5. Tasks 7 and 8 need 2, 5 and 6. Task 9 needs 1 and is independent of 5–8. Task 10 needs 7 and 8. Task 11 can run any time after 4. Task 12 comes last.

---

## Task 1: Viewer contract — `joinStepId` replaces `phase`

**Depends on:** none
**Files:**
- Modify: `packages/viewer/src/types.ts`: in `AssemblyStep` (~line 117), replace the `phase` field and its doc comment.

**Steps:**
1. Delete the `phase?: { id: string; name: string; join: boolean } | null;` field and its comment block.
2. Add in its place:
   ```ts
   /**
    * Built off to the side: the id of the later JOIN step where the group this
    * step builds is carried into the main assembly (DB `parentStepId`).
    * `null`/absent = built in place. See `staging.ts`.
    */
   joinStepId?: string | null;
   ```
3. Leave `StepPhase` and `assignStepPhases` in `plan.ts` untouched. They are a separate, unused plan-side type.

**Verify:**
```bash
pnpm --filter @carbon/viewer typecheck
# Expected: exits 0 with no errors
```

**Out of scope:** `plan.ts`, `CURRENT_PLAN_VERSION`, and any geometry-service contract.

---

## Task 2: Viewer `staging.ts` pure helpers + tests

**Depends on:** 1
**Files:**
- Create: `packages/viewer/src/staging.ts`
- Create: `packages/viewer/src/staging.test.ts`
- Modify: `packages/viewer/src/index.ts`: export the new helpers and types
- Copy from (precedent): `packages/viewer/src/visibility.ts` + `visibility.test.ts` (a pure module with a vitest file), and `graph.test.ts` for building an `AssemblyGraphIndex` fixture via `indexAssemblyGraph`

**Steps:**
1. Create `staging.ts`. It must have no `three` imports. It uses `AssemblyGraphIndex` from `./graph` and `AssemblyStep`/`Vec3` from `./types`.
   ```ts
   /** Seconds the staged group takes to glide from its staging spot to the insertion start. */
   export const STAGING_GLIDE_SECONDS = 1.2;
   /** Gap between the main model and a staging lane, and between lanes, as a fraction of the assembly diagonal. */
   const STAGING_GAP_FRACTION = 0.25;

   export type StagingJoin = {
     /** Index of the join step */
     joinIndex: number;
     /** Every node installed by this join's staged steps, in step order (no dedupe loss: first occurrence wins) */
     nodeIds: string[];
     /** Pure world translation from seat to staging spot */
     offset: Vec3;
   };

   export type Staging = {
     /** Keyed by join step index */
     joins: Map<number, StagingJoin>;
     /** staged step index → its join step index */
     stagedToJoin: Map<number, number>;
   };

   export const EMPTY_STAGING: Staging = { joins: new Map(), stagedToJoin: new Map() };

   /** Ids of the parts a join step carries in: every componentNodeId of the steps pointing at it. */
   export function stagedGroupNodeIds(
     steps: Pick<AssemblyStep, "id" | "componentNodeIds" | "joinStepId">[],
     joinStepId: string
   ): string[];

   export function buildStaging(
     steps: Pick<AssemblyStep, "id" | "componentNodeIds" | "joinStepId">[],
     graphIndex: AssemblyGraphIndex | null
   ): Staging;

   /** nodeId → offset for every node that sits at its staging spot while step `activeIndex` is shown. */
   export function parkedOffsetsAt(
     staging: Staging,
     steps: Pick<AssemblyStep, "componentNodeIds">[],
     activeIndex: number
   ): Map<string, Vec3>;
   ```
2. `buildStaging` rules. Each one is defensive: the viewer ignores bad links rather than throwing.
   - A link counts only when: the join id resolves to a step index `j`; `j > i` (the staged index); `i !== 0`; step `j` has no `joinStepId` of its own; and step `i` is not itself a join target of another step. Otherwise, ignore the link (treat it as built in place).
   - Group `nodeIds`: concatenate `componentNodeIds` of the valid staged steps in index order, and drop duplicates.
   - Offset: with `graphIndex` null, return `EMPTY_STAGING`. Otherwise `root = graphIndex.graph.root.bbox`, `diag = hypot(max-min)`, and `gap = diag * STAGING_GAP_FRACTION`. Walk joins in ascending `joinIndex` with `cursor = root.max[0] + gap`. For each join, compute the group bbox (union of `graphIndex.nodesById.get(id)?.bbox` for its nodeIds, skipping unknown ids; skip the join entirely if none resolve). Set `offset = [cursor - groupMin[0], 0, 0]`, then `cursor += (groupMax[0] - groupMin[0]) + gap`.
3. `parkedOffsetsAt(staging, steps, a)`: for each `[i, j]` of `stagedToJoin` where `i <= a && a < j`, map every id in `steps[i].componentNodeIds` to `staging.joins.get(j).offset` (skip if the join is missing).
4. `staging.test.ts` must cover these cases:
   - Two staged steps pointing at step 3 give one join. `nodeIds` holds the union and the offset x is greater than 0.
   - A link pointing backwards, from the first step, to a staged step (nesting), or to an unknown id is ignored.
   - Two joins get non-overlapping lanes: the second lane's `min x + offset` is at least the first's `max x + offset + gap`.
   - `parkedOffsetsAt` returns nothing before a staged step, includes the staged step's own nodes when it is active, includes earlier staged nodes on later staged steps, and returns nothing at or after the join index.
   - `stagedGroupNodeIds` returns the union for a join id and `[]` for others.
5. Export from `index.ts`: `buildStaging`, `parkedOffsetsAt`, `stagedGroupNodeIds`, `STAGING_GLIDE_SECONDS`, `EMPTY_STAGING`, `type Staging`, and `type StagingJoin`. Also add `stagedGroupNodeIds` to `steps.ts` (the three-free subpath) so server code can use it.

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- staging
# Expected: all staging tests pass
pnpm --filter @carbon/viewer typecheck
# Expected: exits 0
```

**Out of scope:** rendering code and `AssemblyPlayer.tsx`.

---

## Task 3: `buildStepClip` glide option + tests

**Depends on:** 2
**Files:**
- Modify: `packages/viewer/src/motion.ts`: `StepClipOptions` and `buildStepClip` (~line 467)
- Modify: `packages/viewer/src/motion.test.ts`: add cases in `describe("buildStepClip")` (~line 325)

**Steps:**
1. Extend `StepClipOptions` with:
   ```ts
   /** Join step: prepend a straight glide from seat+offset to the insertion start. */
   glide?: { offset: Vec3; seconds: number };
   ```
2. In `buildStepClip`:
   - The early return becomes `if ((step.motion.type === "none" && !options.glide) || step.componentNodeIds.length === 0) return null;`.
   - Per node, compute the insertion keyframes as today. If the motion is `none`, use a single keyframe at the seated pose (`times [0]`).
   - If `glide` is set: `glideStart = seat + offset`, `glideEnd = first insertion keyframe position` (the quaternion stays the seated one). Build `EASE_SAMPLES + 1` eased samples with `easeInOutCubic` over `glide.seconds`, then append the insertion keyframes with times shifted by `glide.seconds` (skip the insertion's t=0 frame because it duplicates `glideEnd`).
   - Clip duration becomes `glide.seconds + insertion duration (0 for none) + hold`.
3. Add these tests:
   - A glide on a linear motion: the first keyframe position is `seat + offset`, the frame at `t = seconds` equals the linear start, the last non-hold frame equals the seat, and `clip.duration` equals `seconds + motionDuration + hold`.
   - A glide on `none`: the clip is not null, it starts at `seat + offset`, and it ends at the seat.
   - Without a glide, the output is unchanged (existing tests still pass).

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- motion
# Expected: all motion tests pass, including the new glide cases
```

**Out of scope:** `naturalizeMotion` (the glide is never clamped), `motionToKeyframes` and `stepTimelineSeconds`.

---

## Task 4: Wire staging into `AssemblyPlayer`

**Depends on:** 3
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx`

**Steps:**
1. **Top-level component** (where `displaySteps` is built, ~line 325):
   - `const staging = useMemo(() => buildStaging(steps, graphIndex), [steps, graphIndex]);`
   - In `displaySteps`: for a step index in `staging.joins`, the display step's `componentNodeIds` = `[...own, ...join.nodeIds]` (deduped) BEFORE fallback and naturalize. This way the fallback motion, the naturalized travel, the hidden-set exclusion and the camera all cover the moving group. Add `staging` to the memo deps.
   - `segments`: `displaySteps.map((s, i) => stepTimelineSeconds(s) + (staging.joins.has(i) && !(s.durationSeconds && s.durationSeconds > 0) ? STAGING_GLIDE_SECONDS : 0))`.
   - Pass `staging` to `AssemblyScene` as a new prop `staging: Staging`, typed in the props block with a doc comment.
2. **`AssemblyScene` clip effect** (~line 1289):
   - Add to `clipKey`: `JSON.stringify([...parkedOffsetsAt(staging, steps, activeStepIndex)].sort())` and `JSON.stringify(staging.joins.get(activeStepIndex)?.offset ?? null)`, and add `componentPickerActive`.
   - At the top of the effect body (after the seek bookkeeping and the `!step` return), if `!isEditingActive && !componentPickerActive`, compute `parked = parkedOffsetsAt(staging, stepsLiveRef.current, activeStepIndex)`. Reduce it to TOP-MOST nodes: skip a node whose `Object3D` ancestor chain contains another parked node (walk `node.parent` and check `userData.nodeId`). For each top-most node, save `{node, position, quaternion}`, then move it: compute the world position, add the offset, and convert back to parent-local with `node.parent.worldToLocal(...)`. Call `node.updateWorldMatrix(true, true)` afterwards.
   - Every return path after this point must return a cleanup that restores the parked nodes. Restore the clip's `restore` list FIRST and the parked list SECOND. Restructure the early returns (editing, no clip) so they return a cleanup that restores `parked`.
   - Build the clip with `buildStepClip(step, nodesById, glide)`, where `glide = staging.joins.get(activeStepIndex) ? { glide: { offset: join.offset, seconds: STAGING_GLIDE_SECONDS } } : {}`. Pass the glide only when not editing and not picking.
3. **Fade effect** (~line 1411): add `&& !staging.joins.has(activeStepIndex)` to `fadesIn`, because a join step glides and never fades.
4. **Camera framing effect** (~line 1670):
   - Add a JSON of `parkedOffsetsAt(...)` and the join offset to `framingKey`.
   - When building `componentBox`, translate each node's seated bbox by its parked offset (if any).
   - For a join step, also push the 8 corners of `componentBox` translated by `join.offset` into both `lookPoints` and `actionPoints`, so the frame covers the staging spot and the seat.
   - Where `getAssemblyBox()` is used for the framing center/radius, expand a clone of it by those translated corners when the step is staged or a join.
5. Leave the visual pass (`stepIndexByNode`, `visualForComponent`) unchanged. It already claims the first installing step, and staged steps come before their join.

**Verify:**
```bash
pnpm --filter @carbon/viewer typecheck
# Expected: exits 0
pnpm --filter @carbon/viewer test
# Expected: all suites pass (camera, fallback, graph, motion, plan, staging, visibility)
```
If the parked-restore ordering cannot be made correct inside the single clip effect (for example, a second effect also moves nodes), STOP and report. Do not add a second position-writing effect.

**Out of scope:** `MotionPathEditor`, `visibility.ts` view modes, and the fallback algorithm.

---

## Task 5: ERP service — join validation, reorder cleanup, mapper

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts`: add a validator next to `assemblyInstructionStepHiddenComponentsValidator` (~line 1473)
- Modify: `apps/erp/app/modules/production/production.service.ts`: new `updateAssemblyStepJoin` after `updateAssemblyStepHiddenComponents` (~line 7288); change `updateAssemblyInstructionStepOrder` (~line 7490); map `joinStepId` in `toViewerStep` (~line 9263)
- Modify: `apps/erp/app/routes/x+/assembly+/$id.steps.order.tsx`: pass `params.id`

**Steps:**
1. Validator:
   ```ts
   export const assemblyInstructionStepJoinValidator = z.object({
     joinStepId: zfd.text(z.string().optional())
   });
   ```
   Match whatever `zfd`/`z` import style the file already uses. An empty value means "build in place".
2. Service function. It uses the supabase client and is scoped by `companyId`:
   ```ts
   export async function updateAssemblyStepJoin(
     client: SupabaseClient<Database>,
     data: { stepId: string; joinStepId: string | null; companyId: string; updatedBy: string }
   ): Promise<{ error: string | null }>
   ```
   - Load the step (`id, assemblyInstructionId, sortOrder`) with `.eq("id").eq("companyId")`. If it is missing, return `{ error: "Step not found" }`.
   - If `joinStepId` is set: load all steps of the instruction (`id, sortOrder, parentStepId`) with one query, ordered by `sortOrder`. Reject when:
     - the join is not in that list: "The join step is not in this instruction";
     - the step is the first in the list: "The first step is the base and can't be built aside";
     - `join.sortOrder <= step.sortOrder`: "The join step must come after this step";
     - `join.parentStepId` is not null: "The join step is itself built aside";
     - any row has `parentStepId === step.id`: "This step is a join step, so it can't be built aside".
   - Update `parentStepId`, `updatedBy` and `updatedAt` on the step. Return `{ error: update.error?.message ?? null }`.
   - Doc comment: "parentStepId = the join step this step is built aside for (see the sub-assembly staging spec)."
3. `updateAssemblyInstructionStepOrder(db, assemblyInstructionId, updates)`: after the sortOrder loop, inside the same transaction, clear the links that now point backwards:
   ```ts
   await trx
     .updateTable("assemblyInstructionStep as s")
     .set({ parentStepId: null })
     .where("s.assemblyInstructionId", "=", assemblyInstructionId)
     .where("s.parentStepId", "is not", null)
     .where(({ exists, selectFrom }) =>
       exists(
         selectFrom("assemblyInstructionStep as j")
           .select("j.id")
           .whereRef("j.id", "=", "s.parentStepId")
           .whereRef("j.sortOrder", "<=", "s.sortOrder")
       )
     )
     .execute();
   ```
   Update the only caller, `$id.steps.order.tsx`, to pass `params.id`. Confirm with a `grep -rn "updateAssemblyInstructionStepOrder" apps packages` that there is no other caller. If there is one, STOP and report.
4. `toViewerStep`: add `joinStepId: step.parentStepId ?? null`.
5. Regenerate the MCP digest only if the repo's check requires it after adding a service function: run `pnpm run generate:mcp` if `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json` is stale. The digest was regenerated in the previous commit on this branch, so follow the same practice.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: typecheck task for erp succeeds
```

**Out of scope:** the DB trigger, migrations and `reassignAssemblyStepComponents`.

---

## Task 6: ERP join route + path helper

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/routes/x+/assembly+/$id.steps.join.$stepId.tsx`
- Modify: `apps/erp/app/utils/path.ts`: add `assemblyInstructionStepJoin` next to `assemblyInstructionStepHiddenComponents` (~line 376)
- Copy from (precedent): `apps/erp/app/routes/x+/assembly+/$id.steps.hidden.$stepId.tsx`

**Steps:**
1. Path helper: `assemblyInstructionStepJoin: (id: string, stepId: string) => generatePath(\`${x}/assembly/${id}/steps/join/${stepId}\`)`.
2. Route: copy the hidden route. Use `requirePermissions(request, { update: "production" })` and also take `companyId` from its result. Validate with `assemblyInstructionStepJoinValidator` and call `updateAssemblyStepJoin(client, { stepId, joinStepId: validation.data.joinStepId || null, companyId, updatedBy: userId })`. On `error`, return `data({ success: false, message: error }, await flash(request, error(null, message)))`. On success, return `{ success: true }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: succeeds
```

**Out of scope:** any other step route.

---

## Task 7: ERP step Details — "Build off to the side" select + join summary

**Depends on:** 2, 5, 6
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx`
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx`: pass the new props
- Copy from (precedent): `StepStatusControl` in `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx:928-1000` (autosaving `useFetcher` + `DropdownMenuRadioGroup`, optimistic value). For the box styling, copy the "Camera" box in `AssemblyInstructionProperties.tsx:~562`.

**Steps:**
1. New props on `AssemblyInstructionProperties`: `steps: AssemblyInstructionStepRow[]` (all steps, sortOrder-ordered), plus `onSelectStep: (stepId: string) => void`. Pass them from `$id.tsx`, which already has the steps list and a select-step handler. Find the existing handler name used by the Explorer and reuse it.
2. New component `StepJoinEditor` in the same file, rendered in `StepForm` directly after the Camera box:
   - Label: `<Trans>Build off to the side</Trans>`.
   - Options: "No, build in place" (value `""`), then for each VALID join step (the same rules as the service, computed client-side from `steps`): `t\`Yes, joins at step ${n}: ${title}\``. Use `describeStep` for untitled steps, the same way the header title does.
   - Disabled (plain text chip instead of a dropdown) when `isDisabled`, when this is the first step, or when this step is itself a join step. In those last two cases, show a muted one-line reason: `t\`The first step is the base.\`` / `t\`This step brings in a group, so it's built in place.\``.
   - On change, `fetcher.submit({ joinStepId }, { method: "post", action: path.to.assemblyInstructionStepJoin(instructionId, step.id) })`. Show the optimistic value from `fetcher.formData`.
3. On a join step (other steps point at it), render inside the same box a read-only line: `<Trans>Brings in the group from steps</Trans>` followed by step-number buttons (`Button variant="link" size="sm"`) that call `onSelectStep(id)`.
4. Helper text under the select (muted, `text-xs`): `<Trans>Its parts are built beside the model, then carried in at the join step.</Trans>`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: succeeds
```

**Out of scope:** the Components and Hidden boxes (Task 8 changes only what they receive).

---

## Task 8: ERP explorer badge, Regenerate warning, own-parts in route

**Depends on:** 2, 5
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx`: step row (~line 1100) and Regenerate modal (~line 815)
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx`: `selectedOwnNodeIds` (~line 298)
- Copy from (precedent): the `needsSupport` icon span in the same step row, for badge placement; `Badge` from `@carbon/react`

**Steps:**
1. Step row: when `step.parentStepId` is set, render `<Badge variant="secondary" className="shrink-0"><Trans>Built aside</Trans></Badge>` before the `×count` span.
2. Regenerate modal body: when any step has `parentStepId`, add a paragraph: `<Trans>Regenerating removes "Build off to the side" settings.</Trans>`
3. `$id.tsx`: extend `selectedOwnNodeIds` to include the staged group when the selected step is a join step:
   ```ts
   const selectedOwnNodeIds = useMemo(() => {
     const own = draftComponentNodeIds ?? selectedStep?.componentNodeIds ?? [];
     if (!selectedStep) return own;
     const staged = stagedGroupNodeIds(viewerSteps, selectedStep.id);
     return staged.length === 0 ? own : [...new Set([...own, ...staged])];
   }, [draftComponentNodeIds, selectedStep, viewerSteps]);
   ```
   (`viewerSteps` is defined further down at ~line 432. Move its `useMemo` above this one.) Check every consumer of `selectedOwnNodeIds` (grep in the file). It must only feed the "This step" badge, the hide eligibility and the hidden-list filter. If it also feeds a SAVE of `componentNodeIds`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: succeeds
```

**Out of scope:** the BOM-tree "Move / Add a copy" modal.

---

## Task 9: MES select + mapper

**Depends on:** 1
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts:~640`: add `parentStepId` to the select string
- Modify: `apps/mes/app/components/AssemblyView.tsx:190-230`: add `parentStepId: string | null` to the `AssemblyPlayback` step type, and `joinStepId: step.parentStepId ?? null` in `toViewerStep`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: succeeds
```

**Out of scope:** any MES UI.

---

## Task 10: Lingui extraction

**Depends on:** 7, 8
**Steps:**
1. Run `pnpm run lingui:extract`.
2. `git diff --stat packages/locale` must show only the ERP catalogs (`packages/locale/locales/*/erp.po`) plus any lines the extract touched for the new strings. If unrelated catalogs churn heavily, revert that churn with `git checkout -- <file>` and keep only the new msgids.
3. Run `pnpm run lingui:clean` if the headers changed (the repo's own script).

**Verify:**
```bash
grep -c "Build off to the side" packages/locale/locales/en/erp.po
# Expected: 1 or more
```

---

## Task 11: Docs

**Depends on:** 4
**Files:**
- Modify: `packages/viewer/AGENTS.md`:
  - In the Step concept, replace "subassembly `phase`" with "`joinStepId` (built off to the side, see `staging.ts`)".
  - Fix the stale "must contain an `isolate` view" rule to match `visibility.ts` (Isolate was dropped on this branch).
  - Add `staging.ts` to the key building blocks, and the staging test to the test list.
- Modify: `apps/erp/app/modules/production/AGENTS.md`: one line under Assembly Instructions: "`assemblyInstructionStep.parentStepId` = the join step a step is built aside for (sub-assembly staging); written by `updateAssemblyStepJoin`, cleared on reorder when it points backwards."

**Verify:**
```bash
grep -n "joinStepId" packages/viewer/AGENTS.md
# Expected: at least one match
```

---

## Task 12: End-to-end verification

**Depends on:** all
**Steps:**
1. Run:
   ```bash
   pnpm --filter @carbon/viewer test
   pnpm --filter @carbon/viewer typecheck
   pnpm exec turbo run typecheck --filter=erp --filter=mes
   pnpm run lint
   ```
   Expected: all pass. Report any failure with its output.
2. Browser check (ask the user first, per AGENTS.md "With the user's permission, use the /auth and /test skill"): on an assembly with at least 5 steps, run acceptance criteria 1–5 and 7 from the spec. Take screenshots of step 4 (group at the side) and mid-glide on step 6. Check criterion 6 (MES) only if the MES app is running locally.
3. Tick the Progress list, and add a changelog line to the spec ("implemented").
4. Do NOT commit. Report to the user in 1–3 lines.
