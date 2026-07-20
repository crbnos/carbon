# Assembly Instructions Editor

Last tested: 2026-06-11
Route: /x/production/assemblies (list), /x/assembly/:id (full-screen editor)

## Prerequisites
- **Log in as `brad@carbon.ms`** (magic link via the Inbucket mail app at
  `mail.<prefix>.dev`, mailbox "brad"), NOT the `test@carbon.ms` bypass user:
  the seat-rail demo data (items, model upload) is seeded into brad's
  "Carbon" company; test@carbon.ms's "Carbon Development" company is empty,
  so every item combobox renders only "Create Item".
- A modelUpload with processingStatus = Success. The seed's conversion can
  fail if the geometry service was down or hit the portless TLS issue —
  re-trigger with a POST to the Inngest dev server
  (`/e/dev`, event `carbon/assembly-convert` with
  `{modelUploadId, companyId, userId}`).
- DB must include the assembly migrations (step status enum, requirement
  tables, assemblyGroup) or step status shows blank and adds fail.

## Creating an instruction (item-first form)
- `/x/production/assemblies` → "Add Assembly Instruction".
- The Item combobox lists only replenishment = Make items (seed:
  "X000000001 Seat Rail").
- Selecting an item runs a model check: green "Model: <file> (N parts)"
  enables Save; an amber "no processed 3D model" warning keeps it disabled.
- Name is optional (defaults to the item name). Save redirects to
  `/x/assembly/:id`.

## Steps

### 1. Navigate to the list
- URL: `/x/production/assemblies`
- Expected: breadcrumb "Production / Assemblies", Production sidebar group
  shows Jobs / Procedures / Assemblies, table with Name/Status/Item/Model/
  Processing columns and "Add Assembly Instruction" button.

### 2. Open the editor
- Click an instruction name link in the table.
- Expected: full-screen editor at `/x/assembly/:id` — header with editable
  name, DRAFT badge, Publish button, item link; left panel Steps | Parts
  tabs; center 3D viewer with view cube (top-right) and footer controls
  (prev/play/next, step slider, Ghost/Hidden/Solid toggle group); right
  panel "STEP" heading.

### 3. Parts tab (BOM tree)
- Click the "Parts" tab in the left panel.
- Expected: "N parts · M instances" header with a sort toggle button, rows
  with color swatch / name / — count, gear button per row (hover).
- Click a row: row highlights, viewer frames the part instances with an
  emerald tint. Click again to clear.

### 4. Add a step
- Steps tab → "Add Step" button (footer of the left panel).
- Expected: a step row appears (status dot + "Untitled step" + part count),
  right panel shows Details | BOM | Requirements tabs with the step form.

### 5. Requirements tab
- Right panel → Requirements: inner tabs Tools | Notes | Std Notes | Media.
- Tools tab has a catalog combobox + free-text input + Add per section
  (Tools/Fixtures/Consumables); Notes has textarea + severity toggle;
  Std Notes lists templates with Insert + Manage; Media has a dropzone.

## Selector Notes
- List rows: the instruction name is a link containing an "Open" button.
- The left-panel tabs are "Steps" and "Parts"; right-panel tabs are
  "Details", "BOM", "Requirements".
- The ghost-mode buttons have aria-labels "Show future parts ghosted",
  "Hide future parts", "Show all parts solid".
- The status dot button label reads "Step status: <status>. Click to mark
  <next>".
- The 3D canvas takes a few seconds to load the GLB — sleep ~3s after
  navigation before screenshots.

## Common Failures
- Step status shows "undefined" / requirement Add fails with a column error:
  the local DB predates the assembly migrations — rebuild the database.
- "The model has not been processed": the instruction's modelUpload has no
  glbPath/graphPath — pick a Success row or convert a STEP file first.
