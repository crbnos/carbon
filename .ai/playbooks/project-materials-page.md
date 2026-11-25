# Project Materials Page

Last tested: 2026-11-25
Route: /x/project/{projectId}/materials

## Prerequisites
- A seeded company with project **OB2** (ORBSEC Constellation Block 2, satellite dataset). It has project stock and 2 Pull from Inventory plan lines of ST-050 on OB2-9 and OB2-10.
- Find its id with SQL: `select id from project where identifier = 'OB2'`.
- An element takes new charges only in an Unstarted or Started state. OB2-9 starts in **Backlog**, so an issue to it is refused until its State is set to In Progress.

## Steps
### 1. Navigate
- Open `/x/project/{id}/materials`. Expect a **Materials** sidebar link between Plan and Schedule.
- Columns (group by Element): Item, Method, Issue status, Supply, Required, Ordered, Received, Issued, Remaining, Required date, then Project on hand and Unassigned on hand when the project holds its own stock.
- `?groupBy=item` replaces Item with Element and puts the totals next to the item name in the group row.

### 2. Link a part (element sidebar)
- Open `/x/project/{id}/element/{elementId}`. Click the text "Add linked part". Fill the "Search" combobox with the part id. Click the option.
- The Plan List (`/elements?layout=list`) and the Tree card (`?layout=tree`) then show the part id.

### 3. Issue material
- Element page → **Estimated** tab → the plan card's **Issue** button → modal "Issue Material".
- Fill "Quantity", click the heading to blur, then `requestSubmit` the form whose submit button reads "Issue".
- Materials then shows Partly issued, and Project on hand drops by the quantity.
- The sidebar shows "Past average: … over 1 element" under Hours estimate.

### 4. A Purchase to Order line
- Estimated tab → **Add line** → **Material**. Item combobox: search and pick. Method: Purchase to Order. Quantity: fill and blur. `requestSubmit` with the "Add" button.
- Materials shows **No supply** in the Supply cell.
- The plan card's ⋯ menu (the last "More options" button) → **Create PO Line**. Pick a Supplier, then `requestSubmit` with "Create PO Line". The Supply cell then shows the PO number and **Draft**.
- On the PO page, **Finalize** → dialog **Finalize** (`requestSubmit`). In the satellite dataset the PO goes to **Needs Approval**, and Materials shows that status.

### 5. Filters
- **Filter** button → "Supply status" → "No supply". The URL becomes `?filter=supplyStatus:eq:No supply` and keeps the filter on reload.
- `?filter=issueStatus:eq:Not issued` hides Partly issued rows.

### 6. Used In
- Open `/x/part/{itemId}/details`. The Used In panel has a **Projects** group with one link per plan line (element readable ids). A link opens the element page.

## Selector Notes
- Card ⋯ menus have no label of their own. Open the last `More options` button with a JS click after `pointerdown`.
- Tree nodes are `.react-flow__node`. They do not appear in the accessibility snapshot, so read `document.querySelectorAll('.react-flow__node')`.

## Common Failures
- "Element OB2-9 of project OB2 is Backlog. Only an Unstarted or Started element takes new charges." → set the element's State to In Progress first.
- A blank page right after editing a component means the dev server is reloading. Reload after it settles. A route created before its component also gives a 500 "Cannot find module" until you touch the route file.
