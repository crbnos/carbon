# Sub-assembly staging: current-state research

Repo: `/Users/aashu/work/carbon/carbon-feat-asembly-view-isolation` (HEAD `adc20aa2ce`, clean tree).
Paths below are relative to that root. Anything I inferred rather than read is marked **(inference)**.

---

## TL;DR

- **Staging is half-built already.** `packages/viewer/src/plan.ts:460-610` `assignStepPhases` sorts plan step groups into "staged subassembly clusters" plus the step where each one `join`s. `AssemblyStep.phase` is typed at `types.ts:117-123`. The docs say a phase "builds staged off to the side and flies into the main body at its `join` step" (`plan.ts:146-153`).
- **None of it is used.** `generateAssemblyStepsFromPlan` never writes `group.phase` (`production.service.ts:9155-9201`). There is no `phase` column. `toViewerStep` (ERP `production.service.ts:9263-9284`, MES `AssemblyView.tsx:210-230`) never sets it. `AssemblyPlayer.tsx` never reads it: grep finds `phase` only in `types.ts` and `plan.ts`. `plan.test.ts` has no phase tests (grep count 0).
- **Every motion is relative to the node's seated pose and ends at it.** Nothing represents a node resting at a non-seated pose between steps. The player assumes every node sits at its GLB pose except while the active step's clip is playing (`motion.ts:18-21`, `462-463`; `AssemblyPlayer.tsx:1327-1366`).
- **"One node, one step" is not enforced in the DB.** The ERP even has an "Add a copy" (duplicate) path. The viewer's visibility map only counts the *first* step that names a node (`AssemblyPlayer.tsx:1046-1061`). The planner's re-motion mode drops a node that appears in a second group (`pipeline2.rs:1771-1776`).

---

## 1. Data model

### `assemblyInstructionStep` (created in `packages/database/supabase/migrations/20260610151942_assembly-instructions.sql:41-81`)
- `componentNodeIds TEXT[] NOT NULL DEFAULT '{}'` (`:60`): the leaf `nodeId`s this step installs.
- `motion JSONB NOT NULL DEFAULT '{"type": "none"}'` (`:61`). It holds one Motion object for the whole step, not one per component (see section 2).
- `camera JSONB` (`:62`), `fastener JSONB` (`:64`), `warnings JSONB` (`:65`; holds `{flagged, blockedBy, needsSupport}`, written at `production.service.ts:9182-9192`).
- `planConfidence` `high|low|manual` (`:66`), `durationSeconds` (`:67`).
- **`explode JSONB` (`:63`) is an unused column.** The design spec calls it "per-step exploded offsets" (`.ai/specs/2026-07-04-animated-work-instructions-design.md:148`). No app or viewer code reads or writes it. A grep for `explode` in apps/packages only hits the generated types (`packages/database/src/types.ts:3614`) and MCP tool metadata.
- **`parentStepId` (`:44`, FK `:76`) is unused.** The design spec says "subassembly grouping" (`design.md:144`). Its only use is being remapped during version copy (`production.service.ts:6701-6703`).
- Later additions:
  - `status` Todo/Review/Done (`20260610183947_assembly-step-status.sql:5-8`).
  - `buildWave INTEGER` (`20260712180545_assembly-step-build-wave.sql:6`).
  - `rootStepId` for version lineage (`20260910093006_assembly-step-lineage.sql:12-14`).
  - `hiddenComponentNodeIds TEXT[] NOT NULL DEFAULT '{}'` (`20260925063121_assembly-step-hidden-components.sql:5-6`). A BEFORE INSERT/UPDATE trigger removes the step's own `componentNodeIds` from that list and dedupes it (`:11-29`).
- Version copy spreads `...rest` from `select("*")` (`production.service.ts:6693-6711`), so any new column is copied automatically.
- Child tables keyed by `stepId`: `assemblyInstructionStepMaterial` (`20260610191824_assembly-step-requirements.sql:149-...`), `assemblyInstructionStepSlide` and `assemblyInstructionStepTool` (`20260721170301_assembly-step-slides-and-tools.sql:13-44, 93-118`).

### `assemblyUnit` (`20260611134652_assembly-editor-parity.sql:1-38`)
- Columns: `modelUploadId`, `name`, `componentNodeIds TEXT[]`, `itemId`. It is scoped to the model upload, not the instruction.
- Header comment (`:1-6`): "sets of model leaf nodes the motion planner treats as one rigid body". It is a user override on top of auto derivation. "A subassembly with its own build steps is simply the child item's own instruction — no child link here."
- `sourceGroupId` (`20260712163840_assembly-unit-source-group.sql:7-11`): NULL means the user authored it. `swarm:<host>` means the planner detected it. UNIQUE `(modelUploadId, sourceGroupId)`.
- How units are used:
  1. **Planning input.** `loadPlanUnits` sends only units with more than one member as `options.units` (`packages/jobs/src/inngest/functions/tasks/plan-units.ts:19-47`). The planner merges them into one rigid body (`crates/planner/src/steps.rs:190-200`, `pipeline2.rs:1259-1290`). They come back as `plan.groups[gid]` with one shared motion (`packages/viewer/src/plan.ts:66-74`), and `buildAssemblyStepGroups` gives each group exactly one step (`plan.ts:306-309`, `317-326`).
  2. **Materialized.** Detected swarm groups become `assemblyUnit` rows at step generation (`production.service.ts:9083-9144`).
  3. **Step titles.** If a step's components exactly match a unit's set, `describeStep` titles it "Add <unit name>" (`packages/viewer/src/describe.ts:28-35, 62-82`). Generation writes the planner group `name`, falling back to `describeStep` (`production.service.ts:9146-9173`).
  4. **Kept in sync on reassign.** Moving a part into a step that installs a unit also adds it to that unit (`production.service.ts:7382-7451`).
- A unit is a *planning* concept only: "one rigid body, one step". Nothing gives a unit a separate build sequence or pose.

## 2. Motion type and playback

### Type (`packages/viewer/src/types.ts:13-65`)
- `linear {direction, distance}`, `L {segments[]}`, `helix {axis, origin, pitch, turns, approach}`, `path {keyframes[{t, position, quaternion}]}`, `none`.
- The doc comment says it describes the INSERTION; "the viewer derives removal (the reverse) and start poses from it" (`:56-59`).
- linear, L and helix are **relative translations/screws anchored at the seated pose**.
- `path` keyframes are **absolute world poses**, and "the last keyframe must equal the component's final (seated) pose" (`:40-49`).
- The ERP Zod schema mirrors this (`apps/erp/app/modules/production/production.models.ts:1218-1258`).
- The Rust planner only emits `None | Linear | L`, all pure translation (`crates/planner/src/types.rs:188-210`).

### One motion per step, applied to each node
- `buildStepClip` loops over `step.componentNodeIds`. For each node it takes the node's CURRENT world pose as the `basePose` (the seated pose) and builds keyframes from the one shared `step.motion` (`motion.ts:467-497`).
- Its doc says: "Nodes are assumed to currently sit at their final (seated) pose" (`motion.ts:462-463`).
- Start pose:
  - linear: `seated - direction*distance` (`motion.ts:305-317`).
  - L: walks backward from the seated pose through the segments (`:319-348`).
  - helix: unscrews and retracts from the seated pose (`:350-414`).
  - path: the absolute keyframes, which must end at that node's seated pose or the code throws (`:416-452`).
- **(inference)** A `path` motion on a step with more than one node throws for every node except one, because each node has a different seated pose while the step has one keyframe list. This is why the editor writes relative `linear`/`L` "so it applies to every component in a rigid-group step" (`motion.ts:599-606`).
- It does not use the `explode` column or any stored offset. The only "start pose" is the one the motion implies.

### Display-only changes in the player (`AssemblyPlayer.tsx:318-380`)
- **Fallback motion.** Steps saved with `none` that are neither flagged nor the first step get an AABB fallback via `displayMotionForStep` (`motion.ts:129-150`). Its obstacle world is the set of nodes installed by earlier steps, at their seated poses (`AssemblyPlayer.tsx:335-340`).
- **Travel is clamped.** `naturalizeMotion` limits linear/L travel to at most `min(3*diag+5, 0.35*assemblyDiagonal)`, with a floor for small parts (`motion.ts:152-234`). **A long staging-to-seat translation stored as linear/L would be shortened on screen.**

### Timeline and pose at a given time
- Each step's segment length comes from `stepTimelineSeconds`: `durationSeconds`, otherwise motion duration plus a 0.6 s hold, otherwise 2 s for `none` (`motion.ts:68-76`, `51-60`). Start times are cumulative (`AssemblyPlayer.tsx:382-398`).
- Only the ACTIVE step has a clip. The effect saves the seated transforms of the active step's nodes, plays the clip `LoopOnce` with clamp, and restores the seated transforms on cleanup (`AssemblyPlayer.tsx:1291-1377`). Scrubbing inside a step sets `action.time` (`:1384-1397`).
- A static selection snaps to the end of the clip, i.e. seated (`:1347-1356`).
- Every node outside the active step keeps its GLB seated transform. Nothing else in the player writes `node.position`/`quaternion`: the only writes are the restore at `:1363-1365`; `:1552` and `:1653` move the camera.
- Flagged steps, or `none` steps after the first, fade in at the seated pose (`:1403-1487`).
- Camera framing uses `insertionStartOffset(step.motion)` to include the travel start in the view (`:1752-1771`, `2221-2247`).

## 3. Motion planning

- **Who runs it.** ERP route `apps/erp/app/routes/x+/assembly+/$id.plan.rerun.tsx:14-185` triggers Inngest `assembly-plan` (`packages/jobs/src/inngest/functions/tasks/assembly-plan.ts:34-320`). That calls the Rust assembler service `/plan` (`apps/assembler`, planner crate `crates/planner`). The result is `plan.json` in storage (`assembly-plan.ts:156`, `257-283`).
- **Modes:**
  - **Fresh.** Used when there are no steps, or when `fresh=1` ("Regenerate"). It derives both the order and the motions. Inputs are `options.units` (`assembly-plan.ts:178-187, 227-231`). Steps are then built by `generateAssemblyStepsFromPlan` (`production.service.ts:9001-9256`) through `buildAssemblyStepGroups` (`plan.ts:274-458`).
  - **Re-motion.** Used when steps exist. It keeps the order. The input is `options.sequence`, the ordered array of each step's `componentNodeIds` (`assembly-plan.ts:158-177`). `plan_fixed_sequence` merges each group into one rigid body and plans its insertion against the union of EARLIER groups at their SEATED poses (`crates/planner/src/pipeline2.rs:1746-1920`). `updateAssemblyStepMotionsFromPlan` then writes `motion`, `camera` (unless it was set manually), `warnings` and `planConfidence` back, matching steps to groups by component-set equality and skipping Done steps (`packages/jobs/.../update-step-motions.ts:30-137`).
- **Inputs:** the STEP source URL, `units` or `sequence`, and deflection/clearance/tolerance options (`apps/assembler/src/actions/plan.rs:171-215`; `crates/planner/src/steps.rs:171-185`).
- **Outputs:** plan.json with `sequence`, `components{motion, confidence, blockedBy, tier, groupId, mergedInto, wave, viewDirection}`, `groups`, `contacts` and `warnings` (`plan.ts:12-83`). `contacts` is written at `steps.rs:400-420`. The comment there says it is "Used by the step grouping's floater fold + phase partition" (`:404-405`).
- **Can it plan from an arbitrary (staging) start pose? No, as built.**
  - It is "assembly-by-disassembly": it searches removal directions from the seated state (`greedy.rs:120-140`, `353-363`) and returns an insertion that ends at the seat.
  - It never takes a start/target pose as input. The motion enum can only express translations from the seat (`types.rs:188-194`).
  - Re-motion's obstacle world is "all earlier groups, seated" (`pipeline2.rs:1846-1871`). A sub-assembly built at a staging spot would be wrongly counted as an obstacle at its seated location. **(inference)**
  - Re-motion also drops a node that appears in a later group: "already belongs to an earlier group; dropped" (`pipeline2.rs:1771-1776`). So a join step that repeats the bearing and circlip nodes would plan as empty or partial.
  - A pure-translation staging offset *could* be written as a relative `L` motion (seat → offset). But the planner would not choose that offset, and the player's `naturalizeMotion` would clamp it (see section 2).

## 4. Per-step visibility

- `stepIndexByNode` maps each node, **including its descendants**, to "the first step that installs it". It only claims a node if it isn't already claimed (`AssemblyPlayer.tsx:1040-1061`). **This is the main place that assumes one step per node.** A node repeated on a later step is still treated as installed from its first step.
- `visualForComponent(stepIndex, activeStepIndex, futureMode, installedMode)` returns `solid|ghost|hidden` for earlier steps, `active` for the current step, and follows `futureMode` for later or never-installed nodes (`visibility.ts:59-90`).
- `occluderWeight` must agree with it (`visibility.ts:92-124`; rule stated in `packages/viewer/AGENTS.md:20`).
- Named views: build = installed solid, future hidden; focus = installed ghost, future hidden; full = everything solid (`visibility.ts:18-39`).
- The visual pass (`AssemblyPlayer.tsx:1083-1252`):
  1. Resets every node.
  2. Applies `visualForComponent` per node in `stepIndexByNode`.
  3. Treats unassigned leaves as future.
  4. Applies external highlight, then focus/isolate, then **hides everything in `hiddenSet`**, then selection, then drill-ghost.
- `hiddenSet = stepHiddenNodeIds(activeStep)`: the active step's list minus its own components (`visibility.ts:126-138`, `AssemblyPlayer.tsx:1017`). The DB trigger enforces the same rule (see section 1).
- Other places that assume a node's pose/presence comes from a single step:
  - `displaySteps` builds `present` by adding each step's nodes cumulatively, all seated (`AssemblyPlayer.tsx:335-340`).
  - The re-motion obstacle world (section 3).
  - `buildStepClip` assumes a seated start (`motion.ts:462-463`).
- Stale docs:
  - `packages/viewer/AGENTS.md:21` still says the view table must contain an `isolate` view. `visibility.ts:25-27` says Isolate was dropped.
  - The contracts spec says "Parts in no step are always shown solid" (`.ai/specs/2026-07-04-animated-work-instructions-contracts.md` §5, end). The code treats them as future (`visibility.ts:61-65`).

## 5. ERP authoring UI

- **Route** `apps/erp/app/routes/x+/assembly+/$id.tsx`.
  - Add-mode: `onStartAddComponents` (`:404-408`). Picks union into the active step's draft and autosave through `saveComponentNodeIds`, which posts to `$id.steps.components.$stepId.tsx` (`:269-283`, `363-384`).
  - Remove: `:415-430`.
  - Hidden list: `onSetHiddenComponents` posts to `$id.steps.hidden.$stepId.tsx` (`:285-320`).
  - `viewerSteps = steps.map(toViewerStep)` (`:432-442`).
  - The player receives `componentPickerActive={isAddingComponents}` (`:635-664`).
- **Components autosave** (`$id.steps.components.$stepId.tsx:15-77`) calls `updateAssemblyStepComponents` (`production.service.ts:7266-7284`) and then syncs materials for newly added nodes. It does not check whether a node is already on another step.
- **BOM-tree assign** (`AssemblyBomTree.tsx:397-459`, modal `:966-1013`, "Move or add a copy?"):
  - `duplicate` ("Add a copy") vs `move` ("Move here").
  - Service `reassignAssemblyStepComponents` (`production.service.ts:7308-7453`): "`duplicate` unions them onto the target only (a component may live on several steps)" (`:7308-7313`).
  - `move` strips the nodes from other steps and deletes any step that becomes empty (`:7354-7369`).
  - **So multi-step membership is already allowed and authored. It just has no motion or pose meaning.**
- **New step** (`AssemblyInstructionExplorer.tsx:502-529`) seeds `componentNodeIds` from the selection plus `synthesizeFallbackMotion` against all nodes already on steps.
- **Motion editing** (`$id.steps.motion.$stepId.tsx:16-64` calls `updateAssemblyStepMotion`, `production.service.ts:7232-7261`). The drag editor turns waypoints into relative linear/L (`motion.ts:560-639`), anchored at the centroid of the seated nodes (`AssemblyPlayer.tsx:988-1013`, `2178-2182`).
- **Units:**
  - Created from the BOM tree through "Plan as one component" (`AssemblyBomTree.tsx:1255-1300`, posts to `path.to.newAssemblyUnit`; route `$id.units.new.tsx`).
  - Edit and delete: `:1329-1409`. The toast after editing says "Subassembly updated — re-run motion planning to apply the change" (`:960-962`).
  - The tree shows units as virtual rows (`:142-150`, `1018-1170`). `stepUsage` lists every step that uses a component group, so it already handles more than one step (`:279-300`).
- **Step titles:** `describeStep(toViewerStep(step), graphIndex, namedUnits)` (`AssemblyBomTree.tsx:384-395`; Explorer `:407-437`).
- **Materials:** seeded per step from that step's `componentNodeIds` (`deriveAssemblyStepMaterialSeeds`, `production.service.ts:7754-7795`). **(inference)** If a join step repeats the bearing and circlip nodes, it would seed those BOM items again, so the same parts would be consumed twice in BOP/MES.

## 6. MES viewing

- `apps/mes/app/services/operations.service.ts:608-651` (`getAssemblyPlaybackByOperationId`) selects these step fields: `id, title, instructionText, componentNodeIds, hiddenComponentNodeIds, motion, camera, fastener, durationSeconds, warnings`, ordered by `sortOrder` (`:637-643`).
- `apps/mes/app/components/AssemblyView.tsx`:
  - The local `AssemblyPlayback` type (`:190-205`) and a separate MES `toViewerStep` (`:210-230`). It duplicates the ERP mapper and sets `flagged` from `warnings.flagged`. It has no `phase` or `explode`.
  - `playbackIndex` maps the BOP step to its instruction step through `assemblyInstructionStepId` (`:1082-1088`).
  - The player runs with `autoPlay loop readOnly hideCaption` (`:1975-1989`).
- Any new step field must be added in three places: the MES select, the MES type/mapper, and the ERP `toViewerStep` (`production.service.ts:9263-9284`).

## 7. Existing specs, plans and docs

- `.ai/specs/2026-07-04-animated-work-instructions-contracts.md`: shared contracts. Covers nodeId, graph.json, the `/plan` API, plan.json groups, the Motion JSON (§4, `:295+`) and viewer step shape plus playback semantics (§5, `:333+`).
- `.ai/specs/2026-07-04-animated-work-instructions-design.md`: original design. Promises "exploded views", the `explode JSONB` "per-step exploded offsets", and `parentStepId` "subassembly grouping" (`:7, 88, 144-148`).
- `.ai/specs/2026-07-04-assembly-editor-requirements.md` §4: parity wish-list. A subassembly would be a child instruction whose parent step animates it "as a unit … from their exploded state to their final pose" (`:166-174`). The `assemblyGroup` proposal (`:176-183`) was later superseded.
- `.ai/plans/2026-07-06-bom-driven-subassembly-planning.md`: D0 collapses the grouping taxonomy into one Subassembly unit. It drops `childInstructionId` ("parent never spawns or links child instructions; it just consumes the subassembly as one part") and rescopes the unit to `modelUploadId` (`:40-58`).
- `.ai/plans/2026-07-06-order-preserving-motion-replan.md`: the design behind re-motion with fixed order and forward collision.
- `.ai/plans/2026-07-06-assembly-visual-motion-camera-editor.md`: drag-waypoint motion editor plus per-step camera.
- `.ai/plans/2026-07-05-assembly-planner-v3.md`, `2026-07-06-planner-secured-last-and-gaskets.md`, `2026-07-06-planner-regression-fix.md`, `2026-07-09-assembly-sequence-connectivity.md`: planner ordering. Connectivity covers floating islands and base selection.
- `.ai/specs/2026-09-17-viewer-installed-component-visibility.md` plus its plan: `installedMode` and named views.
- `.ai/specs/2026-09-25-assembly-step-hidden-components.md` plus its plan: the per-step `hiddenComponentNodeIds` on this branch.
- `.ai/specs/2026-07-15-assembler-deployment.md`, `2026-07-15-assembler-model-pipeline.md`, `.ai/plans/2026-07-10-geometry-service-rust-rewrite.md`: assembler service infrastructure.
- `.ai/research/animated-work-instructions.md` §5: suggests exploding along the planner's removal directions with offset = bbox clearance × a constant, and flags auto-explode patents US 9,053,258 and US 7,295,201 (`:85-93`).
- `.ai/lessons.md`:
  - "Assembly viewer camera + animation principles" (`:79`): constant zoom, exaggerate small parts, manual motion as an escape hatch.
  - "Never fabricate a best-effort motion through geometry" (`:144`).
  - "Verify what actually rendered before root-causing a bad motion report" (`:222`).
- `packages/viewer/AGENTS.md`:
  - Lists `phase` as part of Step and says `./steps` exports `assignStepPhases` (`:9, 16, 46`).
  - "Ask first" before changing `types.ts` or `CURRENT_PLAN_VERSION` (`:23-26`).
  - Never fabricate motion for flagged parts, and never let overlapping corridors animate at the same time (`:28-32`).
- `apps/erp/app/modules/production/AGENTS.md`:
  - Assembly Instructions concept and versioning (`:15`).
  - Table list (`:73-77`).
  - Service docs for `generateAssemblyStepsFromPlan` (floater fold, `:110`) and unit derivation (`:113`).
  - No mention of phases or staging.
- `apps/assembler/AGENTS.md`: planner crate layout.
- I found no spec or plan about sub-assembly *staging*, *phases*, or moving a node more than once. A grep for "staged off / off to the side / assignStepPhases / subassembly phase" across `.ai` and `docs` returned nothing.

## 8. Existing notions of multi-step nodes, pose, offset, staging and explode

- **Staging/phase:** `plan.ts:146-153, 180-185, 452-456, 460-610` and `types.ts:117-123`. Computed but not persisted or played (see TL;DR). Details of the algorithm (`plan.ts:471-480`):
  - It replays the sequence and tracks which bodies connect to the base (the first group).
  - A group that touches nothing already placed starts a staged "island".
  - A later group touching both the base and an island is that island's `join` step.
  - Islands that touch each other merge.
  - Ids are `p0..pn` in "staging lane order" (`:594`).
  - It needs `plan.contacts`, which only v3 plans have.
- **Floater fold:** `plan.ts:390-447`. Today's workaround for detached parts: fold a floating group into the next step that touches it, so they install as one rigid step.
- **Node on more than one step:** allowed by the DB and the BOM-tree "Add a copy" (section 5). The player ignores repeat appearances for visibility (first step wins, `AssemblyPlayer.tsx:1049`). **(inference)** A repeat step would still build a clip for it and fly it in again from motion-start to seated, because `buildStepClip` animates every node in `componentNodeIds` (`motion.ts:480-553`). The planner's fixed-sequence mode drops repeats (`pipeline2.rs:1771-1776`).
- **Pose:** the only pose type is `Pose {position, quaternion}` inside keyframe math (`motion.ts:24-28`). The seated pose always comes from the GLB node transform. No non-seated rest pose is stored anywhere.
- **Offset:** only as the start offset implied by a motion (`AssemblyPlayer.tsx:2221-2247`) and as naturalize clamping (`motion.ts:170-234`).
- **Explode/exploded:** the `explode JSONB` column (unused) and documentation only (design spec, requirements §4.3, research §5).
- **`parentStepId`:** exists but unused, apart from the version-copy remap.

## Implications for "sub-assembly staging" (inference, for design)

- The cheapest foundation is to persist the computed `phase` and wire it through. `phase` is already in the viewer contract. It needs a column (or a JSON field), then `generateAssemblyStepsFromPlan`, both `toViewerStep` mappers, and the MES select.
- The player needs a per-node "rest transform per step" concept: a staging offset applied to nodes whose phase hasn't joined yet. It also needs a join-step clip that moves the whole staged cluster from its staging transform to seated, and `naturalizeMotion` must not clamp that move. The unused `explode` column is a natural home for a per-phase or per-step offset.
- `stepIndexByNode`'s "first step wins" rule works for visibility if the join step re-lists the nodes. The clip, the materials seeding and the re-motion planner all need a way to tell "moves an already-built group" apart from "installs".
- Within a phase, the planner's collision world would need the staged cluster in its own frame. Otherwise, re-plan the cluster's internal steps against only that cluster. `plan_fixed_sequence` currently treats every earlier group as seated.

---

## 9. How other tools handle sub-assemblies (web, 2026-09-28)

- **SOLIDWORKS Composer.** Each step is a saved view. Parts ("actors") can be moved freely away from their mated positions and hidden or shown. Authors often build the sequence backwards from the finished product, so a sub-assembly can be shown built aside and then inserted. Sources: [Javelin: panel instructions](https://www.javelin-tech.com/blog/2024/09/panel-assembly-instructions-using-solidworks-electrical-composer/), [Javelin: Composer sub-assemblies](https://www.javelin-tech.com/blog/2019/07/solidworks-composer-sub-assemblies/).
- **LEGO / BrickLink Studio.** A submodel's steps go in a callout box ("build this separately"), and the finished submodel is attached in a main step. Sources: [Rebrickable Studio guide](https://rebrickable.com/help/studio-instructions/), [Open L-Gauge guide](https://open-l-gauge.eu/making-building-instructions-in-studio/).
- **Dozuki.** The sub-assembly is its own guide, embedded in the main guide as a "prerequisite". Source: [Dozuki prerequisite guides](https://www.dozuki.com/blog/feature-spotlight-prerequisite-guides).
- **Cortona3D RapidAuthor.** Recommends splitting large assemblies into logical sub-assemblies, and sometimes showing where a sub-assembly fits in the whole. Source: [Cortona3D best practices](https://www.cortona3d.com/en/working-large-assemblies-best-practices).
- **Siemens Teamcenter Easy Plan.** Sub-assemblies are lines in the manufacturing BOM, each with its own process steps. Source: [Siemens Easy Plan](https://www.siemens.com/en-gb/products/tecnomatix/offerings/teamcenter-easy-plan/).

**Takeaway.** Composer and LEGO both use the same pattern inside ONE sequence: build the group aside, then place it as a whole in a later step. We adopt that pattern. Dozuki's separate-guide model already matches Carbon's "child item has its own instruction" design, so it needs no new work.
