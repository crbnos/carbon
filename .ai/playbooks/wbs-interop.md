# WBS interop (codes, 881F templates, CSV import/export, MSPDI)

Last tested: 2026-10-12
Routes: /x/projects/new, /x/project/:id/elements?layout=list,
/x/project/:id/element/:elementId, /x/project/:id/wbs/{pin,import,renumber},
/api/projects/:id/wbs.csv, /api/projects/:id/mspdi.xml

## Prerequisites
- Company has DCAA timekeeping on (demo dataset): New Project then REQUIRES a
  Cost Objective ("Set a cost objective. DCAA timekeeping requires one").
- Use your own project; do not touch the ORBSEC demo projects.

## Steps
### 1. New Project from a MIL-STD-881F template
Projects list -> link "Add Project" (or /x/projects/new). Drawer fields: Name
(first textbox), Identifier (second textbox, 2-6 caps/digits), Cost Objective
combobox -> "Direct". Click button "Start from a copy" -> combobox -> option
"MIL-STD-881F Appendix B — Electronics/Avionics/Generic Systems" (hidden input
`copyFromProjectId` = `wbs:B`; A, C, F also listed). requestSubmit the dialog's
form via its "Save" submit button -> redirect to
/x/project/<id>/elements?layout=list. Appendix B gives 52 elements: 1.0
(System) with 1.1..1.13 and their level-3 children, all pinned.

Faster: POST FormData {name, identifier, costTreatment:"Statistical",
costObjective:"Direct", copyFromProjectId:"" or "wbs:B"} to /x/projects/new.
Elements: POST {type, name, parentId} to /x/project/<id>/elements/new (201).

### 2. Plan page WBS menu
Button "WBS options" (the ⋯ left of Filter) -> menuitems Export CSV, Export MS
Project XML (both `<a download>` to the api routes), Import CSV, Pin WBS codes.
Codes show in the List and the explorer tree ONLY once the project has a pinned
code; pinned codes carry a pin icon, duplicates a warning icon.

### 3. Pin WBS codes
Menu -> "Pin WBS codes" -> dialog -> button "Pin MOD+ENTER". A Parameter element
gets no code and does not shift its siblings.

### 4. Element WBS code + Renumber
Element page /x/project/<id>/element/<elementId>. Sidebar "Work" -> "WBS code"
with an edit icon at its right; clicking it opens an input (name=wbsCode).
Select-all, type, then BLUR (click elsewhere) — Enter does not commit.
Header ⋯ (top right of the element page) -> "Renumber WBS" -> runs at once,
toast "N WBS codes unpinned".

### 5. CSV export / import
GET /api/projects/<id>/wbs.csv -> text/csv, columns Element ID, WBS Code, Parent
WBS Code, Level, Type, Name, Start, Target, Budget, Predecessors (no Milestone,
by design). Import: menu "Import CSV" -> modal "Import WBS" ->
`agent-browser upload "[role=dialog] input[type=file]" <file>` -> preview table
(Row, Action, WBS code, Name, Error) -> button "Apply". A row with an error
disables Apply ("Fix N errors to apply").

### 6. MSPDI
GET /api/projects/<id>/mspdi.xml -> application/xml; `xmllint --noout` passes;
Tasks carry WBS, OutlineNumber, OutlineLevel, Summary, ConstraintType 4 on
dated leaves, FixedCost x100, PredecessorLink, ExtendedAttribute (readable id).

## Selector Notes
- `snapshot -i` does not list the element sidebar controls; use screenshots and
  mouse clicks by coordinate (viewport 1440x1100: WBS code edit icon ~1399,668;
  element ⋯ ~1403,83).
- Element moves are drag-and-drop; the same POST is
  /x/project/<id>/elements/move.data {intent:"move", elementId, parentId}.

## Common Failures
- Drawers/menus do nothing and `Object.keys(button)` has no `__react*` key: the
  page never hydrated because the dev proxy returned 502 for some modules under
  load. Reload until it hydrates.
- Duplicate pinned code: server refuses ("WBS code 1.1 is already pinned in this
  project") but the element page showed NO toast (2026-10-12).
- Export with duplicate codes: the api returns 422 "WBS codes repeat: 2.2…" but
  the download link fails silently in the browser.
