# Assembly Editor — Requirements

Derived from competitor analysis (two screenshots: V8 engine turbo ~50 steps,
centrifugal pump ~42 steps with context menu) and user feedback. These are the
features needed to reach parity with the market leader and make the editor
production-ready.

---

## 1. Bill of Materials Tree (derived from STEP file)

The left panel must show a **Bill of Materials** section below the step/component
list, derived entirely from the uploaded CAD model's assembly hierarchy.

### Requirements

- **BOM derived from graph.json**: walk the assembly tree extracted by the geometry
  service and display every leaf part, grouped by geometry hash (identical parts),
  with a count.
- **Display format**: `part_name — count`, e.g. `clamping device washer_din_DIN 6340-13 — 14`.
  Sort by count descending (most-used parts first) or alphabetically — user toggle.
- **Gear icon per part**: clicking opens a detail popover (volume, bounding box
  dimensions, color swatch, which steps reference this part).
- **Click-to-highlight**: clicking a BOM row highlights all instances of that part
  in the 3D viewer (emissive tint + camera orbit to frame them).
- **Multi-select in BOM**: shift/cmd-click selects multiple part types; all instances
  highlight in the viewer. Useful for "show me all the M8 bolts."
- **Selected-parts context**: when parts are selected in the BOM, the context menu
  (right-click or toolbar button) offers grouping actions (see section 5).
- **BOM updates live**: if the user hides a part or marks it as a fixture (not
  assembled), the BOM count adjusts.
- **No manual BOM entry**: the BOM is always derived from the model. Users don't
  type part names — they come from the STEP file's product names.

---

## 2. View Cube (3D orientation gizmo)

The 3D viewer must include a view cube in the top-right corner for spatial
orientation and quick view snapping.

### Requirements

- **Orientation display**: shows current camera orientation labeled with
  Front/Back/Left/Right/Top/Bottom faces.
- **Click-to-snap**: clicking a face, edge, or corner snaps the camera to that
  standard view with a smooth animated transition.
- **Axis arrows**: RGB axis arrows (X=red, Y=green, Z=blue) extending from the
  cube's corner, matching CAD convention.
- **Always visible**: rendered on top of the model, not occluded. Fixed position
  in the top-right of the viewer canvas.
- **Dark/light mode**: cube colors adapt to the current theme.

### Implementation note

drei provides `GizmoHelper` + `GizmoViewcube` which implements all of the above
out of the box. The viewer package already depends on drei.

---

## 3. Requirements Pane (Tools, Notes, Standard Notes, Media)

The right panel must support a tabbed "Requirements" (or "Supplements") view
where authors attach process data to each step.

### Requirements

#### 3.1 Panel structure

- **Tabs at the top**: Tools | Notes | Standard Notes | Media.
  Each tab shows its section with a "Manage >" link for bulk editing.
- **Per-step scope**: requirements are attached to the currently selected step.
  Switching steps updates the panel.
- **Empty states**: each section shows "No [tools/notes/media] to display" when
  empty, with an inline "Add" action.

#### 3.2 Tools

- **Add tool references**: search Carbon's existing resource/tool catalog
  (the `tool` item type and `methodOperationTool` pattern). Selecting a tool
  links it to the step.
- **Free-text tool entry**: if the tool isn't in the catalog, enter a name
  (e.g., "4mm hex key") as a free-text tool reference.
- **Display**: tool name, optional torque spec (from the step's `fastener.tool`
  and `fastener.torqueNm` fields), optional image.
- **Reorder**: drag to reorder tools within a step (order = sequence of tool use).

#### 3.3 Notes

- **Free-text notes**: rich-text or plain-text notes per step. Multiple notes
  per step allowed.
- **Warning/caution/info classification**: each note can be tagged as Info,
  Caution, or Warning (renders with appropriate icon/color: blue/yellow/red).
- **Display inline**: notes render in the MES playback view alongside the
  animation.

#### 3.4 Standard Notes

- **Reusable templates**: company-level note templates (e.g., "Apply Loctite 242
  to threads before insertion", "Verify torque with calibrated wrench").
- **Manage library**: "Manage >" link opens a modal/page to CRUD standard notes
  for the company.
- **Insert into step**: selecting a standard note copies it into the step's notes
  (one-click attachment, not a reference — so editing the template doesn't change
  already-published instructions).

#### 3.5 Media

- **Attach images/videos**: upload photos or short videos to a step (e.g., a
  photo of the real assembly at this stage, a video of a tricky technique).
- **Storage**: files upload to Supabase storage under the instruction's path.
- **Display in playback**: media thumbnails show in MES alongside the 3D
  animation. Tapping opens a lightbox.
- **Manage**: "Manage >" for bulk upload, reorder, delete.

#### 3.6 Fixtures and Consumables

- **Fixtures**: reference to jigs, fixtures, or workholding from the resource
  catalog. Displayed as a list per step. Informs the operator what to set up
  before starting.
- **Consumables**: adhesives, lubricants, sealants, tape, etc. Free-text with
  optional catalog link. Displayed per step.

---

## 4. Component Grouping (Clusters, Kits, Subassemblies)

Authors must be able to group parts in the component tree for organization
and step authoring.

### Requirements

#### 4.1 Context menu

- **Right-click on selected parts** (in the component list, BOM, or 3D viewer)
  shows a context menu with:
  - **Create cluster**: group selected parts into a named cluster (visual
    grouping only — parts appear as children of the cluster in the tree).
  - **Create kit**: group selected parts into a kit — a set of parts that are
    always picked/staged together (e.g., "M8 bolt kit: 4x bolt + 4x washer +
    4x nut"). Kits show as a single line in the step BOM with their contents
    expandable.
  - **Create combination**: merge selected parts into one logical unit for
    step purposes (e.g., a pre-assembled cartridge treated as one part).
  - **Create subassembly**: define selected parts as a subassembly with its
    own internal build sequence. The parent instruction references the
    subassembly as a single step ("Assemble pump head subassembly"), and the
    subassembly has its own instructions.
  - **Hide**: hide selected parts from the viewer (useful for fixtures, jigs,
    or reference geometry that shouldn't appear in operator instructions).
  - **Remove highlight**: clear the selection highlight.
  - **Manage visibility**: submenu to show/hide/ghost individual parts.
  - **Delete**: remove the selected parts from the instruction (not from the
    model — just exclude them from the instruction scope).

#### 4.2 Kit behavior

- Kits are defined at the instruction level (not the item/BOM level).
- A kit has a name, a list of constituent part nodeIds, and an optional
  part number.
- When a kit is added to a step, all its parts are included in the step's
  `partNodeIds` and animate together.
- Kits appear in the BOM section as a collapsible row: "M8 bolt kit — 4"
  expanding to show "M8 bolt ×4, M8 washer ×4, M8 nut ×4".

#### 4.3 Subassembly behavior

- A subassembly creates a child `assemblyInstruction` linked via
  `parentStepId` on the parent instruction's step.
- The subassembly has its own step sequence, authored in a nested editor
  view (drill-down navigation).
- In the parent instruction's playback, the subassembly step shows the
  subassembly animating as a unit (all its parts moving together from their
  exploded state to their final pose).

#### 4.4 Data model additions

- **`assemblyGroup`** table: `(id, assemblyInstructionId, name, type
  ['cluster'|'kit'|'combination'|'subassembly'], partNodeIds TEXT[],
  childInstructionId? FK, companyId, audit)`.
- Steps reference groups by including the group's partNodeIds in their own
  `partNodeIds` (denormalized for playback simplicity) plus a
  `groupIds TEXT[]` field for display purposes.

---

## 5. Viewer Enhancements (context transparency, nav arrows, timeline)

### 5.1 Context transparency (default render mode)

- Non-active parts render at ~30% opacity with their original color (not
  wireframe). Active step's parts are fully opaque with a subtle emissive
  highlight or distinct color.
- Completed steps' parts are solid at full opacity.
- This is the default mode (replaces hide-future-parts behavior).
- A toggle switches between: Ghost (default) | Hidden | Solid (all parts
  visible, no step context — the "Model" view).

### 5.2 Overlay step navigation

- Large translucent < > arrow buttons on the left and right edges of the
  viewer, vertically centered. Clicking advances/retreats one step.
- Arrows visually match the competitor (subtle, semi-transparent, appear
  on hover or always visible on touch devices).

### 5.3 Continuous animation timeline

- All step animations stitched into one continuous sequence.
- Footer shows elapsed/total time: "0:06 / 0:58".
- Scrubber maps to the global timeline, with step boundaries visible as
  tick marks on the scrubber track.
- Play button plays through all steps continuously. Clicking a step in the
  list seeks to that step's start time.

### 5.4 Model / Instructions tabs

- Tab bar at the top of the editor: "Model" | "Instructions".
- Model tab: full assembly viewer with the BOM tree (section 1), no step
  context. Explore parts, rotate, inspect.
- Instructions tab: current step-based editor with playback.

---

## 6. Step auto-description and status

### 6.1 Auto-generated step titles

- When a step's `title` is empty, derive a display title from its parts:
  verb + part names + fastener spec + quantities.
- Verb rules: "Add" for single-part insertion, "Assemble" for multi-part
  steps, "Install" for fastener-only steps.
- Format: `"Add Seat Rail Clamp, M5 SHCS (×4)"`.
- Part names come from graph.json node names matched by `partNodeIds`.

### 6.2 Step status indicators

- Each step shows a colored dot: red (has warnings or unresolved issues),
  yellow (needs review — planner-generated, not yet validated), green
  (author-validated).
- Author can toggle a step between review/done states via click or
  checkbox.

---

## Non-functional Requirements

- **Performance**: BOM tree and step list must render smoothly for assemblies
  up to 1000 parts. Virtualize the list if needed.
- **Mobile/touch**: MES playback must work on tablets (gloved touch). Large
  tap targets for step nav, no hover-dependent interactions.
- **Offline capability**: not required for Phase 1, but the viewer package
  should not assume network access during playback (all assets loaded
  upfront).
- **Accessibility**: step list and BOM are keyboard-navigable. Screen reader
  labels on viewer controls.
