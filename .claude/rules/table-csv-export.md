---
description: How the shared ERP data table exports its rows to CSV (the Download button), and how a table opts in.
paths:
  - "apps/erp/app/components/Table/**"
  - "apps/erp/app/modules/**/ui/**"
  - "apps/erp/app/routes/api+/table.export.ts"
  - "apps/erp/app/routes/api+/table.export.$exportId.ts"
  - "apps/erp/app/utils/table-jobs*.ts"
  - "packages/jobs/src/table-jobs/**"
  - "packages/jobs/src/inngest/functions/tasks/table-export.ts"
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
  columns with an accessorKey are included, so JSX-header columns (e.g. the
  demand projection week columns) never flood the picker.

`Download` also receives:

- `columnVisibility: Record<string, boolean>` — keyed by column id.
- `columnOrder: string[]` — column ids in display order.

`columnVisibility` / `columnOrder` are seeded from the current saved view
(`useSavedViews()`) so the export mirrors what the user currently sees.

`TableHeader` (`apps/erp/app/components/Table/components/TableHeader.tsx`) always
renders `<Download data columnAccessors exportValues columnOrder columnVisibility infinite />`
and passes `sortKeyToLabel` to `<Sort>`. `infinite` (`InfiniteExport`) is set
only on a table with the `infinite` prop. It carries the header `count`,
`hasMore`, the list's `listKey` and `loadAll(limit)` from `useInfiniteRows`.
The phone list's ⋯ menu runs the same `useCsvDownload` hook.

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

- **Library:** `downloadCsv` from `@carbon/files/csv` (papaparse underneath) —
  the ONE CSV encoder, injection-safe by construction (`stripCsvFormulaPrefix`
  on every string cell). `json-2-csv` is gone from the app.
- **Filename:** hardcoded `"data.csv"` (a Blob + anchor click; no server roundtrip).
- **Column selection** (respects the saved view): delegated to the pure
  `selectExportColumns({ columnAccessors, columnOrder, columnVisibility,
  exportOnlyColumns })` in `utils.ts`. It uses `columnOrder` (or
  `Object.keys(columnAccessors)` when order is empty), then keeps only ids that
  are `in columnAccessors` AND (in `exportOnlyColumns` OR not
  `columnVisibility[id] === false`). Synthetic columns (select / expand / actions)
  are absent from `columnAccessors`, so they drop out. CSV headers are the
  `columnAccessors` label values.
  A saved view stores the column order from when it was saved, so its
  `columnOrder` omits export-only columns added since — and the user can never
  reorder an invisible column back in. `selectExportColumns` therefore appends
  any `exportOnlyColumns` id the stored order missed instead of dropping it.
- **Export-only columns** (`exportOnlyColumns` prop, sourced from `meta.exportOnly`):
  columns hidden in the grid but always included in the CSV regardless of the view's
  `columnVisibility`. Use this for values you want in the export but not on screen.
  Build one with the `exportOnlyColumn<T>({ id, header, value })` factory
  (`utils.ts`, re-exported from `~/components`) rather than hand-writing the meta
  blob — it sets `exportOnly`, uses `header` as `filterHeader` (the CSV heading),
  and wires `value` as `exportValue`:

  ```tsx
  exportOnlyColumn<StockMovement>({
    id: "itemName",
    header: t`Item Name`,
    value: (row) => row.itemDescription ?? null
  })
  ```
- **Per-cell value:** for each kept column, if `exportValues[key]` exists it is
  called with the full row to produce the value; otherwise the raw accessor read
  is used, with the id→name substitution below. `encodeCsv` (inside
  `downloadCsv`) then sanitizes every cell — plain objects are
  `JSON.stringify`ed (never `[object Object]` or stray columns), strings are
  injection-stripped. A column whose value is an object should still supply a
  readable `meta.exportValue` rather than rely on the stringify guardrail.
- **ID → name substitution** (only on the raw-accessor path, i.e. no
  `meta.exportValue`): for the accessor keys `itemId`, `supplierId`,
  `employeeId`, `customerId`, the raw id is replaced with the record's `name`
  via the `useItems` / `useSuppliers` / `usePeople` / `useCustomers` stores
  (`apps/erp/app/stores/`, imported from `~/stores`). Lookup is a memoized
  `Map<id, name>` per store; falls back to the raw value if not found.
- Renders nothing (and does nothing on click) when `data` is empty.

## Two export paths: browser and background job

An infinite list holds only the rows loaded so far. `useCsvDownload`
(`Download.tsx`) picks one of 2 paths on each click. `BROWSER_ROW_LIMIT` is
1,000 (`components/Table/infiniteRowsStore.ts`).

| Case (checked in this order) | Path |
|---|---|
| No `infinite`, or `hasMore` is false | The browser exports the table's own `data`. Inline edits stay in the file. |
| `listKey` is set and `count` is above 1,000 | The browser POSTs to the export route at once. |
| Else | `loadAll(1000)` loads pages in the browser. If rows remain and `listKey` is set, the browser POSTs to the export route. If rows remain and no `listKey` is set, it downloads the first 1,000 rows and shows "Exported the first 1,000 rows." |

**Browser path.** Every cell uses the on-screen value (`meta.exportValue`, the
id → name maps). The columns are the visible columns, as described above.

**Background path.** The browser POSTs `{ listKey, search, columns: [{ key,
label }] }` with `fetch`, not a fetcher: a fetcher action would revalidate the
list and re-read every loaded page. The steps:

1. `api+/table.export.ts` finds the list in the registry (`getListDefinition`).
   It runs `requirePermissions` with the list's permission and `role: "employee"`.
2. It makes the export id, `{listKey}.{random}` (`newTableExportId`,
   `utils/table-jobs.ts`).
3. `startTableJob("export", …)` (`utils/table-jobs.server.ts`, the bulk
   actions' start path too) takes the company's export lock
   (`takeTableJobLock`, `packages/jobs/src/table-jobs/lock.ts`). The value is
   the export id.
   - If another export holds it, the route answers 409 with
     `tableJobBusyMessage`: "An export is already running for your company.
     Try again when it ends, at the latest in N minutes." N comes from the
     lock's TTL.
   - The same script takes one of `MAX_RUNNING_TABLE_JOBS` (4) slots shared by
     every company's exports and bulk actions (`TABLE_JOB_SLOTS_KEY`, a sorted
     set scored by expiry). With none free the route answers 503 with
     `TABLE_JOBS_FULL_MESSAGE` ("Too many exports and bulk actions are running
     right now…"). It refuses, never queues: a queue many companies fill
     would make every user wait. Release and extend free and renew the slot.
   - If Redis does not answer, the route starts the job anyway and logs a
     warning. Inngest's per-company concurrency still runs one export at a time.
4. It triggers `table-export` (`packages/jobs/src/inngest/functions/tasks/table-export.ts`,
   `concurrency: { key: "event.data.companyId", limit: 1 }`, `retries: 1`).
   If `trigger` fails, the route deletes the lock.
5. Step `check-permission`: the job reads the user's claims again
   (`canReadList`, `utils/table-jobs.server.ts`). If the user lost the list's
   permission, it notifies "Your export did not run" in-app and stops. A
   failed claims read throws, so the step retries instead.
6. Steps `write-part-0`, `write-part-1`, …: each step extends the lock, then
   reads at most 20 pages of 500 rows (`TABLE_JOB_ROWS_PER_STEP`, 10,000,
   `table-jobs/paging.ts`) as the user (`getUserScopedClient`, `fetchListPage`).
   It writes them as one part file (`writeExportPart`, `table-jobs/export-run.ts`).
   Part 0 starts with the header row. The step returns the counts and the next
   cursor only.
7. The parts stop at the end of the list, at 100,000 rows (`MAX_EXPORT_ROWS`),
   or after the page that passes 200 MB (`MAX_EXPORT_BYTES`, `table-jobs/csv.ts`).
8. Step `compose` uploads one `ReadableStream` that downloads the parts one at
   a time (`composeExport`, `concatParts`). Only one part is in memory.
9. Step `remove-parts` deletes the parts (`removeExportParts`). It is its own
   step so a retried `compose` still finds them.
10. Step `notify` sends `NotificationEvent.TableExport`. The title says "first
    N rows" when the export stopped at a limit.
11. Step `release-lock` deletes the lock.

| File | Key (`table-jobs/storage.ts`, bucket `temp-staging`) |
|---|---|
| The export | `{companyId}/exports/{userId}/{exportId}.csv` (`tableExportStorageKey`) |
| One part | `{companyId}/exports/{userId}/{exportId}.parts/{n}.csv` (`tableExportPartKey`) |

**The lock.** One Redis key per company and job kind, value = the job id,
TTL 15 minutes (`TABLE_JOB_LOCK_TTL_SECONDS`), so a run Inngest lost or
cancelled (no `onFailure`) frees its lock and slot within 15 minutes. Take, release and extend are each
one Lua script: `SET NX EX` that returns the TTL on refusal,
compare-and-delete, compare-and-expire. A job deletes or extends only a lock
that still holds its own id. `onFailure` also releases it and deletes the
parts.

**The download.** The notification row links to
`api+/table.export.$exportId.ts` (`path.to.api.tableExport` + `/{exportId}`,
`notificationTarget`). The route reads the list key from the export id and
runs `requirePermissions` with that list's permission again. It builds the
storage key from the session's company and user, so a user only reaches their
own exports. A missing file answers 404 "Exports are kept for 7 days". A failed
or refused export has documentId `failed:{exportId}`, notifies in-app only and
has no link.

**One notification per outcome.** `notifyTableJobUser` (`table-jobs/notify.ts`)
sends `notify` with an Inngest event id: `table-export:{exportId}:ready`,
`:failed` or `:denied`. Inngest drops a second event with the same id for
24 hours, so a retried step does not notify twice.

The background file holds plain database values (`formatExportValue`,
`packages/jobs/src/table-jobs/csv.ts`): `2026-10-13`, `1250.5`, the stored
status. The on-screen formatters run in the browser only. An array cell joins
with `; `, an object cell becomes JSON, and a `customFields->>{id}` column reads
the custom field. The header row holds the translated labels in display order.

The daily cleanup (`prune-staged-raw-models`, `scheduled/cleanup.ts`) deletes
`temp-staging` objects after 7 days (`STAGED_RAW_TTL_DAYS`), so an export link
expires after 7 days. It also removes a part file that a job could not delete.

The job page size is 500, not 1,000 (`TABLE_JOB_PAGE_SIZE`). The list query
asks for `limit + 1` rows, and PostgREST returns at most 1,000 (`max_rows`).
With a limit of 1,000, `toPage` sees no next page and the export stops at
row 1,000.

The stores are live-list hooks (`useLiveList`, `@carbon/query`) consumed as tuples,
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
- A list without a `listKey` (a loader that calls `toPage` itself, with no
  registry entry) never reaches the background path. Its export stops at
  1,000 rows.
- A column whose value comes from a lookup the list's view lacks is the
  registry entry's `rows`, which the loader and the export both run
  (`exportListRows`, `utils/list-registry/index.server.ts`). A column whose
  `meta.exportValue` computes from the row needs the same function in the
  entry's `exportValues`. Jobs (Batches, Tracking), Batches (Jobs, Quantity,
  Process, Work Center), Suppliers (contacts, addresses), Workflows (Last
  Run) and Workflow Runs (Workflow, Record) have them. Any other
  `meta.exportValue` is not run: the background file holds the raw value.
- The `name` substitution is keyed on the literal accessor strings `itemId` /
  `supplierId` / `employeeId` / `customerId` **and only runs when the column has no
  `meta.exportValue`**; a column holding one of those ids under a different
  accessor key (or one that supplies its own `exportValue`) will not get the
  store-backed substitution — resolve the name yourself in `exportValue`.
- A column with a JSX header and no `meta.filterHeader` and no `meta.exportValue`
  is absent from all three maps — it neither exports nor appears in the sort
  picker. Give it a `filterHeader` (label) and/or an `exportValue` to include it.
- The per-cell read is a **flat** `row[key]`, so a dot-path accessor
  (`accessorKey: "item.name"`) exports blank. Supply a `meta.exportValue`.
- **Item columns**: the convention is two CSV columns — the item column exports
  the readable part id, and an `exportOnlyColumn` with `id: "itemName"` carries
  the name/description the cell stacks underneath it. A column whose accessor is
  `itemId` needs an explicit `meta.exportValue` returning the readable id,
  otherwise the `idNameMaps` substitution overwrites the id with the name and the
  part number never reaches the CSV.

## Unrelated standalone CSV

`apps/erp/app/modules/accounting/ui/ExchangeRates/ExchangeRateForm.tsx` also
downloads its own CSV (`{code}-exchange-rates.csv`) via the same
`downloadCsv` from `@carbon/files/csv`; it is independent of the shared Table
component. The report exports (`exportReport.ts`, `purchases.tsx`,
`analytics.$reportKey.tsx`) and the CSV-import template/error downloads go
through `@carbon/files/csv` too — there are no hand-rolled encoders left.

Injection handling is the STRIP semantic everywhere (`stripCsvFormulaPrefix`,
pinned by `apps/erp/app/utils/bom.test.ts`): formula-leading characters are
removed, not apostrophe-prefixed. The purchases/analytics exports previously
prefixed `'` — they now follow the shared rule, so a text cell like
`-Adjustments` exports as `Adjustments`. Deliberate: one rule, one encoder.
