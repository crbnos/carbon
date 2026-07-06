# Table CSV export (ERP)

The reusable data table at `apps/erp/app/components/Table/Table.tsx` renders a
"Download CSV" button via `TableHeader` → `Download`.

## Flow
- `Table.tsx` computes/holds:
  - `columnAccessors: Record<string,string>` — accessorKey → translated human header
    label (`Table.tsx`, built from `columns` with `getAccessorKey`; throws if an
    accessorKey contains `_`).
  - `columnVisibility: Record<string,boolean>` — keyed by column id; seeded from the
    current saved view (`useSavedViews().currentView`) or `defaultColumnVisibility`.
  - `columnOrder: string[]` (ColumnOrderState) — column ids in view order; seeded from
    the saved view or `defaultColumnOrder`.
- These are passed to `TableHeader` (`apps/erp/app/components/Table/components/TableHeader.tsx`),
  which forwards `columnAccessors`, `columnOrder`, `columnVisibility` to
  `<Download />`.
- TanStack column `id` defaults to `accessorKey` for data columns, so these three maps
  share keys. Synthetic columns (selection/expand/actions) are absent from
  `columnAccessors`.

## Download.tsx behavior (respects the saved view)
`apps/erp/app/components/Table/components/Download.tsx`:
- Exports only the columns visible in the current view, in the view's order, using the
  view's header labels (`columnAccessors`) as CSV headers. Order falls back to
  `Object.keys(columnAccessors)` when `columnOrder` is empty; columns absent from
  `columnAccessors` or with `columnVisibility[id] === false` are dropped.
- ID columns `itemId` / `supplierId` / `employeeId` / `customerId` export the record's
  **name** instead of the raw id, via the `useItems` / `useSuppliers` / `usePeople` /
  `useCustomers` stores (`apps/erp/app/stores/`, re-exported from `~/stores`). Lookup is
  by id→name with fallback to the raw value. The store hooks are called in the component
  body; id→name Maps are memoized.
- Uses `json2csv(rows, { emptyFieldValue: "" })` from `json-2-csv`; downloads as
  `data.csv`.

Stores return tuples consumed as `const [items] = useItems();`; each element is a
`ListItem` (`{ id: string; name: string; email?: string }`, `apps/erp/app/types/index.ts`)
plus extras.
