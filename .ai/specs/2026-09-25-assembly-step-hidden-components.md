# Assembly instructions: hide components per step

- **Status:** Draft, awaiting review
- **Date:** 2026-09-25
- **Branch:** `feat/asembly-view-isolation`
- **Need:** hide chosen parts on any step. The ERP controls what is visible, and MES plays it back.

## Summary

An author can hide chosen parts on a chosen step of an assembly instruction.
Typical parts to hide are tooling, fixtures, or already-installed parts that
block the view of the work. The choice is saved on the step. The 3D player
honours it in the ERP editor and on the MES shop-floor screen. MES only shows it
and has no controls.

Today the ERP has eye buttons in the Components panel, but that hiding is
temporary browser state. It is lost on step change or reload and never reaches
MES. This is why the earlier "isolate" release missed the ask.

## Goals

- Hide any part on any single step, and have it saved.
- The shop floor (MES) sees exactly what the author set, with no toggles.
- The default stays the same: everything built so far is visible. Hiding is a
  per-step list of exceptions.

## Non-goals

- Sub-assembly grouping ("build the hub aside, then install it as one block").
  That gets its own spec.
- Hiding that carries forward to later steps. Each step's list covers only that
  step (see Q1).
- A temporary, unsaved hide. Selecting a component in the Components panel
  still isolates it for a quick look (`focusedNodeIds`), but nothing is saved.
- Any control in MES.
- Translating the Components panel's existing, untouched English strings. Only
  copy that this work adds or changes is made translatable.

## Design

### Data model

One new column on `assemblyInstructionStep`:

| Column | Type | Notes |
|---|---|---|
| `hiddenComponentNodeIds` | `TEXT[] NOT NULL DEFAULT '{}'` | Leaf nodeIds from `graph.json`, same id space as `componentNodeIds`. |

- A new timestamped migration named `…_assembly-step-hidden-components.sql`,
  adding the column only. Existing RLS on the table already covers it, and no new policy is
  needed.
- Regenerate database types after the migration.
- **Versioning:** `copyAssemblyInstructionAsVersion` spreads every step column
  into the new version (`production.service.ts:6696`), so hidden lists carry
  over with no change.
- **Regenerate steps:** "Regenerate" deletes and recreates steps from the plan,
  so hidden lists are dropped with them. This matches how every other authored
  step field behaves on regenerate.
- **Job operation sync:** no change. MES playback reads
  `assemblyInstructionStep` directly (`apps/mes/app/services/operations.service.ts:638`),
  not the `jobOperationStep` copies.

### Rules

1. A step's hidden list never contains its own installed parts (Q3).
   - Enforced once, in the database: a BEFORE INSERT/UPDATE trigger
     (`assembly_step_strip_own_hidden_components`) strips the step's
     `componentNodeIds` from `hiddenComponentNodeIds` and dedupes it on every
     write. That covers hide/show saves, adding or reassigning components,
     version copies and regenerate, with no service code involved.
   - The player also ignores any hidden id that belongs to the active step. That
     guards stale data.
2. Hidden applies only while that step is active (Q1). During full playback,
   the part disappears when the step starts and comes back on the next step.
3. Hidden parts are not drawn at all. They are not ghosted.
4. The temporary focus (select a component in the Components panel to see it
   alone) is unchanged and never saved. The named Isolate view was removed.

### Viewer (`@carbon/viewer`)

- `AssemblyStep` gains `hiddenComponentNodeIds?: string[]`.
- In the scene's visibility pass, the explicit-hide pass hides
  `activeStep.hiddenComponentNodeIds` minus the active step's own
  `componentNodeIds`. The pass runs last, after step-state visuals, highlight,
  and focus. The effect depends on the active step, so playback updates per
  step automatically.
- The player has no separate `hiddenNodeIds` prop; the step's list is the only
  input.

### Services and routes (ERP)

- `updateAssemblyStepHiddenComponents(client, { id, assemblyInstructionId, hiddenComponentNodeIds, updatedBy })`
  updates only the hidden column, matching the step by id AND instruction so a
  route can't reach a step of another instruction. The trigger strips the
  step's own parts and dedupes.
- Validator `assemblyInstructionStepHiddenComponentsValidator`, with a JSON
  string array like the components validator.
- Route `x+/assembly+/$id.steps.hidden.$stepId.tsx` is a POST autosave that
  requires `update: "production"`. It mirrors the components autosave route.
  Path helper `path.to.assemblyInstructionStepHiddenComponents(id, stepId)`.
- `updateAssemblyStepComponents` and `reassignAssemblyStepComponents` drop newly
  added parts from the target step's hidden list, in the same write or
  transaction.
- `toViewerStep` in both ERP and MES maps `hiddenComponentNodeIds`. The MES
  playback query adds the column to its select.

### UI: ERP editor

**Components panel** (`AssemblyBomTree`) (Q2):
- The row eye, the group eye, "Hide selected components", and "Show all hidden
  components" now edit the **selected step's saved** hidden list. The panel's
  local `hiddenNodeIds` state is removed, and eye state is read from the
  selected step.
- The eye is disabled, with a tooltip, when:
  - the row is one of the selected step's own parts: "Installed on this step,
    so it can't be hidden here."
  - no step is selected: "Select a step to hide parts on it."
  - the instruction is read-only, meaning `isDisabled`: it isn't a Draft, or
    the user lacks production update rights (`$id.tsx:214`). The eye shows
    state but can't be clicked.
- For a group eye whose instances are partly the step's own parts, only the
  other instances are toggled.
- Every change autosaves immediately, like the components autosave, using a
  draft state for instant feedback.

**Step Details tab** (`AssemblyInstructionProperties`) (Q4):
- A new "Hidden on this step" box sits under the Components box. It uses the
  same grouped-row layout (`groupComponentNodeIds`), shows an eye on each row to
  show that part again, and has a "Show all" button.
- When the list is empty, it reads: "Nothing hidden. Use the eye in the
  Components panel to hide parts on this step."
- Clicking a row selects that part, matching the Components list.

**Player in the editor:** receives the steps, including their hidden lists, and
no longer gets the global temporary set. Selecting a step shows its hidden
parts gone. Playback applies each step's list in turn.

**Copy:** every new or changed string uses Lingui (`t` or `<Trans>`).

### UI: MES

No new UI. The playback query and `toViewerStep` carry the hidden lists, and the
player applies them.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Where to store | Array column on `assemblyInstructionStep` | Same shape and id space as `componentNodeIds`. Copies with versions for free. MES already reads this row. |
| Separate table? | No | No per-row attributes are needed. An array matches existing idiom and avoids joins in the MES query. |
| Hide scope | This step only | Q1 answer. |
| Hide visual | Not drawn, never ghosted | The ask is to remove clutter. Ghosting still clutters and costs rendering. |
| Own parts | Server strips them, UI disables them, player ignores them | Q3 answer. Three layers, so old or edited data can't make a step animate an invisible part. |
| Temporary hide | Removed, eye now saves | Q2 answer. Selecting a component still focuses it for a quick look. |
| Save style | Immediate autosave route per field | Matches the components and motion autosave routes. |
| Regenerate | Drops hidden lists with the steps | Consistent with every other authored step field. |

## Acceptance criteria

1. On step 3, the author hides the "Press Tool" part from the Components panel.
   After a reload, step 3 still has the part hidden, and steps 2 and 4 still
   show it.
2. On step 3, the eye on the part that step 3 installs is disabled, and its
   tooltip explains why. A hand-crafted POST that includes that part saves a
   list without it.
3. The step Details tab lists "Press Tool" under "Hidden on this step".
   Clicking its eye shows the part again and removes it from the list after a
   reload.
4. Pressing Play in the ERP editor hides "Press Tool" while step 3 plays, and it
   reappears when step 4 starts.
5. An MES operator on a job operation linked to this instruction sees "Press
   Tool" hidden on step 3 and nowhere else, with no hide control anywhere on
   the MES screen.
6. Adding a hidden part to step 3's components removes it from step 3's hidden
   list, and it is visible and animating on step 3.
7. Creating a new version of the instruction keeps step 3's hidden list on the
   copied step.
8. With no step selected, the Components panel eye is disabled with the "Select
   a step" tooltip.
9. Every new string appears in the Lingui catalog after extraction.
10. Typecheck and lint pass for `@carbon/viewer`, `erp`, and `mes`.

## Research

N/A. This is an internal authoring feature. Prior art in this codebase covers
the pattern: the per-step `componentNodeIds` authoring and autosave, and the
viewer's existing explicit-hide pass. For product prior art, CAD tools like
Onshape and SolidWorks offer per-view or per-configuration visibility. The
closest match here is the per-step "exception list".

## Open questions (resolved)

- [x] Q1. Does a part hidden on step 5 stay hidden on later steps? **Answer:**
  No. It is hidden only on that step, and each step has its own list.
- [x] Q2. What do the existing temporary eye buttons in the Components panel do
  now? **Answer:** They save to the selected step. There is one kind of
  hiding, and isolate covers quick looks.
- [x] Q3. Can a step hide the parts it installs itself? **Answer:** No. It is
  blocked in the UI and stripped on save.
- [x] Q4. How does the author see and undo a step's hidden parts?
  **Answer:** A "Hidden on this step" list in the step's Details tab, with an
  eye per row and "Show all", plus eye state in the Components panel.

## Changelog

- 2026-09-25: first draft, with Q1 to Q4 answered by the user.
- 2026-09-25: after review, the own-parts rule moved into a DB trigger; hidden-list rows are no longer clickable; the player's unused `hiddenNodeIds` prop was removed.
- 2026-09-28: aligned with the implementation after PR review: the named Isolate view is gone (temporary focus remains), the player takes no `hiddenNodeIds` prop, and the hidden-list update is scoped to its instruction.
