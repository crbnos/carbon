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

`Table.tsx` → `TableHeader` → `Download`, passing three column maps:

- `columnAccessors: Record<string, string>` — accessorKey → translated human
  header label. Built in `Table.tsx` from `columns` via `getAccessorKey` +
  `translateLabel(column.header)`. **Throws** `Invalid accessorKey {key}. Cannot
  contain '_'` if any accessorKey contains an underscore.
- `columnVisibility: Record<string, boolean>` — keyed by column id.
- `columnOrder: string[]` — column ids in display order.

`columnVisibility` / `columnOrder` are seeded from the current saved view
(`useSavedViews()`) so the export mirrors what the user currently sees.

`TableHeader` (`apps/erp/app/components/Table/components/TableHeader.tsx`) always
renders `<Download data={data} columnAccessors columnOrder columnVisibility />`.

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
- **ID → name substitution:** for the accessor keys `itemId`, `supplierId`,
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

- The underscore restriction is enforced at the `columnAccessors` build step in
  `Table.tsx`, not in `Download.tsx` — a `_` in any accessorKey crashes the table
  before export is even possible.
- Export uses `data` currently passed to the table (the current page/result set),
  not a full server-side dump.
- The `name` substitution is keyed on the literal accessor strings `itemId` /
  `supplierId` / `employeeId` / `customerId`; a column holding one of those ids
  under a different accessor key will export the raw id.

## Unrelated standalone CSV

`apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` also
calls `json2csv` directly for its own download (`{code}-exchange-rates.csv`); it
is independent of the shared Table component.
