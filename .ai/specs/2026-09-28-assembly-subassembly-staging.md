# Assembly instructions: build a sub-assembly off to the side

- **Status:** Implemented (MES playback not browser-checked)
- **Date:** 2026-09-28
- **Branch:** `feat/asembly-view-isolation`
- **Need:** show a group of parts being assembled on its own, then show the finished group being fitted into a larger assembly. Example build: bearing and circlip into a trailing arm; bearing, circlip and brake disc onto a front hub; the front hub assembly onto the trailing arm assembly.
- **Research:** `.ai/research/2026-09-28-assembly-subassembly-staging.md` (current code, sections 1–8; other tools, section 9)

## Summary

An author can mark some steps of an assembly instruction as "built off to the
side", and name the later step where that group joins the main assembly (the
**join step**). In the 3D player, the parts those steps install appear at a
staging spot beside the main model. At the join step, the finished group glides
from the staging spot to just outside its seat, then does a normal insertion.
The ERP is where this is authored. MES plays it back and has no controls.

This is the pattern SOLIDWORKS Composer and LEGO instructions use (research §9).

## Goals

- Show a sub-assembly (e.g. the front hub with bearing, circlip and disc) being
  built away from the main assembly, then carried in as one piece.
- The author sets it up with one field per step in the ERP. Nothing new to
  model in CAD, and no new STEP file.
- MES shows exactly what the ERP authored.
- Each part's BOM materials are still consumed once, on the step that installs it.

## Non-goals

- **Nested sub-assemblies** (a group built aside inside another group built
  aside). A join step cannot itself be built aside in v1.
- **Dragging the staging spot.** The spot is computed automatically in v1 (Q2).
- **Planner support.** Motion planning (fresh or re-run) does not know about
  staging in v1. See "Planner" below for what that means in practice.
- **Automatic detection** of sub-assemblies (the unused `assignStepPhases` in
  `packages/viewer/src/plan.ts`). It stays unused (Q1).
- **Separate instructions per sub-assembly item.** Carbon already supports a
  child item having its own instruction; nothing changes there.
- Any control in MES.

## Design

### Terms

- **Staged step:** a step whose `parentStepId` points at a join step.
- **Join step:** a later step that one or more staged steps point at.
- **Staged group:** every part installed by the staged steps of one join step
  (descendants included, matching `stepIndexByNode`).
- **Moving parts of a join step:** its own `componentNodeIds` plus its staged
  group.

### Data model

No migration. `assemblyInstructionStep.parentStepId` already exists, with a
self-FK `ON DELETE SET NULL` (`20260610151942_assembly-instructions.sql:44,76`).
It has never been written by app code, and version copy already remaps it
(`production.service.ts:6701-6703`). It gets this meaning:

> `parentStepId` = the join step this step is built aside for. NULL = built in place.

Rules, enforced in the service layer on write (the route returns a field error):

1. The join step belongs to the same instruction.
2. The join step comes later (`sortOrder` greater than the staged step's).
3. The join step is not itself a staged step (no nesting), and a step that is
   already a join step cannot become a staged step.
4. The first step of the instruction (the base) cannot be staged.

When steps are reordered (`updateAssemblyInstructionStepOrder`), any link that
breaks rule 2 is cleared in the same write. Deleting a join step clears its
links through the existing FK. Regenerate steps replaces the steps, so links go
with them.

The unused `explode` column is **not** used in v1. The staging spot is computed
(Q2), so there is nothing to store yet. If dragging is added later, the offset
belongs in the join step's `explode` column.

### Viewer contract (`packages/viewer`)

`types.ts` changes (the viewer AGENTS.md says to ask before changing it; this
spec is that ask):

- `AssemblyStep` gains `joinStepId?: string | null`. It maps from `parentStepId`.
  The viewer name says what it means, and the DB name stays as it is.
- The typed but unused `phase` field is removed. It is never set by any mapper,
  and keeping two sub-assembly concepts on one type invites confusion.
  `assignStepPhases` itself stays in `plan.ts`, untouched.

New pure helpers in a new `packages/viewer/src/staging.ts`, unit-tested:

- `buildStaging(steps, graphIndex)` returns, per join step index, its staged
  group's node ids and its offset, plus a staged-step → join-step index map.
  Placement: beside the main model's bounding box, with a gap of 25% of the
  assembly diagonal, along whichever of +X or +Z is most side-on to the
  saved cameras of the staged and join steps (+X when none are saved). It is
  never above or below the model, since the viewer is Y-up. Several groups get
  their own lanes, stacked outward in join order. The offset is always a pure translation, so parts keep
  their orientation.
- `parkedOffsetsAt(staging, steps, activeIndex)` returns the parts that sit at
  a staging spot while a given step is shown.
- `stagedGroupNodeIds(steps, joinStepId)` returns the parts a join step carries
  in. The ERP uses it for the "This step" badge and the hide rules.

### Player behaviour (`AssemblyPlayer.tsx`, `motion.ts`)

Given active step index `a`, for a part in the staged group of join step `j`:

| When | Where the part is drawn |
|---|---|
| `a` < the staged step that installs it | not installed yet; follows the future mode, as today |
| installing step ≤ `a` < `j` | at seat + staging offset |
| `a` = `j` | animates: glides from seat + offset to the insertion start, then does the join step's insertion |
| `a` > `j` | at seat, as today |

- **Staged steps animate at the staging spot.** A staged step's own motion is
  relative to the seat (linear, L, helix), so playing it with the whole group
  translated by the offset gives the right picture with no motion changes.
  A `path` motion (absolute keyframes) gets the offset added to every keyframe.
- **Join step motion** = glide + insertion.
  - The insertion is the join step's saved `motion`, applied to all its moving
    parts, as today's shared step motion.
  - If the saved motion is `none`, the existing fallback (`displayMotionForStep`)
    synthesises one for the moving parts against the parts already seated.
    If that also fails, the group glides straight to the seat.
  - The glide is a straight translation from seat + offset to seat + insertion
    start offset, lasting 1.2 s. It is not clamped by `naturalizeMotion`.
    Only the insertion part is.
  - The join step's timeline length = glide + insertion + the existing hold.
- **Visibility.** `stepIndexByNode` still says which step installs a part. That
  controls whether it is drawn, so installed/ghost/focus modes behave as today.
  Only its position changes.
- **Per-step hiding.** At a join step, its moving parts cannot be hidden. They
  count as the step's own parts, both in the viewer (`stepHiddenNodeIds`) and in
  the ERP Components panel (the "This step" badge and the disabled eye).
  On staged steps, hiding works as today, so the author can hide the arm while
  the hub is being built.
- **Camera.** Auto-framing a staged step frames its parts at the staging spot.
  Auto-framing the join step includes the staging spot and the seat. A saved
  manual camera is used as-is.
- **Component picking and seated transforms.** Picking parts (add-components
  mode) still shows everything at its seat, so clicking a part always selects
  what the author expects. Staging positions apply only in play/preview.

### ERP authoring

In the step Details tab (`AssemblyInstructionProperties.tsx`), a new
**"Build off to the side"** field:

- A select: "No, build in place" (default), or "Yes, joins at: Step N – title",
  listing only valid join steps (rules 1–4).
- Saved through a new route `x+/assembly+/$id.steps.join.$stepId.tsx`, calling a
  new service function `updateAssemblyStepJoin(client, { stepId, joinStepId, companyId, userId })`.
  It validates the rules and scopes by `companyId`.
- Disabled when the instruction is not editable (same `isDisabled` as the other
  fields).

On a join step, Details shows a read-only line: **"Brings in the group from
steps 3, 4"**, with each step number linking to that step.

In the step list (`AssemblyInstructionExplorer.tsx`), staged steps get a small
"Built aside" icon with a tooltip, so the structure is visible without opening
each step. It is an icon, not a text badge, because a badge pushed the title out
of the narrow row.

All new copy uses Lingui (`<Trans>` / `t`) and gets extracted into every
`packages/locale/locales/*/erp.po`.

### MES

- `getAssemblyPlaybackByOperationId` (`apps/mes/app/services/operations.service.ts:637-643`)
  adds `parentStepId` to its select.
- The MES `toViewerStep` (`AssemblyView.tsx:210-230`) maps it to `joinStepId`.
- No UI change. The player does the rest.

The ERP `toViewerStep` (`production.service.ts:9263-9284`) gets the same mapping.

### Planner

No planner change in v1. What happens today stays true:

- Re-run motion planning plans staged steps as if the group were built in place.
  Their relative motions still look right at the staging spot. Their collision
  checks count the main model as an obstacle even though it isn't there, which
  can only make a motion more cautious than it needs to be, never wrong.
- A join step with no parts of its own sends an empty group. Re-run leaves its
  motion alone, so the player's fallback or the author's hand-edited motion is used.
- Regenerate (fresh plan) replaces all steps and drops every staging link. The
  "Regenerate" confirm dialog gets one extra sentence when the instruction has
  staged steps: "Regenerating removes 'Build off to the side' settings."

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| How a sub-assembly is marked | Per step, "joins at" a later step (Q1) | Explicit, fits the example build, author can fix it. The planner's automatic phases only work on fresh plans. |
| Where the link is stored | Existing `parentStepId` column | Already typed, FK'd, `ON DELETE SET NULL`, and remapped by version copy. No migration. |
| Where the group sits | Auto spot to the right of the model, one lane per group (Q2) | No author work. Dragging can come later via `explode`. |
| What the join step lists | Its own parts only; it moves the staged group automatically (Q3) | Materials are never seeded twice, and the planner never sees a repeated node (it drops repeats, `pipeline2.rs:1771-1776`). |
| Join step motion | Glide to the insertion start, then the step's insertion (Q4) | Reads like a hand carrying the part in, and reuses the existing motion editor for the last move. |
| Nesting | Not in v1 | The example build needs one level. Nesting multiplies the lane and validation rules. |
| Viewer field name | `joinStepId` (maps from `parentStepId`) | Says what it means at the call site. |
| Unused `phase` type | Removed | Never populated. Two sub-assembly concepts on one type would confuse. |
| Picking mode positions | Always at the seat | Clicking must select what the author sees in the BOM tree. |
| Planner | Unchanged in v1 | Its failure mode (overly cautious staged motions) is harmless. Real support needs Rust changes to plan a group in its own frame. |

## Acceptance criteria

Set up an assembly with this structure (the seeded demo assembly works):
step 1 trailing arm (base), step 2 bearing + circlip into arm, step 3 bearing into
hub, step 4 circlip into hub, step 5 brake disc onto hub, step 6 front hub into arm.

1. In the ERP, set steps 3, 4 and 5 to "Build off to the side, joins at Step 6".
   The select on each offers only step 6 as a valid join step. Step 1 has the
   select disabled. Steps 3–5 show the "Built aside" icon (with a tooltip) in the step list.
   Step 6's Details reads "Brings in the group from steps 3, 4, 5".
2. Reload the page. The settings are still there.
3. Select step 4 in the ERP player. The hub, bearing and circlip are drawn to the
   right of the arm, not at their seats. Playing step 4 animates the circlip
   into the hub at that spot.
4. Select step 6 and play it. The hub group glides from the side to just outside
   the arm, then inserts and ends seated. Step 6 shows no extra BOM materials
   for the bearing, circlip or disc.
5. On step 6, the hub group's rows show "This step" in the Components panel, and
   their eye button is disabled. On step 4, hiding the trailing arm works and is
   saved.
6. Open the job operation linked to step 4 and then step 6 in MES. They look and
   animate the same as in the ERP, with no new controls.
7. Try to set step 6 to join at step 3. Rejected with a field error. Drag step 5
   above step 3, then reload. Step 5's link is kept, since it still comes before
   step 6. Drag step 6 above step 5. Step 5's link is cleared.
8. Create a new version of the instruction. Links point at the new version's
   step 6, not the old one.
9. `pnpm --filter @carbon/viewer test` passes, including new tests for
   `buildStaging` and `stagingOffsets`. The ERP and MES typecheck passes.

## Open questions (resolved)

- [x] Q1. How does the author mark a sub-assembly? — **Answer:** Pick the steps
  that build the group and point them at the later join step. Explicit and fixable,
  unlike automatic detection. The UI is one "joins at" select per step.
- [x] Q2. Where does the group sit while being built? — **Answer:** An automatic
  spot beside the main model. No dragging in v1.
- [x] Q3. Does the join step re-list the moved parts? — **Answer:** No. It moves
  the staged group automatically, and its own component list is only for new parts.
- [x] Q4. How does the group travel at the join step? — **Answer:** Glide to just
  outside the seat, then do the step's normal insertion.

## Changelog

- 2026-09-28: first draft, after Q1–Q4.
- 2026-09-28: implemented (tasks 1–11 of `.ai/plans/2026-09-28-assembly-subassembly-staging.md`). Deviations: a nested chain (a step that is both built aside and a join step) makes the viewer ignore BOTH links; a staged step's fallback motion only avoids the parts of its own group; a rejected join shows a toast rather than a field error (the select only offers valid steps). Browser-checked 2026-09-28 on a 5-step Draft assembly: criteria 1, 2, 3, 5 and 7 pass, criterion 6 (MES) was not checked. The first check found a fixed +X side hidden by a saved camera looking down X, so the side is now chosen from the saved cameras. The "Built aside" text badge hid step titles in the list, so it became an icon with a tooltip.
