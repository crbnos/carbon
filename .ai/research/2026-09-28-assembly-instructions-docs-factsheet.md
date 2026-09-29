# Fact sheet: "Assembly instructions" docs reference page

Source: working tree of `feat/asembly-view-isolation` (2026-09-28). Every fact is cited to a file and line. Paths are shortened as follows:
- `R/` = `apps/erp/app/routes/x+/assembly+/`
- `UI/` = `apps/erp/app/modules/production/ui/Assemblies/`
- `SVC` = `apps/erp/app/modules/production/production.service.ts`
- `MOD` = `apps/erp/app/modules/production/production.models.ts`
- `V/` = `packages/viewer/src/`

---

## 1. Where it lives in the ERP

### Nav and routes
- Nav: Production module, group **Work Instructions**, entry **Assemblies** (icon `LuStepForward`, `role: "employee"`). See `apps/erp/app/modules/production/ui/useProductionSubmodules.tsx:80-86`. The same group also holds Inspection Plans and Procedures (`:89-99`).
- List URL is `/x/production/assemblies` (`apps/erp/app/utils/path.ts:386`). New is `/x/production/assemblies/new` (`path.ts:1505`). The editor is `/x/assembly/:id` (`path.ts:365`).
- The list loader requires `view: "production"` and `role: "employee"` (`apps/erp/app/routes/x+/production+/assemblies.tsx:18-21`). Breadcrumb: "Assemblies" (`assemblies.tsx:13`).

### List page (`UI/AssemblyInstructionsTable.tsx`)
- Table title: "Assembly Instructions" (`:286`). Primary action: New "Assembly Instruction" (`:279-282`), shown only with create:production (`:278`).
- Columns, in order:
  - **Name**: links to the editor, with a "Version N" subtitle (`:78-94`).
  - **Status**: an `AssemblyInstructionStatus` badge (`:95-104`).
  - **Item**: the readable id with revision, linked to the item details (`:105-129`).
  - **Model**: the model name, with "N component(s)" underneath (`:136-159`).
  - **Processing**: Success is green, Failed red, Queued/Processing yellow, Idle gray (`:51-65`, `:160-171`).
  - **Updated** (`:172-184`).
  - **Versions**: a "N Version(s)" badge with a hover card listing each "Version N" and its status (`:185-234`).
- An export-only "Item Name" column appears only in the CSV (`:130-135`).
- Row menu: "Edit Instruction" and "Delete Instruction" (`:243-264`). The delete confirm text is "Are you sure you want to delete this assembly instruction?" (`:301`).
- The list reads the `assemblyInstructions` view, one row per version group at its latest version, with `versions` rolled up (`apps/erp/app/modules/production/AGENTS.md:15`, migration `20260730153412_assembly-instructions-view.sql`). I did not open that migration; this claim relies on AGENTS.md only.

### Creating an instruction (`UI/AssemblyInstructionForm.tsx`, `apps/erp/app/routes/x+/production+/assemblies.new.tsx`)
- Modal title: "New Assembly Instruction" (`Form:131`).
- It has exactly **one visible field**, **Part**: an `Item` picker restricted to `type="Part"` and `replenishmentSystem="Make"` (`Form:174-182`). The only other field is a hidden `id` (`Form:134`). Submit button: "Save" (`Form:199`).
- Model status messages under the field:
  - "Checking for a 3D model…" (`:184-186`)
  - "Model: {name} (N components)" (`:188-192`, label built at `:89-92`)
  - Info, convertible: "This model will be converted for assembly instructions when you save. This can take a minute." (`:136-143`)
  - Info, processing: "Model conversion is in progress. You can save now — the model will appear once conversion finishes." (`:145-152`)
  - Warning, failed: "Previous model conversion failed: {error}. Saving will retry." or "Previous model conversion failed. Saving will retry." (`:154-162`)
  - Warning, none: "This item has no 3D model. Upload a STEP file on the item's Model tab first." (`:164-171`)
- Save is disabled while the state is idle, loading or none, or without create:production (`:110-112`).
- Server side:
  - The name comes from the item name, falling back to "Assembly" (`assemblies.new.tsx:113`).
  - The model comes from an explicit `modelUploadId` when that is usable, otherwise from the item's CAD (`:55-79`).
  - Refused with no model, and refused when the model needs conversion but the geometry service is down (`:81-110`).
  - Conversion is lazy: `assembly-convert` is triggered only for convertible/failed models (`:133-138`). A converted model with no plan pre-creates a plan job and triggers `assembly-plan` (`:139-167`).
  - It redirects to the editor with `?autogen=1` whenever a model exists (`:173-177`). The explorer then submits Generate once (`UI/AssemblyInstructionExplorer.tsx:317-339`).
- Convertible formats are `.step`, `.stp` and `.xbf`, with an optional `.zst` wrapper (`MOD:1353-1355`).
- The pre-fill is `?itemId=` (`assemblies.new.tsx:29`).

### Model conversion and the viewer area (`R/$id.tsx`)
- While converting, `ModelConvertProgress` shows three phases: "Reading the CAD file", "Building the 3D geometry", "Preparing the viewer" (`UI/ModelConvertProgress.tsx:13-17`). While queued it shows "Waiting for a worker…" (`:115`), plus a **Cancel** button (`:123-137`).
- On failure the page shows "Couldn't prepare this model", then the error or "Something went wrong converting the CAD file for 3D viewing.", and a **Try again** button that posts to `model/convert` (`R/$id.tsx:685-710`).
- Otherwise it shows "Model not ready yet" / "This model hasn't been prepared for 3D viewing. It'll appear here once processing starts." (`R/$id.tsx:712-720`).
- **Re-convert Model** is in the header "More options" menu (`UI/AssemblyInstructionHeader.tsx:142-156`). It posts to `R/$id.model.invalidate.tsx`, which drops the cached motion plans and the conversion artifacts, then triggers `assembly-convert` (`:9-14`, `:42-53`).
  - Success flash: "Model cache invalidated; re-converting from the source file" (`:59`).

### Header (`UI/AssemblyInstructionHeader.tsx`)
- The name is editable inline, and only while the instruction is Draft and you have update rights (`:105-117`, `:64`). The rename saves on blur (`:74-84`).
- Other header items:
  - Status badge (`:118`).
  - "More options" menu: **View Item Master**, **Re-convert Model**, **Delete Instruction** (`:119-169`).
  - "Version N" badge and "By you · edited {relative}" (`:170-184`).
  - Explorer and Properties panel toggles (`:99-104`, `:226-231`).

### Editor layout
- The layout has three panels: `explorer` (left), `content` (the 3D viewer) and `properties` (right) (`R/$id.tsx:586-755`).
- Left panel tabs: **Steps** / **Components** (`UI/AssemblyInstructionExplorer.tsx:553-560`). Steps has a "Search steps" box (`:566-575`). An empty search shows `No steps match "{q}"` (`:704-708`).
- Right panel header: "Step {n} of {m}", the step status badge, the title, "# component(s)" and, when flagged, "No clear path" (`UI/AssemblyInstructionProperties.tsx:174-203`).
- Right panel tabs: **Details** / **BOM** / **Slides** (`:211-222`).
- With no step selected: "No step selected" / "Pick a step from the list to edit its details, components, and materials." (`:283-296`).
- A "Planning motion…" pill with **Cancel** floats over the viewer while a plan job runs (`R/$id.tsx:613-633`).

---

## 2. Instruction statuses and versions

- Enum `assemblyInstructionStatuses = ["Draft", "Published", "Archived"]` (`MOD:1201-1205`). The DB enum `assemblyInstructionStatus` defaults to Draft (`packages/database/supabase/migrations/20260610151942_assembly-instructions.sql:4-5,16`).
- Badge colors: Draft gray, Published green, Archived red (`UI/AssemblyInstructionStatus.tsx:12-17`).
- **Only Draft is editable in the UI.** The editor sets `isDisabled = instruction.status !== "Draft" || !permissions.can("update","production")` (`R/$id.tsx:218-219`), and that flag drives every panel (`:592`, `:661`, `:733`). The header rename is Draft-only too (`Header:110-116`).
  - I found no server-side Draft guard: no `"Draft"` check in the `R/` routes, the assembly service functions, or the migrations I searched (see Could not verify).
- **Versions** is row-per-version:
  - Siblings share a root, `rootInstructionId ?? id` (`SVC:6602-6623`).
  - The header's `VersionMenu` shows "V{n} {name}" plus each version's status (`Header:187-207`). The trigger label is "Versions" (`apps/erp/app/components/VersionMenu.tsx:45`), and the menu has a "New Version" item (`VersionMenu.tsx:73`).
- **New Version**:
  - The button shows only when the instruction is Published and you have create rights (`Header:208-217`).
  - It posts `copyFromId` to `R/$id.version.new.tsx` (`Header:86-94`). That calls `copyAssemblyInstructionAsVersion`, which creates a new **Draft** with `version = max+1`, the same root, deep-copied steps (`parentStepId` remapped, `rootStepId` lineage), and each step's materials, slides and tools (`SVC:6625-6758`).
  - The route redirects to the new version (`R/$id.version.new.tsx:46`).
- **Make Active**:
  - The button shows whenever the status is **not Published**, so on Draft and Archived alike (`Header:208-225`).
  - Confirm: title "Make Active", text "Make version {n} active? This publishes it, archives the currently active version, and repoints in-flight job operations to it." (`Header:247-256`).
- **What activation does** (`activateAssemblyInstructionVersion`, `SVC:6760-6933`):
  - It archives every other sibling that is Published (`:6800-6813`).
  - It publishes the target and sets `publishedAt` (`:6815-6827`).
  - It repoints `jobOperation.assemblyInstructionId` from other versions in the group to this one. This applies only to operations whose status is not Done/Canceled, on jobs that are not locked (`:6829-6855`, `JOB_LOCKED_STATUSES` at `:6846`).
  - It migrates each job step's `assemblyInstructionStepId` marker from the old step to the new step by lineage, in one SQL transaction (`:6857-6904`).
  - It re-syncs each repointed operation with `syncAssemblyInstructionToOperation`. A failure is logged per operation and does not abort the activation (`:6906-6928`).
  - Method operations are left untouched (`:6764-6765`).
- `updateAssemblyInstructionStatus` no longer bumps the version (`SVC:6584-6587`). Its route `R/$id.status.tsx` exists, but no UI component calls `path.to.assemblyInstructionStatus`. The only reference is `path.ts:368`.
- Delete: `deleteAssemblyInstruction` also drops the model's cached plan (`SVC:6935-6960`).

---

## 3. Steps

- **Generate Steps**. The empty state appears when there are no steps and you have update rights (`Explorer:618-700`).
  - Headings: "No steps yet", "Solving assembly motions", or "Couldn't generate steps" (`:637-643`).
  - Body, in the same three cases:
    - "Generate draft steps with motions solved from the model, or add one yourself." when a plan exists.
    - "Run the motion planner over the model to create draft steps, or add one yourself." when none does.
    - "Reading the model's geometry to work out the build order. Usually 1–3 minutes." while solving (`:644-653`).
  - An "{m:ss} elapsed" timer shows while solving (`:654-658`).
  - Buttons: "Generate Steps", which becomes "Retry Generate Steps" after a failure (`:666-688`), and **"Add step manually"** (`:689-697`).
  - Planning is lazy. The first click with no plan triggers `assembly-plan` and returns `planning:true`. The tab then polls and re-submits Generate when the plan lands, and that intent survives a remount via sessionStorage (`Explorer:158-190`, `:341-370`; route `R/$id.steps.generate.tsx:62-114`). Realtime on `assemblyPlanJob` pushes completion (`Explorer:192-198`).
  - What generation creates (`generateAssemblyStepsFromPlan`, `SVC:9224-9270`):
    - Generated steps get `status: "Review"` (`:9266`).
    - The title is persisted via the unit name or `describeStep` (`:9231-9242`).
    - `warnings.flagged`/`blockedBy` are set when the planner found blockers, and `needsSupport` when a part may tip (`:9251-9261`).
    - A `buildWave` is stored (`:9264`), and the camera is set to the planner hint `{source:"plan",direction}` (`:9248-9250`).
  - Refusals: "steps-exist", and "steps-locked" when any step is manual (`planConfidence`) or Done (`SVC:9096-9114`).
- **Steps footer** (shown when steps exist): an **Add Step** button (`Explorer:712-725`) and a sparkles planner menu (`:726-779`).
  - **Run Motion Planning**, "Recompute motions, keep step order" (`:752-763`). Confirm: "Run motion planning?" / "Recomputes how each step's components move into place, using the current step order and avoiding collisions with components from earlier steps. Steps you've marked Done are left as-is." with a **Run** button (`:889-928`).
  - **Regenerate Steps**, "Replace all steps from the latest plan" (`:764-776`). Confirm: "Regenerate steps?" / "Replaces all existing steps with fresh drafts from the latest motion plan — titles, descriptions, and other edits on the current steps are lost. Refused if any step is manually authored or marked Done." When any step is built aside it adds "Regenerating removes "Build off to the side" settings." (`:821-887`).
- **Add Step**:
  - With components selected, the new step is seeded with them plus a synthesized fallback motion. Otherwise it is an empty process-only step with motion "none" (`Explorer:517-544`).
  - The title is left blank on purpose (`:522-524`).
  - New steps default to DB status `Todo` and `planConfidence 'manual'` (migrations `20260610183947_assembly-step-status.sql:2-8`, `20260610151942_assembly-instructions.sql:66`).
- **Reorder**: drag the grip handle ("Drag handle", `Explorer:1094-1105`). Framer `Reorder` is disabled when the instruction is not editable or while searching (`:584-590`, `:505-506`). The new order saves on a **2500 ms debounce** (`:492-503`).
  - Double-clicking a row plays the step (tooltip "Double-click to play this step", `:1084-1086`).
- **Step statuses**:
  - `assemblyStepStatuses = ["Todo","Review","Done"]` (`MOD:1209`).
  - DB meaning: Todo = new manual step, Review = planner-generated and not yet validated, Done = author-validated (`20260610183947_assembly-step-status.sql:2-4`).
  - Icons: Todo is `LuCircleDashed` muted, Review is `LuClock` yellow, Done is `LuCircleCheck` emerald (`UI/AssemblyStepStatus.tsx:43-47`).
  - **Changing status**: click the icon on the step row to open a radio dropdown (`Explorer:984-1017`). It saves optimistically to `R/$id.steps.status.$stepId.tsx` (`:949-964`). On non-editable instructions it shows the icon only, with a tooltip (`:966-982`). The properties header shows a status pill (`Properties:183`).
- **Row badges**: a type icon (non-Task types only), the title, flag icons, "×{componentCount}", the status control, and a "More options" menu with **Delete Step** (`Explorer:1106-1175`). The delete confirm reads "Are you sure you want to delete the step: {title}? This cannot be undone." (`:810-820`).
- **Details tab form** (`Properties StepForm`):
  - **Type**: a select over `procedureStepType` = Task, Value, Measurement, Checkbox, Timestamp, Person, List, File, Inspection (`apps/erp/app/modules/shared/shared.models.ts:171-181`; `Properties:479-490`).
  - **Title**: the placeholder is the derived title, or "Untitled step" (`:491-495`, derivation at `:434-445`).
    - `describeStep`: an explicit title wins. A step matching a named unit reads "Add {unit}". Otherwise it is "Add" (one group), "Assemble" (several) or "Install" (fastener only), followed by "{name} (×n)" segments (`V/describe.ts:19-52`).
  - **Instruction**: a rich-text Editor with **@-mentions of the item's BOM parts** (`Properties:496-509`, mention list at `:152-165`). The plain `instructionText` is derived server-side (`SVC:7148-7155`).
  - **Measurement** adds "Unit of Measure", "Minimum" and "Maximum" (`Properties:511-536`). **List** adds "List Options" (`:537-539`).
    - Validation messages: "Unit of measure is required", "List options are required", "Maximum value must be greater than or equal to minimum value" (`MOD:1419-1451`).
  - **Required** toggle, "Operator must record this step" (`Properties:540-544`).
  - **Save** is sticky at the bottom (`:650-658`) and posts to `R/$id.steps.$stepId.tsx`. It saves Type, Title, Instruction, Required, UoM/min/max and List, plus the current `componentNodeIds` (`:453-477`).
  - **Autosaved fields** (these do not use Save):

    | What | Route | Where |
    |---|---|---|
    | components add/remove | `steps/components` | `R/$id.tsx:273-287` |
    | hidden list | `steps/hidden` | `:289-300` |
    | motion path (400 ms debounce) and camera | `steps/motion` | `:519-575` |
    | build-aside link | `steps/join` | `UI/AssemblyStepJoin.tsx:70-78` |
    | status | `steps/status` | see above |
    | materials, tools, slides | their own routes | `AssemblyStepMaterials.tsx:105-145`, `AssemblyStepTools.tsx:60-93`, `AssemblyStepSlides.tsx:71-78` |
    | order | debounced | see Reorder |

---

## 4. Components in a step

- The Details tab has a "Components · N" list with **Add**, which toggles to **Done Adding** (`Properties:706-729`).
  - Hint while adding: "Click components in the viewer to add them. Shift-click adds several." (`:730-737`). The empty state is "No components yet" (`:738-741`).
  - Clicking a row selects that group, and the ✕ ("Remove {name} from this step") removes it (`:749-786`).
- Add-mode:
  - Start clears the selection (`R/$id.tsx:424-428`).
  - Picks in the viewer are unioned onto the step and autosaved (`:383-404`).
  - Plain selection never changes a step (`:250-253`).
  - Newly added nodes pull in their mapped BOM materials (`R/$id.steps.components.$stepId.tsx:60-74`).
- **Hidden on this step** (`Properties:796-905`):
  - Heading: "Hidden on this step", with glossary help (`:844-851`). It shows "None" when the list is empty (`:852-855`).
  - Each row's eye-off button ("Show {name}") un-hides that part (`:889-898`). The code comment reads "Parts are hidden from the Components panel eye; here they can only be shown again" (`:796`).
  - **Show All** saves immediately and can be undone for 4000 ms via **Hide Again**, which shows a draining bar (`:809-839`, `:907`, `:909-937`).
- Hiding happens in the Components tab (`UI/AssemblyBomTree.tsx`):
  - Each row has an eye toggle, "Hide {label}" / "Show {label}" (`:1694-1727`).
  - A toolbar button and the context menu offer "Hide selected on this step" (`:699-714`, `:904-910`), plus "Show all hidden on this step" (`:715-730`, `:911-917`).
  - Hiding is disabled with the tooltip "Select a step to hide parts on it." (no step selected) or "Installed on this step, so it can't be hidden here." (the step's own parts) (`:535-552`). `canHide = hasSelectedStep && !isDisabled` (`:214`).
  - The step's own parts show an "In this step" icon (`:1661-1668`).
- **A step never hides its own parts**:
  - A DB trigger `assembly_step_strip_own_hidden_components` strips them and dedupes the list on every insert or update of either array (`packages/database/supabase/migrations/20260925063121_assembly-step-hidden-components.sql:8-29`).
  - The UI mirrors this for in-flight drafts (`R/$id.tsx:322-331`).
  - A join step also "owns" the group built aside for it, so those parts can't be hidden on the join step (`R/$id.tsx:314-321`).
- **Where hidden parts are respected**: the shared player hides `stepHiddenNodeIds(activeStep)` on every render, even when a part is highlighted (`V/AssemblyPlayer.tsx:1084-1086`, `:1268-1273`). The list is re-derived per step, so playback hides and restores each step's list in turn (`:1084-1085`). `stepHiddenNodeIds` also drops the step's own ids as a guard (`V/visibility.ts:126-138`).
  - The ERP passes `hiddenComponentNodeIds` through `toViewerStep` (`SVC:9343`).
  - The MES maps `hiddenComponentNodeIds` too (`apps/mes/app/components/AssemblyView.tsx:198,220`; select at `apps/mes/app/services/operations.service.ts:640`).
- Components tab extras:
  - **Match BOM** (tooltip "Match components to BOM items") (`AssemblyBomTree.tsx:602-621`).
  - "Add selection to a step" / "Add {n} to step" / "Remove from steps" (`:623-683`).
  - "Plan as one component" (`:685-698`).
  - Sort toggle and "Search components" (`:731-761`).
  - Summary line: "{n} components · {m} mapped to BOM" (`:595-599`).

---

## 5. Playback box (Details tab, heading "Playback", `Properties:565-648`)

- **Motion row** (glossary `assembly-step-motion`):
  - The value reads:
    - "No clear path" when the planner flagged the step.
    - "Drag the red waypoints in the viewer" while editing.
    - "Add components first" when the step has none.
    - Otherwise "Automatic" (`:570-590`).
  - The button is **Edit Path**, which becomes **Done Editing Path**. It is disabled with no components (`:591-606`).
  - Editor: a red path with draggable sphere waypoints. The last waypoint is the locked seated pose. Double-click the path to insert a waypoint; select one and press Delete to remove it. Edits save as a relative `linear`/`L` motion, pure translation (`V/MotionPathEditor.tsx:9-22`). The motion autosaves with a 400 ms debounce (`R/$id.tsx:551-558`).
- **Flagged steps** ("No collision-free path"):
  - Generated flagged steps store motion "none" plus `warnings.flagged` (`SVC:9251-9256`).
  - The player fades those parts in at the seated pose over `FADE_SECONDS = 1.2` instead of animating (`V/AssemblyPlayer.tsx:901-902`, `:1517-1546`). The same applies to any non-first step whose motion resolved to "none".
  - A join step glides in instead of fading (`:1536-1542`).
  - While planning runs, fallback motions are suppressed so "none" steps fade in (`R/$id.tsx:221-225`, `:671`; `V/AssemblyPlayer.tsx:150-156`).
  - The "No clear path" tooltip is "Blocked by {names}" (`Properties:318-336`). The model comment reads "a manual motion overrides the flag" (`Properties:302-305`).
- **Camera row** (glossary `assembly-step-camera`):
  - The value is "Saved view" or "Automatic" (`Properties:608-617`).
  - Buttons: **Use Current View** captures the live pose, and **Clear** (shown only when a view is saved) sets the camera to null (`:618-637`; `R/$id.tsx:560-575`).
  - Error toast: "The model isn't ready yet" (`R/$id.tsx:564`).
  - Planner-generated steps store a plan view-direction hint, not a saved pose (`SVC:9245-9250`; `MOD:1260-1273`).
    - Could not verify: whether a plan hint counts as "Saved view" in this row. `hasCamera = step.camera != null` (`Properties:430`), so a plan hint would also read "Saved view". That is my inference from the code, not something I ran.
- **Build off to the side** (`UI/AssemblyStepJoin.tsx`, glossary `assembly-step-build-aside`):
  - The trigger shows "No" or "Joins step {n}" (`:68`). Options are "No, build in place" and "Joins step {n}: {title}" (`:120-131`).
  - Locked states: the base step shows "No, it's the base" (`:81-86`). A join step shows "Brings in steps" followed by clickable step numbers that select those steps (`:87-105`).
  - When the instruction is not editable, the control is plain text (`:106-107`). It autosaves to `R/$id.steps.join.$stepId.tsx` (`:70-78`).
  - **Rules** (`V/staging.ts:80-102`, `joinTargets`):
    - The base step (index 0) can't be staged (`locked: "base"`).
    - A step that other steps join into can't itself be staged (`locked: "join"`).
    - Targets are only **later** steps that are **not themselves built aside**, so there is one level only.
    - The same rule is enforced server-side (`SVC:7309-7345`) with the flash "That step can't be the join step for this one" (`:7343`) or "Step not found" (`:7335`).
    - Bad stored links are ignored by playback and play as built in place (`V/staging.ts:9-11`, `:104-119`).
  - **Playback**:
    - Staged steps build beside the model at a staging spot (`V/AssemblyPlayer.tsx:1386-1400`, `parkedOffsetsAt` at `V/staging.ts:203-219`).
    - The side is +X or +Z, never above or below, whichever is most side-on to the saved cameras of the steps involved. +X wins on a tie or when no views are saved (`V/staging.ts:41-51`, `:168-177`).
    - The gap is 0.25 × the assembly diagonal, and multiple groups use lanes (`:16-17`, `:161-194`).
    - At the join step the whole group glides in over `STAGING_GLIDE_SECONDS = 1.2` (`V/staging.ts:14-15`; `V/AssemblyPlayer.tsx:1412-1421`). The glide time is added to the join step's timeline unless the step has an explicit duration (`:438-451`).
    - A staged step's fallback motion sees only its own group's earlier parts (`:346-395`).
    - While path editing or picking components, everything stays seated (`:1386-1392`).
  - **Reorder** (`updateAssemblyInstructionStepOrder`, `SVC:7542-7572`): after saving the new sort orders, any link whose join step now sits at or before the staged step (`j.sortOrder <= s.sortOrder`) is cleared (`parentStepId = null`), which turns that step back into built-in-place. This happens in the same Kysely transaction.
  - **Step-list icon**: `LuBoxes`, tooltip "Built off to the side, then carried in at its join step" (`Explorer:1134-1140`).
  - **Storage**: `assemblyInstructionStep.parentStepId` holds the link (`SVC:9344` maps it to viewer `joinStepId`).
  - **MES**: `AssemblyView` maps `joinStepId: step.parentStepId ?? null` (`apps/mes/app/components/AssemblyView.tsx:199-200`, `:221`). The MES loader selects `parentStepId` (`operations.service.ts:640`).

---

## 6. Viewer toolbar views

- `ASSEMBLY_VIEWS = ["build", "focus", "full"]` (`V/visibility.ts:18`).
  - Build: installed solid, future hidden.
  - Focus: installed ghost, future hidden.
  - Full: everything solid (`:29-39`).
- **Isolate was removed**, per the comment: "An "Isolate" view that also hid the built side was dropped: Focus already shows the step in place, and per-step hidden parts cover removing clutter the author chooses." (`V/visibility.ts:25-27`).
- Button labels and their screen-reader descriptions:
  - "Build": "Show the assembly as built so far, hiding later components"
  - "Focus": "Focus this step by fading the already-installed components to see-through"
  - "Full": "Show every component solid"

  Source: `V/AssemblyPlayer.tsx:2772-2786`. The group's aria-label is "Component visibility" (`:754-779`).
- The control is not gated on `readOnly`, so the same control appears in the ERP and the MES (`:751-753`). The default view is Build (`:205-206`, `:237-238`). It is held in component state; I did not verify whether it persists.
- Views drive camera occlusion scoring: hidden parts are not obstacles, and ghosted parts weigh 0.3 (`V/visibility.ts:92-124`).
- Not the same thing: selecting a component in the **Components panel** still isolates it (shows only it) in the ERP editor. That is `focusedNodeIds`, cleared on step change, add-mode or a viewer pick (`R/$id.tsx:246-249`, `:406-420`; `V/AssemblyPlayer.tsx:108-114`).

---

## 7. BOM tab, Slides tab, and how instructions reach jobs

- **BOM tab**:
  - **Materials** (`UI/AssemblyStepMaterials.tsx`):
    - Heading "Materials" (`:78-80`), empty state "No materials to display" (`:82`).
    - Add form: a "Pick a BOM item" combobox, **Quantity** and **Add** (`:115-136`). The hint is "{q} on the BOM — leave blank for as needed" or "Leave blank for as needed" (`:138-142`). Rows show "×{q}" or "as needed" (`:180-182`).
    - The picker is limited to the item's make-method BOM, one option per distinct item, excluding items already on the step (`:21-25`, `:46-66`).
    - With no BOM it shows "Link this instruction to an item with a make method to pick BOM parts" (`:96-102`).
    - Source: `getFlattenedBomMaterials`, which uses the Active make method (or the first one), flattened through Make subassemblies with quantities multiplied per level (`SVC:8197-8215`).
  - **Tools** (`UI/AssemblyStepTools.tsx`): heading "Tools" (`:42-44`), "No tools to display" (`:46`), a "Pick a tool" `Tool` picker, Quantity (min 1, default 1) and **Add** (`:70-90`).
  - **Match BOM** (Components tab) calls `autoMatchAssemblyComponents`, which matches strong names first, then unique quantities (`SVC:8266-8271`). It then backfills every step's materials, additively (`R/$id.component-mappings.auto.tsx:33-39`).
- **Slides tab**: `SlidesEditor` with **Add Slide** / **Add Model** (`apps/erp/app/components/SlidesEditor.tsx:229`, `:247`). Images upload to `assembly/{instructionId}/` (`UI/AssemblyStepSlides.tsx:63`). A model slide uploads a 3D model, which starts conversion (`:86-110`). Captions save on blur and annotations save on change (`:154-163`).
- **Link to operations**:
  - An **Assembly**-type operation shows an "Assembly Instruction" picker, on both the item's Bill of Process (`apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx:1731`, `:1775-1786`) and the job's (`apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx:3589`, `:3633-3650`).
  - The picker lists every instruction version for the item, of any status (`getAssemblyInstructionsForItem`, `SVC:6473-6484`, via `apps/erp/app/routes/api+/production.assembly-instructions.$itemId.ts:20`).
  - Method and quote operations store only the pointer. Jobs inherit the steps at get-method time via `insertAssemblyDataForJobOperation`. It reads the instruction's steps, slides and tools, sets the provenance marker, and attaches the model as a slide (`packages/database/supabase/functions/get-method/index.ts:8125-8175`; call sites at `:1192`, `:2078`, `:4864`, `:6541`).
- **Sync Assembly Steps** (job operation):
  - The button is at `JobBillOfProcess.tsx:3661-3667`. After the pointer changes, the note reads "The assembly instruction was changed, but its steps were not synced to the operation." (`:3654-3658`).
  - Modal: "Are you sure?" / "Potential Data Loss" / "Syncing updates the operation's steps from the assembly instruction. Steps previously synced from an instruction are updated or removed to match; hand-authored steps are kept." with the buttons **Cancel** and **Sync** (`:3848-3876`).
  - Route: `R/$id.sync-bop.tsx`. It needs update:production and refuses a locked job (`:31-55`).
  - Service: `syncAssemblyInstructionToOperation`, a Kysely transaction (`SVC:8640-8660`). Its full behavior (update matched steps, insert new ones, delete stale ones, material/tool/slide links) is described in `apps/erp/app/modules/production/AGENTS.md:116`. I only read the function header.
- **MES guided assembly view**:
  - `AssemblyView` mounts `AssemblyPlayer` with `autoPlay`, `loop`, `readOnly` and `hideCaption` (`apps/mes/app/components/AssemblyView.tsx:1978-1992`).
  - Steps come from `getAssemblyPlaybackByOperationId` (`apps/mes/app/services/operations.service.ts:614`, `:640`).
  - The MES maps `flagged` (so flagged steps fade in), hidden parts and `joinStepId` (`AssemblyView.tsx:212-233`).
  - Existing user docs: `docs/content/docs/reference/mes.mdx:62-80` ("The guided assembly view", Build/Focus/Full) and `docs/content/docs/reference/jobs.mdx:66`.

---

## 8. Warnings shown

- **needsSupport**: the step row shows a `LuHand` amber icon, tooltip "A part in this step may tip once placed — consider a fixture or a second person." (`Explorer:1127-1133`). It is set by generation (`SVC:9257-9259`) and defined in the schema as diagnostic only (`MOD:1292-1297`).
  - There is **no "Hold" text badge** in the UI. The only "Hold" string in the viewer is a code comment (`V/AssemblyPlayer.tsx:1619`). AGENTS.md's "shown as a "Hold" badge" is stale (`apps/erp/app/modules/production/AGENTS.md:74`).
- **Flagged**:
  - Row icon `LuTriangleAlert` amber, tooltip "No collision-free path" (`Explorer:1122-1126`).
  - Properties header note "No clear path", with a "Blocked by {names}" tooltip (`Properties:196-201`, `:318-336`).
  - Motion row value "No clear path" (`:577-581`).
- **Planner offline**:
  - Empty state: "The geometry service is offline — motion planning is unavailable right now." (`Explorer:659-664`). Generate is disabled when the service is offline and no plan exists (`:668-673`).
  - Planner menu: "Geometry service offline — motion planning unavailable." and its items are disabled (`:747-766`).
- **Plan failed**: "Couldn't generate steps", then `planJob.error` or "Motion planning failed. Retry to run it again." (`Explorer:638-647`).
- **MES**: only `flagged` is mapped (`AssemblyView.tsx:214`, `:231`). I found no MES rendering of `needsSupport`; the only other "flagged" hit in that file is an unrelated comment at `:3184`.

---

## 9. Glossary terms (`packages/glossary/src/terms.ts`)

| Slug | Term | Definition (verbatim) | href | Line |
|---|---|---|---|---|
| `assembly-step-motion` | Motion | "The path this step's components travel into place during playback; worked out from the model, or drawn by hand with Edit Path." | none | 94-97 |
| `assembly-step-camera` | Camera | "The view a step plays from; without a saved view the step frames its own components." | none | 98-101 |
| `assembly-step-build-aside` | Build off to the side | "Builds this step's components beside the model as a group, then carries the group in at a later join step." | none | 102-105 |
| `assembly-step-hidden-components` | Hidden on this step | "Components hidden only while this step plays, such as a fixture in the way; use the eye in the Components tab to hide one." | none | 106-109 |
| `subassembly` | Subassembly | "A Make to Order component that gets its own job and routing inside the parent's build." | `/docs/reference/methods#kit-or-subassembly` | 89-93 |
| `operation-type` | Operation Type | (mentions that Assembly gets the guided assembly view) | none | 72-75 |
| `kit` | Kit | Make to Order, issued together | `/docs/reference/methods#kit-or-subassembly` | 110-114 |
| `procedure` | (sibling work-instruction term) | not read | ? | 157 |
| `bom` | Bill of materials | Called a method in Carbon | `/docs/reference/methods` | 67-71 |

- There are no glossary terms for "assembly instruction", "join step" or step status. (I grepped `terms.ts` for "assembl"; the only hits are the lines above and `:1735`/`:1929`, which are unrelated.)
- In the UI, the four `assembly-step-*` terms appear as `LabelWithHelp termId` (`Properties:572`, `:610`, `:845-847`; `AssemblyStepJoin.tsx:139`). None has an `href`, so the new page could supply one.

---

## 10. Status color maps (for `<StatusFlow entity=…>`)

- `ASSEMBLY_STEP_STATUS_COLOR_MAP = { Todo: "gray", Review: "yellow", Done: "green" }` (`packages/utils/src/status-colors.ts:64-70`). It is registered as `assemblyStep` in `statusColorMaps` (`:365-369`), so `<StatusFlow entity="assemblyStep">` works.
- **There is no `assemblyInstruction` map.** `statusColorMaps` (`:365-405`) has none, and none exists for procedure either.
- For an instruction StatusFlow, either add a map or rely on the StatusFlow fallback. The component falls back to "gray" when there is no entity or no match (`docs/components/editorial/status-flow.tsx:144-145`).
- App colors to mirror: Draft gray, Published green, Archived red (`UI/AssemblyInstructionStatus.tsx:12-17`).
- Usage example in the docs: `docs/content/docs/reference/supplier-returns.mdx:55`.

---

## Flash and error strings (for an AgentContext block)

**Create** (`apps/erp/app/routes/x+/production+/assemblies.new.tsx`)
- "Failed to load the selected item" (:73)
- "The selected item has no 3D model. Upload a STEP file on the item's Model tab first." (:88)
- "The geometry service is unavailable — model conversion can't run right now. Try again shortly." (:106)
- "Failed to create assembly instruction" (:125)
- success "Assembly instruction created" (:176)

**Editor load and rename** (`R/$id.tsx`)
- "Assembly instruction not found" (:100)
- "Failed to load assembly instruction" (:101)
- "Failed to update assembly instruction" (:187)
- success "Updated assembly instruction" (:194)

**Instruction status** (`R/$id.status.tsx`)
- "Invalid status" (:29)
- "Failed to update assembly instruction status" (:43)
- success "Updated assembly instruction status" (:50)

**Activate** (`R/$id.activate.tsx`)
- "Failed to make assembly instruction active" (:31)
- success "Made assembly instruction active" (:38)

**New version** (`R/$id.version.new.tsx`)
- "Failed to create new assembly instruction version" (:41)

**Delete**
- "Failed to delete assembly instruction" / success "Successfully deleted assembly instruction" (`R/delete.$id.tsx:25`, `:32`)
- "Failed to delete step" / success "Successfully deleted step" (`R/$id.steps.delete.$stepId.tsx:22`, `:30`)

**Step save** (`R/$id.steps.$stepId.tsx`)
- "Failed to update step" (validation, :37)
- "Failed to update assembly instruction step" (:61)

**New step** (`R/$id.steps.new.tsx`)
- "Failed to create step" (:34)
- "Failed to insert assembly instruction step" (:56)

**Step status** (`R/$id.steps.status.$stepId.tsx`)
- "Failed to update step status" (:37)

**Hidden** (`R/$id.steps.hidden.$stepId.tsx`)
- "Failed to update hidden components" (:32, :48)

**Join** (`R/$id.steps.join.$stepId.tsx`)
- "Failed to update step" (validation, :31)
- The service message is passed straight through (:46):
  - "Step not found" (`SVC:7335`)
  - "That step can't be the join step for this one" (`SVC:7343`)

**Motion and camera** (`R/$id.steps.motion.$stepId.tsx`)
- "Failed to update motion" (:39, :59)
- client toast "The model isn't ready yet" (`R/$id.tsx:564`)

**Components** (`R/$id.steps.components.$stepId.tsx`)
- "Failed to update components" (:34, :56)

**Order** (`R/$id.steps.order.tsx`)
- "Failed to receive a new sort order" (:21)
- "Failed to update sort order" (:42)

**Generate** (`R/$id.steps.generate.tsx`)
- success "Generated {n} steps from the motion plan" / "Regenerated {n} steps from the motion plan" (:42-45)
- appended when parts are unmatched: ". {n} component(s) have no BOM match — use Match BOM to link their materials." (:55)
- "The geometry service is unavailable — motion planning can't run right now." (:73)
- "Steps already exist — delete them before generating from the plan" (:118)
- "Some steps are locked — cannot regenerate" (fallback, :120). The service message is "{n} step(s) is/are manually authored or done — delete or reset them before regenerating" (`SVC:9110-9112`).
- "This instruction has no processed model" (:122)
- "Failed to generate steps" (:123)

**Plan rerun** (`R/$id.plan.rerun.tsx`)
- "This instruction has no model" (:48)
- "The model must finish converting before planning" (:58)
- "The geometry service is unavailable — motion planning can't run right now." (:71)
- "Motion planning is already running" (:84)
- "Some steps are manually authored or Done — reset or delete them before regenerating" (:137)
- success, one of:
  - "Re-planning motions in the current step order — steps update when it finishes"
  - "Re-planning from scratch — steps rebuild automatically when it finishes"
  - "Motion planning started — steps generate when it finishes"

  (:177-181)

**Model** (`R/$id.model.convert.tsx`, `R/$id.model.invalidate.tsx`)
- convert: "Could not find the instruction's model" (:33)
- convert: "Model conversion is already in progress" / "The model is already converted" / "This model cannot be converted (only STEP files are supported)" (:49-53)
- convert: the geometry-service string (:66)
- convert success: "Model conversion started" (:80)
- invalidate: "This instruction has no model" (:36)
- invalidate: "Could not invalidate the model cache" (:48)
- invalidate success: "Model cache invalidated; re-converting from the source file" (:59)

**Cancel** (`R/$id.jobs.cancel.tsx`)
- "Invalid job kind" (:30)
- "This instruction has no model" (:46)
- "Could not cancel the job" (:68)

**Match BOM** (`R/$id.component-mappings.auto.tsx:55`)
- success "Mapped {mapped} of {total} components to the bill of materials", plus optional " ({n} BOM line(s) unmatched: …)" and " and added {n} step material(s)"

**Sync to job** (`R/$id.sync-bop.tsx`)
- "Operation not found" (:43)
- "This job is locked — steps can't be synced to it" (:52)
- success "Synced {n} steps to the BOP ({c} new, {u} updated, {d} removed, {s} slides, {t} tool links)" with optional " — {n} part link(s) had no matching BOM line on the operation" (:67-77)
- "Failed to sync assembly to BOP" (:87)

---

## Could not verify / flagged

1. **Server-side Draft-only guard.** Editing is blocked only in the UI (`R/$id.tsx:218-219`). I found no `Draft` check in the `R/` routes, the assembly service functions, or the assembly migrations I grepped. So a direct POST to the step routes on a Published instruction may succeed. I did not test this. I also did not read the RLS policies.
2. **Sync-bop "Published only".** The route comment says it syncs "a Published assembly instruction" (`R/$id.sync-bop.tsx:14`). Neither the route nor the picker (`SVC:6473-6484`) filters by status. Whether a Draft can be picked and synced was not tested.
3. **Stale AGENTS.md.** `apps/erp/app/modules/production/AGENTS.md:74` still describes four views, including **Isolate**, and a "Hold" badge. The code has three views (`V/visibility.ts:18`) and a hand icon with a tooltip (`Explorer:1127-1133`). The docs should follow the code.
4. **Camera row label for a planner hint.** Generated steps carry `{source:"plan"}` cameras (`SVC:9248-9250`), and the row shows "Saved view" whenever `camera != null` (`Properties:430`, `:615`). So a freshly generated step likely reads "Saved view" rather than "Automatic". I inferred this and did not see it in the running app.
5. **Reorder side effects beyond backward links.** `updateAssemblyInstructionStepOrder` only clears links whose join step is now at or before the staged step (`SVC:7555-7570`). A step dragged to position 1 (becoming the base), or a nested link, stays in the DB and is merely ignored by playback (`V/staging.ts:9-11`). I did not verify how the join dropdown then displays for such a row.
6. **The `assemblyInstructions` view SQL and `syncAssemblyInstructionToOperation` internals** (update, insert and delete matching; tools; slides) are described from AGENTS.md (`:15`, `:116`) plus the function header only. I did not read the full bodies.
7. **Whether the chosen view (Build/Focus/Full) persists** across steps or reloads. It lives in `useState` (`V/AssemblyPlayer.tsx:237-238`). I did not check whether anything else resets it.
8. **MES display of needsSupport, and of the build-aside icon.** Neither was found in `apps/mes/app/components/AssemblyView.tsx`. The only thing the MES maps is `flagged`.
9. **Glossary `procedure` entry** (`terms.ts:157`): not read.
10. **Permission nuances.**
    - Delete Instruction in the header also requires `permissions.is("employee")` (`Header:158-161`).
    - Row status and join changes require only update:production.
    - I did not check whether the employee-role RLS migration (`20260721014248_assembly-select-employee-role.sql`) restricts writes.
