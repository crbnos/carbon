# Research — keyboard-nav polish (workflow runs record names, go-to nav, pagination tooltips, menu shortcuts)

Base: origin/main @ f474f0f289.

## 1. Workflow Runs — Record column
- Column: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunsTable.tsx:82-98` renders `<EntityRecordLink table id />` with no `name`.
- `EntityRecordLink.tsx:10-55` label order: `name` prop → inline row snapshot via `fkDisplayRegistry` → raw id. Link target from `getEntityPath(id)` (`apps/erp/app/utils/entity.ts:71`), renders `<Hyperlink>` or plain span when no route.
- Name lookup already exists: `getWorkflowRunRecordNames(client, companyId, refs)` (`workflows.service.ts:386-439`), one query per table, keyed `"table:id"`. Used by the detail drawer (`routes/x+/workflows+/runs.$runId.tsx:54-57`, `WorkflowRunDetail.tsx:170-177`).
- List loader `routes/x+/workflows+/runs.tsx:11-40` never calls it → the list shows "<Table label> <id>".
- Fix: call `getWorkflowRunRecordNames` in the list loader for the page's refs, pass `name` to `EntityRecordLink`, use the same name in `exportValue`.
- Open-record conventions in other tables: plain `<Hyperlink>` (dominant, e.g. `PurchaseOrdersTable.tsx:101-106`); hover-revealed `LuExternalLink` (`DocumentsTable.tsx:208-226`); separate icon link (`TraceabilityTable.tsx:278-287`).

## 2. Left nav G-then-letter — ALREADY ON MAIN
- `apps/erp/app/shortcuts.ts:68-85` `MODULE_GO_TO_PREFIX = "g"`, `MODULE_GO_TO`: a accounting, d documents, i inventory, v invoicing, t parts (Items), o people, r production, p purchasing, q quality, u resources, s sales, e settings, y users, w workflows. Shop Floor (external MES link) has none.
- Wired in `PrimaryNavigation.tsx:62-80` via `useShortcutSequence` (1500 ms window, ignores typing/dialogs/scanner bursts), disabled in rail edit mode.
- Listed in the `?` overlay (`apps/erp/app/components/ShortcutHelp.tsx:35-48`).
- Gap: rail items (`NavigationIconLink`, `PrimaryNavigation.tsx:325-380`) show no hint of the shortcut; no tooltip. Pattern to copy: `DetailSidebar.tsx:53-80` Tooltip + `ShortcutKey`.

## 3. Pagination Prev/Next tooltips
- Only component: `apps/erp/app/components/Table/components/Pagination/Pagination.tsx` (condensed IconButtons in the table header + full Buttons at the bottom).
- Shortcuts already exist: `PAGINATION_SHORTCUTS` ← / → (`shortcuts.ts:58-61`), bound at `Pagination.tsx:113-127`.
- Tooltip content is ONLY `<ShortcutKey shortcut="arrowleft">`, which renders a chevron icon (`ShortcutKey.tsx:36-45`) with no words → reads as "chevron arrow left".
- Fix: tooltip text "Previous page" / "Next page" + the keycap.
- Unverified risk: header and footer both mount `PaginationButtons` → two `useShortcutKeyMap` bindings for the same arrow.

## 4. Dropdown menu shortcuts
- Primitive: `packages/react/src/Dropdown.tsx` (Radix `react-dropdown-menu` 2.1.16). `DropdownMenuShortcut` exists (:197-207) but no app code uses it. `Context.tsx` wraps Radix context menu; `Menu.tsx` is a layer over both (`MenuItem`, `MenuShortcut`, `<Menu type="context"|"dropdown">`).
- ~190 files use DropdownMenu; ~116 look like three-dot "More" menus. Table row menus go through `renderContextMenu` (`Table.tsx:147`), rendered both in the actions column (`ActionMenu`) and as a right-click context menu (`Table.tsx:1325-1355`).
- No per-item shortcuts exist anywhere. Radix typeahead only moves focus to the first item starting with the typed letter — it does not activate it.
- Global hotkeys already stand down inside `[role=menu]` (`packages/react/src/utils/keyboard.ts:7-16`, `useShortcutKeys.ts:251-256`), so menu-scoped letters won't collide with page shortcuts.
- Only existing in-menu keydown: `QuoteLinePricing.tsx:732` (NumberField inside a menu stops propagation) — menu letters must skip editable targets.
- `ShortcutKey` (OS-aware keycap) is never used inside a menu item yet.
