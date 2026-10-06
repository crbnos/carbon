# Tables, lists and data-heavy UI

Paths relative to `apps/erp/app/` unless they start with `apps/` or `packages/`.

## Contents
1. Principles
2. Which list shape — table, explorer, tree, grid, kanban, cards, feed
3. The Table: capabilities you get for free
4. Column conventions + canonical skeleton
5. Cell rendering by data type
6. Filters, search, sort, views, bulk
7. Row actions
8. Line items and editable grids
9. Numbers, money, dates, units
10. Empty, loading, no-results
11. When a table legitimately differs

---

## 1. Principles

1. **One `Table` for every record list** (`components/Table/Table.tsx`, 143 of 145 lists).
   Never hand-roll a list table — you'd lose search, filters, views, export, pagination,
   keyboard nav and the empty/loading states.
2. **List route = table + `<Outlet/>`; state lives in the URL** (`?search`, `?filter=col:eq:v`,
   `?sort=col:asc`, `?view=`).
3. **First column = identity**: `Hyperlink` to the record, pinned left, `LuBookMarked` icon.
   Items add a thumbnail and stack ID over a muted name.
4. **Every column has an icon and a translated Title Case header.**
5. **Values render through semantic cell components, never raw ids or raw enums.**
6. **Filters are declared on the column** (`meta.filter`).
7. **Row actions are one `renderContextMenu`** → right-click + pinned ⋮ column.
8. **One create affordance**: `primaryAction` = `<New>`, permission-gated.
9. **Hide audit/secondary columns by default, don't omit them.**
10. **Dense single-line rows** (44px, `text-sm`, truncate, `max-w-[30dvw]`).
11. **Left-aligned, tabular numbers** in list tables.
12. **Line items inside documents are not the list table.**

## 2. Which list shape

| Shape | Use when | Exemplar |
|---|---|---|
| **Table** | a collection users search, filter, sort, export; one record per row; rows open a page or drawer | `modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx` |
| **Compact Table** | an operational sub-collection inside a record (job operations/materials, count lines) | `modules/production/ui/Jobs/JobOperationsTable.tsx` |
| **Explorer list** | the lines of the document you're inside; selecting routes to the line | `modules/purchasing/ui/PurchaseOrder/PurchaseOrderExplorer.tsx` |
| **TreeView** | hierarchies: BoM, lines with methods, chart of accounts | `components/TreeView/TreeView.tsx` |
| **SortableList** | ordered children each edited inline (BoM/BoP) | `components/SortableList.tsx` |
| **Grid** | small editable child lists on master data (supplier parts, price overrides) | `components/Grid/Grid.tsx` |
| **Card-row list** | lines the user fills in before posting (receipts, shipments) | `modules/inventory/ui/Shipments/ShipmentLines.tsx` |
| **Kanban** | work moved between states or work centers by dragging | `apps/mes/app/components/Kanban/`, `modules/production/ui/Schedule/Kanban/Kanban.tsx` |
| **Card grid** | operator (MES) lists read at a glance on touch | `apps/mes/app/components/OperationsList.tsx` |
| **Activity feed** | history / audit narrative for one record | `components/Activity.tsx` |
| **Cards + drawer** | a *small, rich* config set (approval rules, assignments) | — (`ad9e436003`) |

Rule of thumb: find many records → Table; work inside one document's lines → Explorer +
Summary; parent/child → TreeView; move work between states → Kanban; operator on the floor →
cards; 2–6 rich config items → cards.

### Record lists inside drawers, modals, popovers and cards

A list of *records* is a table wherever it appears — a drill-down drawer, a preview modal,
a card on a detail page. **Never render records as a stack of `div`s with fixed-width
columns.** Use the `@carbon/react` table primitives (`Table as TableBase` with `full`,
`Thead`, `Tbody`, `Tr`, `Th`, `Td`) for small embedded lists, or the ERP `Table` with
`compact` when users need search/filter/export. Each row still follows the list rules:
identity as `Hyperlink` (readable ID), the entity's own `{Entity}Status` wrapper (e.g.
`JobStatus`), `DateTime`, formatter hooks, `tabular-nums`. Size the overlay for the table
(`DrawerContent size="lg"`, `ModalContent size="large"|"xlarge"`).
Exemplar: `modules/production/ui/Planning/ProductionPlanningOrderDrawer.tsx` (TableBase in an
lg Drawer with `JobStatus`).

### Orient decision tables for the decision

When users compare things to choose one (suppliers for a PO, quotes, work centers), the
**things being chosen are rows and the criteria are columns**, so each criterion is sortable
and filterable. Transposed matrices (criteria as rows) are only for side-by-side reading of 2–4
items where sorting doesn't matter (`modules/purchasing/ui/SupplierQuote/SupplierQuoteCompareDrawer.tsx`).

## 3. The Table — capabilities you get for free

Key props (`components/Table/Table.tsx`): `columns`, `data`, `count`, `title` (the page
title), `primaryAction`, `headerActions`, `table` + `withSavedView` (top-level lists),
`withSearch` (default on), `withPagination` (on), `withColumnOrdering` (on), `withCsvExport`
(on), `withSelectableRows` + `renderActions` (bulk), `renderContextMenu`,
`renderExpandedRow`, `groupRowsBy` (a header row above each run of rows sharing a key — the
caller orders `data` by it; e.g. Outbound grouped by day), `defaultColumnVisibility`, `defaultColumnPinning`, `compact` (embedded),
`emptyState`, `importCSV`, `getRowClassName`, `withInlineEditing` + `editableComponents`.

Column `meta` (`components/Table/types.ts`): `icon`, `filter` (`static | fetcher | custom | dateRange`,
`isArray`), `filterHeader`, `pluralHeader`, `renderTotal` + `formatter` (footer aggregate),
`exportValue`, `exportOnly`, `sortBy`. CSV rules: `.claude/rules/table-csv-export.md`
(export = what the user sees; no `_` in accessorKey).

## 4. Column conventions + skeleton

1. Component is `memo(...)` with `displayName`; columns in `useMemo` (deps include `t`);
   `renderContextMenu` in `useCallback`.
2. Append `useCustomColumns("table")` last.
3. **Order:** identity → partner/owner → Status → progress → references → dates → money →
   people → enumerables → booleans → audit (Created/Updated By/At).
4. `accessorKey` for real fields (sortable); `id:` for derived columns (+ `exportValue`,
   `filterHeader`).
5. Id-resolved columns get `meta.exportValue` so CSV shows the name.
6. `title` = plural noun; `defaultColumnPinning={{ left: [idColumn] }}`;
   `defaultColumnVisibility` hides `createdBy/createdAt/updatedBy/updatedAt` and low-signal columns.
7. Drawer links on config lists keep the query string: ``navigate(`${path.to.x(id)}?${params}`)``.

Skeleton (distilled from `modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx` and
`PurchaseOrdersTable.tsx`):

```tsx
const WidgetsTable = memo(({ data, count }: Props) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<Widget>("widget");
  const columns = useMemo<ColumnDef<Widget>[]>(() => [
    { accessorKey: "widgetId", header: t`Widget Number`,
      cell: ({ row }) => <Hyperlink to={path.to.widgetDetails(row.original.id!)}>{row.original.widgetId}</Hyperlink>,
      meta: { icon: <LuBookMarked /> } },
    { accessorKey: "status", header: t`Status`,
      cell: ({ row }) => <WidgetStatus status={row.original.status} />,
      meta: { icon: <LuStar />, pluralHeader: t`Statuses`,
        filter: { type: "static", options: widgetStatusType.map((s) => ({ value: s, label: <WidgetStatus status={s} /> })) } } },
    { accessorKey: "dueDate", header: t`Due Date`,
      cell: (item) => <DateTime value={item.getValue<string>()} variant="date" />,
      meta: { icon: <LuCalendar /> } },
    { accessorKey: "assignee", header: t`Assignee`,
      cell: ({ row }) => <EmployeeAvatar employeeId={row.original.assignee} />,
      meta: { icon: <LuUser />, filter: { type: "static", options: people.map((p) => ({ value: p.id, label: p.name })) },
        exportValue: (row) => people.find((p) => p.id === row.assignee)?.name ?? row.assignee } },
    { accessorKey: "createdAt", header: t`Created At`,
      cell: (item) => <DateTime value={item.getValue<string>()} variant="date" />, meta: { icon: <LuCalendar /> } },
    ...customColumns,
  ], [t, people, customColumns]);

  const renderContextMenu = useCallback((row: Widget) => (
    <>
      <MenuItem disabled={!permissions.can("update", "sales")} onClick={() => navigate(path.to.widgetDetails(row.id!))}>
        <MenuIcon icon={<LuPencil />} /><Trans>Edit</Trans>
      </MenuItem>
      <MenuItem destructive disabled={!permissions.can("delete", "sales")} onClick={() => onDelete(row)}>
        <MenuIcon icon={<LuTrash />} /><Trans>Delete</Trans>
      </MenuItem>
    </>
  ), [permissions]);

  return (
    <Table<Widget> count={count} columns={columns} data={data} title={t`Widgets`}
      table="widget" withSavedView
      defaultColumnPinning={{ left: ["widgetId"] }}
      defaultColumnVisibility={{ createdAt: false }}
      primaryAction={permissions.can("create", "sales") && <New label={t`Widget`} to={path.to.newWidget} />}
      renderContextMenu={renderContextMenu} />
  );
});
```

## 5. Cell rendering by data type

| Type | Render with | Header icon |
|---|---|---|
| Record identity | `Hyperlink` → readable ID (+ `RevisionSuffix`) | `LuBookMarked` |
| Item | `HStack` `ItemThumbnail size="sm"` + Hyperlink over `VStack` (ID, then `text-xs text-muted-foreground` name) | `LuBookMarked` |
| Named config row | `Hyperlink` → `Enumerable value={name}` | — |
| Status | module `{Entity}Status` (never a raw string or plain Badge) | `LuStar` |
| Person | `EmployeeAvatar employeeId` | `LuUser` |
| Customer / supplier | `CustomerAvatar` / `SupplierAvatar` (groups for many) | `LuSquareUser` / `LuContainer` |
| User-defined enum (type, group, location, UoM) | `Enumerable value` (`EnumerableGroup` for many) | domain |
| Fixed typed enum with meaning (method, tracking) | `Badge variant="secondary"` + domain icon + translated label | domain |
| Tags | `HStack gap-1` of `Badge variant="secondary"`; filter `isArray: true` | `LuTag` |
| Boolean | read-only `Checkbox isChecked` | `LuToggleLeft` |
| Date | `DateTime value variant="date"` | `LuCalendar` |
| Late / on-time date | `DateTime` wrapped in `text-red-500` when late (muted otherwise) | `LuCalendar` |
| Money | `useCurrencyFormatter().format(v)` in `tabular-nums`; `meta.renderTotal` for footer sums | `LuDollarSign` |
| Per-row currency | `formatMoney` from `@carbon/utils`; no cross-currency total | |
| Progress x/y | `BarProgress progress={pct} value={\`${done}/${total}\`}` | |
| Count / quantity | `<span className="tabular-nums">`; `useQuantityFormatter` where decimals matter | `LuHash` |
| Long text | `max-w-[320px] truncate`, usually hidden by default | |
| Custom fields | automatic via `useCustomColumns` (`hooks/useCustomColumns.tsx` is the most compact type → renderer map) | |

## 6. Filters, search, sort, views, bulk

- **Search:** built in (`?search=`, debounced); server-side matching.
- **Filters:** per column `meta.filter` — `static` options (label may be the cell component,
  e.g. the Status pill), `fetcher` (endpoint), `custom`, `dateRange` (From / To pickers on a
  DATE column, `?filter=col:between:from,to`, either side open). Active filters show as chips
  under the toolbar. `pluralHeader` for the chip label. The From / To pickers themselves are
  `DateRangeFields` (`components/DateRangeFields.tsx`) — reuse it for a date range kept in
  local state rather than the URL (e.g. the batch builder's Custom due filter).
- **Sort:** header click menu; `?sort=`; `meta.sortBy` to redirect.
- **Views:** `withSavedView` + `table="…"` on every top-level module list; views appear in the
  module sub-nav under the matching submodule (same `table` key).
- **Bulk:** `withSelectableRows` + `renderActions(rows)` → a `DropdownMenuContent` with
  `DropdownMenuLabel` "Update", `DropdownMenuSub` per field, destructive delete disabled when
  any row is ineligible; submits `ids[]` + `field` + `value` to one bulk route (exemplar
  `modules/items/ui/Parts/PartsTable.tsx`).
- **Import:** `importCSV={[{ table, label }]}` → ⋮ "Bulk Import" next to Add.

## 7. Row actions

`renderContextMenu` returns `MenuItem`s: **Edit** (`LuPencil`) first → domain verbs (Duplicate,
Receive, Create Change Notice, sub-menus via `MenuSub`) → **Delete** (`LuTrash`,
`destructive`) last. "Edit"/"Delete" on document lists, "Edit {Noun}"/"Delete {Noun}" on
config lists. Gate with `disabled`, never omit. Status-gated items are disabled
(`!["Draft"].includes(row.status)`). Row click does nothing (navigation is the Hyperlink or the
menu) unless the row is expandable. Report/workbench tables with no openable records omit
`renderContextMenu` and the Hyperlink column.

## 8. Line items and editable grids

| Surface | Pattern |
|---|---|
| Document lines (quote, SO, PO, invoice, return) | Explorer (left) + `…Summary` card (center) — never a list Table in the content pane |
| Operational sub-table in a record | `Table compact title=… primaryAction=…`; editable → `withInlineEditing` + `editableComponents` (`EditableNumber(mutation)`), `forceEditMode` for Draft docs |
| Small editable child list | `Grid` in a Card with `onNewRow` "New" row and an `<Outlet/>` for the form |
| BoM / BoP | `SortableList` with expandable inline forms, live reorder + throttled save |
| Receiving / shipping lines | card-row list with inline `NumberField` + selectors, per-line persistence |

Inline-edit cells: only editable cells show the selection ring and hover pencil; read-only
cells go `bg-muted/50` in edit mode; container owns arrow/Tab/Enter in the capture phase
(`.ai/lessons.md` "Inline-editable table cells commit on blur").

## 9. Numbers, money, dates, units

- Money: `useCurrencyFormatter({ rate?, compact?, wholeUnits?, currency? })` — pick a *kind*,
  never a digit count (`.claude/rules/numeric-precision.md`).
- Quantities: `useQuantityFormatter`; plain numbers `useNumberFormatter`; percent
  `usePercentFormatter`.
- Dates: `<DateTime variant="date">` for anything read as a calendar date; never
  `new Date().toLocale…` (`.claude/rules/date-handling.md`).
- `tabular-nums` on every numeric span. Left-aligned in list tables (the Table has no
  alignment API); right-aligned only in label → amount summaries.
- Units: beside the value (`12 EA`) or an Enumerable "Unit of Measure" column.
- Totals: list footer aggregate (`renderTotal`), document Summary totals block
  (`font-semibold`, not bold). Multi-currency lists show no total.

## 10. Empty, loading, no-results (built in — don't reimplement)

- Loading: skeleton grid after 300ms (`useSpinDelay`).
- Truly empty: toolbar and pagination hide; black circle + `LuTriangleAlert` + mono uppercase
  "No data exists" + the `primaryAction`.
- Filtered to nothing: "No results found" + secondary "Remove Filters".
- Pre-filtered sub-table with nothing yet: pass `emptyState` with a neutral sentence ("No
  production events recorded for this operation yet") — don't show "Remove Filters" to a user
  who never filtered (`678cf28e16`).
- Non-table lists: `Empty` (see `status-and-feedback.md`).

## 11. When a table legitimately differs

Reports/workbenches/matrices (trial balance, planning, capacity) have no Hyperlink column and
no row menu; system-created records (inspections, workflow runs, synced card transactions)
have no `primaryAction`; embedded wizard tables turn chrome off (`withSearch={false}`,
`withCsvExport={false}`, `sort={null}`, `withSidebarTrigger={false}`). The People list's identity
column is avatar + name. State the reason in your design brief when you deviate.
