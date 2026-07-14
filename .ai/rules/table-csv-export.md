---
description: How the shared ERP data table exports its rows to CSV (the Download button), and how a table opts in.
paths:
  - "apps/erp/app/components/Table/**"
  - "apps/erp/app/modules/**/ui/**"
---

# Table CSV export (ERP)

The feature-rich data table at `apps/erp/app/components/Table/Table.tsx`
(re-exported from `apps/erp/app/components/index.ts` as `Table`) renders a
"Download CSV" icon button in its header. CSV export is **automatic for every
table** built on this component — there is no opt-in prop.

> This is the app-level table, NOT `packages/react/src/Table.tsx`. The latter is
> a plain HTML table wrapper (`Thead`/`Tbody`/`Td`/`Th`) with no CSV export.

## Flow

`Table.tsx` → `TableHeader` → `Download`. The three column-derived maps are built
once by `buildColumnMaps(columns, translateLabel)` in
`apps/erp/app/components/Table/utils.ts` (memoized in `Table.tsx`):

- `accessors: Record<string, string>` (passed as `columnAccessors`) — export key →
  translated human header label. The export key is `accessorKey ?? column.id`. A
  column is included when it has a string header (non-JSX) **or** a
  `meta.exportValue`. The label prefers a non-empty string header, then
  `meta.filterHeader` (covers JSX/blank-header columns), then the raw string
  header. **Throws** `Invalid accessorKey {key}. Cannot contain '_'` if any
  accessorKey contains an underscore.
- `exportValues: Record<string, (row) => unknown>` — export key → `meta.exportValue`
  for columns that define one. Lets a column export a derived/composite value (or
  resolve an id to a name) instead of the raw accessor read. See "meta hooks".
- `sortKeyToLabel: Record<string, string>` — server-sort key (`meta.sortBy ??
  accessorKey`) → translated label, used by the `Sort` picker. Only string-header
  columns with an accessorKey are included, so JSX-header columns (e.g. MRP week
  columns) never flood the picker.

`Download` also receives:

- `columnVisibility: Record<string, boolean>` — keyed by column id.
- `columnOrder: string[]` — column ids in display order.

`columnVisibility` / `columnOrder` are seeded from the current saved view
(`useSavedViews()`) so the export mirrors what the user currently sees.

`TableHeader` (`apps/erp/app/components/Table/components/TableHeader.tsx`) always
renders `<Download data columnAccessors exportValues columnOrder columnVisibility />`
and passes `sortKeyToLabel` to `<Sort>`.

## meta hooks (`types.ts`)

`ColumnMeta` (declared in `apps/erp/app/components/Table/types.ts`) adds two
optional, export/sort-related fields:

- `exportValue?: (row: TData) => string | number | boolean | null | undefined` —
  the CSV value for this column, given the full row. Overrides the raw-accessor
  read. Use it when the displayed value is derived/composite, or when the
  accessorKey is an id whose name lives in another row field. Keep it in sync with
  the column's `cell` (the common pattern is a shared formatter used by both).
- `sortBy?: string` — server-sort column override. When set, the sort UI writes
  `?sort=<sortBy>:dir` instead of using the accessorKey (e.g. accessor
  `supplierTypeId`, sort by the resolved `type` name). Must name a real column on
  the view. The per-column header sort menu in `Table.tsx` uses `meta.sortBy ??
  accessorKey` too.

## Download.tsx behavior

`apps/erp/app/components/Table/components/Download.tsx`:

- **Library:** `json2csv` from `json-2-csv`. Called as
  `json2csv(rows, { emptyFieldValue: "" })`.
- **Filename:** hardcoded `"data.csv"` (a Blob + anchor click; no server roundtrip).
- **Column selection** (respects the saved view): uses `columnOrder` (or
  `Object.keys(columnAccessors)` when order is empty), then keeps only ids that
  are `in columnAccessors` AND not `columnVisibility[id] === false`. Synthetic
  columns (select / expand / actions) are absent from `columnAccessors`, so they
  drop out. CSV headers are the `columnAccessors` label values.
- **Per-cell value:** for each kept column, if `exportValues[key]` exists it is
  called with the full row to produce the value; otherwise the raw accessor read
  is used, with the id→name substitution below. The result is then passed through
  `serializeForCsv` — a last-resort guardrail that `JSON.stringify`s a plain
  object (so a nested object never ships as `[object Object]` or explodes into
  stray columns); arrays, dates, and primitives pass through untouched. A column
  whose value is an object should supply a readable `meta.exportValue` rather than
  rely on this.
- **ID → name substitution** (only on the raw-accessor path, i.e. no
  `meta.exportValue`): for the accessor keys `itemId`, `supplierId`,
  `employeeId`, `customerId`, the raw id is replaced with the record's `name`
  via the `useItems` / `useSuppliers` / `usePeople` / `useCustomers` stores
  (`apps/erp/app/stores/`, imported from `~/stores`). Lookup is a memoized
  `Map<id, name>` per store; falls back to the raw value if not found.
- Renders nothing (and does nothing on click) when `data` is empty.

The stores are nanostore-backed hooks consumed as tuples,
e.g. `const [items] = useItems();`; each element exposes at least `{ id, name }`.

## Opting in (example)

Just render `<Table>` — the button comes for free. No `enableExport`-style prop:

```tsx
// apps/erp/app/modules/production/ui/Jobs/JobMaterialsTable.tsx
<Table<JobMaterial> compact count={count} columns={columns} data={data} title={t`Materials`} />
```

## Gotchas

- The underscore restriction is enforced in `buildColumnMaps` (`utils.ts`), not in
  `Download.tsx` — a `_` in any accessorKey crashes the table (it's the first map
  built) before export is even possible.
- Export uses `data` currently passed to the table (the current page/result set),
  not a full server-side dump.
- The `name` substitution is keyed on the literal accessor strings `itemId` /
  `supplierId` / `employeeId` / `customerId` **and only runs when the column has no
  `meta.exportValue`**; a column holding one of those ids under a different
  accessor key (or one that supplies its own `exportValue`) will not get the
  store-backed substitution — resolve the name yourself in `exportValue`.
- A column with a JSX header and no `meta.filterHeader` and no `meta.exportValue`
  is absent from all three maps — it neither exports nor appears in the sort
  picker. Give it a `filterHeader` (label) and/or an `exportValue` to include it.

## Unrelated standalone CSV

`apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` also
calls `json2csv` directly for its own download (`{code}-exchange-rates.csv`); it
is independent of the shared Table component.
