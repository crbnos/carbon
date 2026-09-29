# Assembly instructions

> Step-by-step 3D build guides for a made part, authored in the ERP from its CAD model and played to operators on the shop floor.

An assembly instruction is a 3D build guide for one made part. It breaks the part's CAD model into ordered steps, each naming the components it installs and how they move into place, and plays them to the operator in the shop floor's `docs/reference/mes`.

You author instructions under **Production → Assemblies**. Pressing **"Add Assembly Instruction"** asks for a single field, the **Part**: a part made in-house that already has a 3D model on its **Model** tab (a STEP file). Carbon converts the model for 3D viewing if it needs to, opens the editor, and starts working out draft steps straight away.

## Versions and status

  - **Draft**: The only editable status. A new instruction, and every new version, starts here.
  - **Published**: The active version. Job operations that use this instruction follow it.
  - **Archived**: A version that was active before a newer one took over. Read-only.

Each version is its own copy of the instruction. On a published instruction, **"New Version"** makes an editable draft copy of it, steps and all. On a draft, **"Make Active"** publishes it and archives the version that was active before.

Every job operation that points at another version of this instruction is moved to the new one and has its steps synced, as long as the operation isn't done or canceled and its job isn't locked. Operations on finished jobs keep the steps they were built with.

## Steps

A new instruction starts empty. **"Generate Steps"** runs the motion planner over the model: it works out a build order and a collision-free path for each part, which usually takes one to three minutes. **"Add step manually"** starts from a blank step instead. Once steps exist, **"Add Step"** in the list footer adds another, and dragging a row by its handle reorders the list.

Each step carries a status you change from the icon at the end of its row:

  - **Todo**: A step you added by hand that nobody has checked yet.
  - **Review**: A step the motion planner generated. Check that it reads and plays correctly.
  - **Done**: An author has checked the step.

The planner menu next to **"Add Step"** can recompute the motions in the current order (**"Run Motion Planning"**) or replace every step from a fresh plan (**"Regenerate Steps"**). Regenerating is refused while any step was added by hand or is marked "Done", so checked work is never overwritten.

Two icons in the step list flag steps worth a second look. A warning triangle means the planner found no collision-free path, so the step's parts fade in at their final position instead of moving in. A hand means a part may tip once placed, so the step may need a fixture or a second person.

## Step details

The **Details** tab holds what the operator reads at this step:

  - **Type**: What the operator records: a plain **Task**, a value, a measurement with a minimum and maximum, a checkbox, a list choice, a timestamp, a person, a file, or an inspection.
  - **Title**: Leave it blank to use a title built from the step's components, such as "Add Bearing (×2)".
  - **Instruction**: Free text for the operator. Type `@` to mention a part from the item's bill of materials.
  - **Required**: The operator must record this step before the operation can be completed.

These fields save with **"Save"** at the bottom of the panel (or ⌘/Ctrl+Enter). Everything else on the step saves the moment you change it: components, hidden parts, playback settings, status, materials, tools, and slides.

## Components and hidden parts

**Components** lists what the step installs. Press **"Add"**, click parts in the 3D view (shift-click adds several), then **"Done Adding"**. Remove a part with the ✕ on its row.

Some steps are hard to see because of parts that are in the way, such as a fixture or a cover fitted earlier. The eye on a row in the **Components** tab hides that part on the selected step only. The step's **Hidden on this step** list shows what is hidden and brings parts back. A step can never hide its own components, and hidden parts are hidden for operators too.

## Playback settings

The **Playback** box sets how the step plays:

  - **Motion**: "Automatic" uses the path the planner found. **"Edit Path"** shows the path as red waypoints in the 3D view: drag one to reshape it, double-click the path to add one, and press Delete to remove the selected one. "No clear path" means the planner found none; hover the header note to see which parts block it.
  - **Camera**: "Automatic" frames the step's parts on its own. **"Use Current View"** saves the angle you are looking from; **"Clear"** goes back to automatic.
  - **Build off to the side**: Builds this step beside the model and carries the group in at a later step (below).

### Building a group off to the side

Some parts are put together on their own first and then fitted as one piece: a hub gets its bearing, circlip and brake disc on the bench before the whole hub goes onto the trailing arm. Build off to the side models that.

On each step of the group, set **"Build off to the side"** to the step where the group goes in, such as **"Joins step 8"**. During playback those steps build the group next to the model, and at the join step the finished group glides across and fits into place. The join step lists the steps it brings in, and each built-aside step shows a small stacked-boxes icon in the step list.

The first step is the base and is always built in place. A join step can't itself be built off to the side, and a step can only join a later step. If a reorder puts a step after its join step, the link is cleared and the step builds in place again. **"Regenerate Steps"** removes these settings too.

## Materials, tools, and slides

The **BOM** tab links the step to what it consumes: parts from the item's bill of materials and the tools it needs. **"Match BOM"** in the **Components** tab matches 3D components to bill-of-materials items and fills in each step's materials for you. The **Slides** tab adds photos, PDFs, or extra 3D models the operator sees on this step.

## On jobs and the shop floor

An **Assembly** `docs/reference/jobs` picks its instruction on the item's bill of process. A job copies the instruction's steps when it is created. To bring a later edit into an existing job, use **"Sync Assembly Steps"** on the job operation: steps that came from the instruction are updated or removed to match, and steps someone wrote by hand on the job are kept.

On the shop floor the operation opens the `docs/reference/mes`, which plays the same steps, hidden parts, and groups built off to the side.

## Related

  - MES How operators play an instruction step by step, and the Build, Focus, and Full views.
  - Jobs The work orders whose Assembly operations use an instruction.
  - Methods The bill of materials that step materials are picked from.

## Internals, exact strings, and troubleshooting

- Routes: list `/x/production/assemblies`, editor `/x/assembly/:id`. Tables: `assemblyInstruction` (row per version, grouped by `rootInstructionId ?? id`), `assemblyInstructionStep`, `assemblyInstructionStepMaterial`, `assemblyInstructionStepSlide`, `assemblyInstructionStepTool`.
- Editing is Draft-only in the UI (`isDisabled = status !== "Draft" || !can("update","production")`). "Make Active" shows on any non-Published version, Archived included.
- Step status DB meaning: Todo = new manual step, Review = planner-generated, Done = author-validated. New steps default to Todo with `planConfidence` "manual".
- Build off to the side is stored as `assemblyInstructionStep.parentStepId` (the join step). Rule shared by ERP and playback: `joinTargets` in `packages/viewer/src/staging.ts`. Staged groups park on +X or +Z (whichever is most side-on to the saved cameras), 0.25 × the assembly diagonal away, and glide in over 1.2 s.
- Hidden parts: `assemblyInstructionStep.hiddenComponentNodeIds`; a DB trigger strips the step's own components on every write.
- Flash strings: "Step not found"; "That step can't be the join step for this one"; "Failed to update hidden components"; "Failed to update step status"; "Failed to update assembly instruction step"; "Steps already exist — delete them before generating from the plan"; "Some steps are locked — cannot regenerate"; "The geometry service is unavailable — motion planning can't run right now."; "Motion planning is already running"; "This instruction has no processed model"; "The model must finish converting before planning"; "This job is locked — steps can't be synced to it"; "The selected item has no 3D model. Upload a STEP file on the item's Model tab first."; "Made assembly instruction active"; "Failed to make assembly instruction active".
- Planner offline: "The geometry service is offline — motion planning is unavailable right now." Generate is disabled until it is back.
