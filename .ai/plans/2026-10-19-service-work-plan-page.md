# Service order Work tab on the project Plan page UI

Brad, 2026-10-19: "the service ui should be similar to the projects ui" — chose the
full version: the Work tab reuses the Plan page's list and toolbar, and a service
element opens as a full page like a project element. NodePeek goes away.

Precedent screens: `routes/x+/project+/$projectId.elements.tsx` (Plan, List layout)
and `routes/x+/project+/$projectId.element.$elementId.tsx` (`ElementView`).

## Decisions

- **D1. Service routes of its own** (Brad, 2026-10-19: "it's ok to have different
  code in two places. we can refactor some code to shared components"). The project
  element routes keep their `projects` permissions. Service gets its own routes under
  `service` permissions. They answer the same requests: field update
  `{ids, field, value}`, move, add, delete and plan lines. Both route sets call the
  same service functions, and both pages use the same UI components.
- **D2. Routes through context, not props.** `ElementRoutesProvider`
  (`modules/projects/ui/Elements/ElementRoutes.tsx`) supplies the hrefs and the
  permission module; its default is the project's, so the project pages change only
  where a hard-coded `path.to.*` is replaced by the context.
- **D3. Service element page** is `service-order+/$id_.work.$elementId.tsx` (the `$id_`
  escape, as `$id_.visits.$visitId.tsx`). It renders `ElementView` with a `charges`
  slot: NodePeek's charges table (coverage, Override, Reverse), Fixed Price and Add
  Expense move into a `ServiceCharges` section. Log time and Issue part post to
  `serviceOrderCharge` with `intent` hidden fields and `variant="service"`, as
  NodePeek did. The new route answers the old URL, so no redirect is needed.
- **D4. Element types.** `ElementsHeader` takes `types` (service: System, Task,
  Folder) and `layouts` (service: List only, so no tabs). Print Estimate sits in the
  header's ⋯ menu slot (`wbsMenu` renamed `menu`).
- **D5. Costs.** The Work list shows no cost columns (the Plan list has none). The
  element page's Time & materials section and ServiceCharges show them; the Billing
  tab keeps the order's totals.

## Tasks

- [x] **1. Service element routes** under `service-order+/`, `update: service`, each
  checking the element belongs to the order's project and the order is open: field
  update, move, add/delete (existing `$id.work` intents), plan lines (the template
  element route's six plan intents, extracted to a shared server helper).
- [x] **2. `ElementRoutes` context.** Fields: `module`, `elementHref(id)`,
  `listHref`, `newElement`, `updateElement`, `deleteElement(id)`, `moveElement`,
  `links`, `comments(id)`, `plan(id)`. Replace the hard-coded paths in
  `useElementField` (`ElementProperties.tsx`), `ElementList`, `MoveElementModal`,
  `ElementChildren`, `QuickAddRow`, `ElementLinks`, `ElementComments`,
  `ElementView` (plan path, breadcrumb, delete) and the `permissions.can(…,
  "projects")` checks in `ElementView` / `ElementList` callers.
- [x] **3. `ElementsHeader`** gains `types` and `layouts`; `wbsMenu` → `menu`.
- [x] **4. Work tab.** `$id.work.tsx` loader adds `getProjectElements`,
  `getProjectStates`, `getProjectLabels`; renders `ElementsHeader` + `ElementList`
  under a service `ElementRoutesProvider`; Build from part in the New Element menu.
  Delete the `add`/`delete` intents once nothing posts them.
- [x] **5. Service element page** (D3), `ServiceCharges` extracted from NodePeek.
  Delete `NodePeek`, `WorkTree` stays only if templates still use it (task 6).
- [x] **6. Templates.** `templates_.$id.tsx` and `templates_.$id_.$elementId.tsx` on
  the same list and `ElementView`, so `WorkTree` and the hand-built template page go.
- [x] **7. Docs.** `field-service.md`, `projects-system.md`, service `AGENTS.md`.
- [x] **8. Verify.** Typecheck, tests, then the browser at 1440/1024/390 px: add,
  rename, change state/owner/date, move, delete an element; log time, issue a part,
  add an expense, override coverage, reverse, set a fixed price; build from part;
  the same on a project to prove nothing regressed.

## Execution notes

- Task 1 deviated: the service routes are keyed by the Service PROJECT id, not the
  order, under `x+/service-work+/$projectId.*`, so orders and templates share them;
  `requireServiceWork` (`service.server.ts`) is their one guard. The `add`/`delete`
  intents of `$id.work.tsx` and `templates_.$id.tsx` are gone. Path helpers are
  `serviceWork*` (the service AGENTS.md naming rule now lists the prefix).
- The old `$id.work.$elementId.tsx` was deleted, not redirected: the new
  `$id_.work.$elementId.tsx` answers the same URL.
- A service element has no Links section or Add link (links trace requirements and
  tests), and no Create Job / Create PO line on plan materials (`canSupply` off).
- The charges table folds the date under the charge: six columns did not fit the
  ~590 px main column at 1024 px and pushed the row menu out of view.
- Browser-checked (1440, 1024, 390): New Element, open, rename, Log time (posted
  Billable), Reverse, fixed price, Move, Delete, a template element's plan line edit,
  Build from part's empty reason and Use the Bill of Materials, and a project's Plan
  and element page unchanged. Not exercised: Issue part, Add expense, Override
  coverage, the state / owner / date pills, comments.

## Part 2 — the service order workspace on the project workspace layout

Brad, 2026-10-19: "we want a whole layout redesign". The service order page copies
the project workspace (`project+/$projectId.tsx`). Brad chose a Settings page for the
order's properties. He also asked to move Settings up into the main list of page
links, for projects and for service ("i didn't see the settings link at the bottom").

- [x] **9. Project sidebar.** Put Settings after Time in the page links. Remove the
  pinned bottom block.
- [x] **10. `ProjectElementTree`** reads `routes.list` and `routes.element` from
  `useElementRoutes`.
- [x] **11. `ServiceOrderSidebar`.** Page links: Overview (`$id.details`), Work, Visits,
  Billing, Settings. Under Work, the element tree while a Work page is open.
- [x] **12. `ServiceOrderHeader`.** No route tabs and no properties toggle. Add the
  explorer toggle, as `ProjectHeader` has.
- [x] **13. `$id.tsx`.** `ResizablePanels` with the sidebar as the explorer and no
  properties panel. The loader adds the tree elements.
- [x] ~~**14. `$id.settings.tsx`.**~~ Dropped: Brad moved the settings to a properties
  column on Overview ("i like the settings shown in a properties panel of the overview
  tab").** Render `ServiceOrderProperties` as a page, in a column
  of at most 60rem.
- [ ] **15. Verify** in the browser, then update the docs.
- [x] **16. No cards** (Brad: "try to get rid of the card-style layouts"). Overview,
  Visits and Billing use a small heading over a bordered box. `RecordDocuments` takes
  `variant="section"`; its other callers keep the card.
- [x] **17. Header actions** (Brad: "these buttons should all be shown in the header").
  Each possible move is a button, the next step primary, impossible moves hidden.
- [ ] **15. Verify.** Typecheck passes. Brad asked to skip screenshots; the last
  page load hit a Vite dev-server timeout, so the new layout is not browser-checked.
